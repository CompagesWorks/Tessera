const ANIM = /\.nuanmb$/i;

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return identity();
  const d = 1 / det;
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ]);
}

function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function compose({ translation: t, rotation: q, scale: s }) {
  const { x, y, z, w } = q;
  return new Float32Array([
    (1 - 2 * (y * y + z * z)) * s.x, 2 * (x * y + z * w) * s.x, 2 * (x * z - y * w) * s.x, 0,
    2 * (x * y - z * w) * s.y, (1 - 2 * (x * x + z * z)) * s.y, 2 * (y * z + x * w) * s.y, 0,
    2 * (x * z + y * w) * s.z, 2 * (y * z - x * w) * s.z, (1 - 2 * (x * x + y * y)) * s.z, 0,
    t.x, t.y, t.z, 1,
  ]);
}

function decompose(m) {
  const scale = { x: Math.hypot(m[0], m[1], m[2]), y: Math.hypot(m[4], m[5], m[6]), z: Math.hypot(m[8], m[9], m[10]) };
  const r = [m[0] / scale.x, m[1] / scale.x, m[2] / scale.x, m[4] / scale.y, m[5] / scale.y, m[6] / scale.y, m[8] / scale.z, m[9] / scale.z, m[10] / scale.z];
  const trace = r[0] + r[4] + r[8];
  let rotation;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    rotation = { w: s / 4, x: (r[5] - r[7]) / s, y: (r[6] - r[2]) / s, z: (r[1] - r[3]) / s };
  } else if (r[0] > r[4] && r[0] > r[8]) {
    const s = Math.sqrt(1 + r[0] - r[4] - r[8]) * 2;
    rotation = { w: (r[5] - r[7]) / s, x: s / 4, y: (r[3] + r[1]) / s, z: (r[6] + r[2]) / s };
  } else if (r[4] > r[8]) {
    const s = Math.sqrt(1 + r[4] - r[0] - r[8]) * 2;
    rotation = { w: (r[6] - r[2]) / s, x: (r[3] + r[1]) / s, y: s / 4, z: (r[7] + r[5]) / s };
  } else {
    const s = Math.sqrt(1 + r[8] - r[0] - r[4]) * 2;
    rotation = { w: (r[1] - r[3]) / s, x: (r[6] + r[2]) / s, y: (r[7] + r[5]) / s, z: s / 4 };
  }
  return { translation: { x: m[12], y: m[13], z: m[14] }, rotation, scale };
}

function at(values, frame) {
  return values[Math.min(Math.max(Math.floor(frame), 0), values.length - 1)];
}

function frameCount(anim) {
  return anim ? Math.floor(anim.final_frame_index) + 1 : 1;
}

function bindPose(skel) {
  const local = skel.bones.map((b) => new Float32Array(b.transform.flat()));
  const world = [];
  const order = [];
  const resolve = (i) => {
    if (world[i]) return world[i];
    const parent = skel.bones[i].parent_index;
    world[i] = parent === null ? local[i] : multiply(resolve(parent), local[i]);
    order.push(i);
    return world[i];
  };
  skel.bones.forEach((_, i) => resolve(i));
  return { local, order, parts: local.map(decompose), inverse: world.map(invert), index: new Map(skel.bones.map((b, i) => [b.name, i])) };
}

function qmul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const direction = (m, v) => normalize3([m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]);

function axisAngle(axis, angle) {
  const s = Math.sin(angle / 2);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angle / 2) };
}

function rotationArc(from, to) {
  const d = dot3(from, to);
  if (d < -1 + 1e-6) {
    const axis = normalize3(Math.abs(from[0]) < 0.9 ? cross3(from, [1, 0, 0]) : cross3(from, [0, 1, 0]));
    return axisAngle(axis, Math.PI);
  }
  const c = cross3(from, to);
  const q = { x: c[0], y: c[1], z: c[2], w: 1 + d };
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

function toEulerZYX({ x, y, z, w }) {
  return {
    z: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
    y: Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - x * z)))),
    x: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
  };
}

function fromEulerZYX({ x, y, z }) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x / 2), Math.sin(x / 2), Math.cos(y / 2), Math.sin(y / 2), Math.cos(z / 2), Math.sin(z / 2)];
  return {
    w: cx * cy * cz + sx * sy * sz,
    x: sx * cy * cz - cx * sy * sz,
    y: cx * sy * cz + sx * cy * sz,
    z: cx * cy * sz - sx * sy * cz,
  };
}

function interpAngle(a, b, f) {
  const max = 2 * Math.PI;
  const diff = (b - a) % max;
  return a + (((2 * diff) % max) - diff) * f;
}

function orientConstraint(world, bind, skel, c, parentWorld, current) {
  const source = bind.index.get(c.source_bone_name);
  if (source === undefined || !bind.index.has(c.target_bone_name)) return null;
  const sourceRot = toEulerZYX(decompose(world[source]).rotation);
  const target = decompose(multiply(parentWorld, current));
  const rot = toEulerZYX(target.rotation);
  const axes = c.constraint_axes;
  const rotation = fromEulerZYX({ z: interpAngle(rot.z, sourceRot.z, axes.z), y: interpAngle(rot.y, sourceRot.y, axes.y), x: interpAngle(rot.x, sourceRot.x, axes.x) });
  return multiply(invert(parentWorld), compose({ ...target, rotation }));
}

function aimConstraint(world, bind, c, current) {
  const source = bind.index.get(c.aim_bone_name1);
  const targetIndex = bind.index.get(c.target_bone_name1);
  if (source === undefined || targetIndex === undefined) return null;
  const targetWorld = world[targetIndex];
  const aim = direction(targetWorld, [c.aim.x, c.aim.y, c.aim.z]);
  const up = direction(targetWorld, [c.up.x, c.up.y, c.up.z]);
  const referenceUp = direction(targetWorld, [0, 1, 0]);
  const v = normalize3([world[source][12] - targetWorld[12], world[source][13] - targetWorld[13], world[source][14] - targetWorld[14]]);
  const parts = decompose(current);
  let rotation = qmul(parts.rotation, rotationArc(aim, v));
  rotation = qmul(rotation, axisAngle(v, Math.atan2(dot3(cross3(up, referenceUp), v), dot3(up, referenceUp))));
  return compose({ ...parts, rotation });
}

function tracks(anim, type) {
  const found = new Map();
  for (const group of anim?.groups ?? []) {
    if (group.group_type !== type) continue;
    for (const node of group.nodes) if (node.tracks[0]) found.set(node.name, node.tracks[0]);
  }
  return found;
}

function pose(skel, bind, anim, frame, hlpb = null) {
  const transforms = tracks(anim, 'Transform');
  const animated = skel.bones.map((bone, i) => {
    const track = transforms.get(bone.name);
    const value = track?.values.Transform && at(track.values.Transform, frame);
    if (!value) return null;
    const flags = track.transform_flags ?? {};
    return {
      parts: {
        translation: flags.override_translation ? bind.parts[i].translation : value.translation,
        rotation: flags.override_rotation ? bind.parts[i].rotation : value.rotation,
        scale: flags.override_scale ? bind.parts[i].scale : value.scale,
      },
      compensate: track.compensate_scale,
    };
  });
  const local = (i) => {
    const a = animated[i];
    if (!a) return bind.local[i];
    const m = compose(a.parts);
    const parent = skel.bones[i].parent_index;
    const s = a.compensate && parent !== null ? (animated[parent]?.parts.scale ?? { x: 1, y: 1, z: 1 }) : null;
    if (s) for (let c = 0; c < 3; c++) [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]] = [m[c * 4] / s.x, m[c * 4 + 1] / s.y, m[c * 4 + 2] / s.z];
    return m;
  };
  const world = [];
  const parentOf = (i) => (skel.bones[i].parent_index === null ? identity() : world[skel.bones[i].parent_index]);
  for (const i of bind.order) world[i] = multiply(parentOf(i), local(i));
  if (hlpb) {
    for (const i of bind.order) {
      const name = skel.bones[i].name;
      const parentWorld = parentOf(i);
      let current = local(i);
      const orient = hlpb.orient_constraints.find((c) => c.target_bone_name === name);
      if (orient) current = orientConstraint(world, bind, skel, orient, parentWorld, current) ?? current;
      const aim = hlpb.aim_constraints.find((c) => c.target_bone_name1 === name);
      if (aim) current = aimConstraint(world, bind, aim, current) ?? current;
      world[i] = multiply(parentWorld, current);
    }
  }
  const skin = new Float32Array(skel.bones.length * 16);
  const joints = new Float32Array(skel.bones.length * 3);
  skel.bones.forEach((_, i) => {
    skin.set(multiply(world[i], bind.inverse[i]), i * 16);
    joints.set([world[i][12], world[i][13], world[i][14]], i * 3);
  });
  const visibility = new Map();
  for (const [name, track] of tracks(anim, 'Visibility')) if (track.values.Boolean) visibility.set(name, at(track.values.Boolean, frame));
  return { skin, joints, visibility };
}

function visibleBy(visibility, name) {
  let best = null;
  for (const [node, visible] of visibility) if (name.startsWith(node) && (best === null || node.length > best[0].length)) best = [node, visible];
  return best ? best[1] : null;
}

function motionFolders(modelPath) {
  const folder = modelPath.slice(0, modelPath.lastIndexOf('/') + 1);
  return [folder, folder.replace('/model/', '/motion/')];
}
