const VERTEX = `#version 300 es
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec4 bones;
in vec4 weights;
uniform mat4 view;
uniform mat4 projection;
uniform sampler2D boneMatrices;
uniform vec2 outline;
out vec3 vNormal;
out vec3 vPosition;
out vec2 vUv;
mat4 bone(float index) {
  int i = int(index);
  return mat4(texelFetch(boneMatrices, ivec2(0, i), 0), texelFetch(boneMatrices, ivec2(1, i), 0), texelFetch(boneMatrices, ivec2(2, i), 0), texelFetch(boneMatrices, ivec2(3, i), 0));
}
void main() {
  float total = weights.x + weights.y + weights.z + weights.w;
  mat4 skin = total > 0.0 ? bone(bones.x) * weights.x + bone(bones.y) * weights.y + bone(bones.z) * weights.z + bone(bones.w) * weights.w : mat4(1.0);
  vNormal = mat3(view) * mat3(skin) * normal;
  vUv = uv;
  vPosition = (view * skin * vec4(position, 1.0)).xyz;
  gl_Position = projection * view * skin * vec4(position, 1.0);
  vec2 push = (projection * view * skin * vec4(normal, 0.0)).xy;
  if (dot(push, push) > 0.0) gl_Position.xy += normalize(push) * outline * gl_Position.w;
}`;

const LINE_VERTEX = `#version 300 es
in vec3 position;
uniform mat4 view;
uniform mat4 projection;
void main() {
  gl_Position = projection * view * vec4(position, 1.0);
  gl_PointSize = 5.0;
}`;

const LINE_FRAGMENT = `#version 300 es
precision mediump float;
uniform vec3 color;
out vec4 outColor;
void main() {
  outColor = vec4(color, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPosition;
in vec2 vUv;
uniform mat4 view;
uniform sampler2D color;
uniform sampler2D normalMap;
uniform sampler2D params;
uniform vec4 tint;
uniform float pbr;
uniform float lightPower;
uniform float ambientPower;
uniform float specularPower;
uniform float bumpPower;
uniform float rimPower;
uniform float exposure;
out vec4 outColor;
const float PI = 3.14159265;
vec3 bump(vec3 n, vec4 nor) {
  vec3 dp1 = dFdx(vPosition), dp2 = dFdy(vPosition);
  vec2 duv1 = dFdx(vUv), duv2 = dFdy(vUv);
  vec3 t = cross(dp2, n) * duv1.x + cross(n, dp1) * duv2.x;
  vec3 b = cross(dp2, n) * duv1.y + cross(n, dp1) * duv2.y;
  float scale = inversesqrt(max(max(dot(t, t), dot(b, b)), 1e-20));
  vec2 xy = (nor.xy * 2.0 - 1.0) * bumpPower;
  return normalize(t * scale * xy.x + b * scale * xy.y + n * sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
void main() {
  if (tint.a > 0.0) {
    outColor = tint;
    return;
  }
  vec4 base = texture(color, vUv);
  if (pbr < 0.5) {
    outColor = vec4(base.rgb * (0.35 + 0.65 * abs(normalize(vNormal).z)) * exposure, 1.0);
    return;
  }
  vec3 albedo = pow(base.rgb, vec3(2.2));
  vec4 prm = texture(params, vUv);
  float metal = prm.r, rough = max(prm.g, 0.04), ao = prm.b;
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  n = bump(n, texture(normalMap, vUv));
  vec3 v = normalize(-vPosition);
  vec3 l = normalize(mat3(view) * vec3(-0.4, 0.7, 0.6) + v * 0.6);
  vec3 h = normalize(l + v);
  float nl = max(dot(n, l), 0.0), nv = max(dot(n, v), 1e-4), nh = max(dot(n, h), 0.0);
  float a2 = pow(rough, 4.0);
  float d = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  float k = rough * rough * 0.5;
  float g = nl * nv / ((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k));
  vec3 f0 = mix(vec3(0.16 * prm.a * prm.a), albedo, metal);
  vec3 f = f0 + (1.0 - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  vec3 fAmbient = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
  float up = dot(n, mat3(view) * vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.18, 0.17, 0.16), vec3(0.55, 0.58, 0.65), up) * ambientPower;
  vec3 diffuse = albedo * (1.0 - metal) * (nl * lightPower * (1.0 - f) + sky * (1.0 - fAmbient));
  vec3 specular = (d * g * f / (4.0 * nv + 1e-4) * lightPower + fAmbient * sky * (1.0 - rough * 0.6)) * specularPower;
  vec3 rim = vec3(rimPower) * pow(1.0 - nv, 4.0) * (1.0 - metal) * up;
  vec3 linear = ((diffuse + specular) * ao + rim) * exposure;
  outColor = vec4(pow(linear / (linear + 0.8) * 1.8, vec3(1.0 / 2.2)), 1.0);
}`;

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

function orbitView(yaw, pitch, distance, target) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x = [cy, 0, -sy];
  const y = [-sy * sp, cp, -cy * sp];
  const z = [sy * cp, sp, cy * cp];
  const eye = target.map((t, k) => t + z[k] * distance);
  const dot = (a) => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x), -dot(y), -dot(z), 1];
}

function createViewer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, stencil: true });
  if (!gl) throw new Error('webgl2');
  const shader = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const link = (vertex, fragment) => {
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  };
  const program = link(VERTEX, FRAGMENT);
  const lines = link(LINE_VERTEX, LINE_FRAGMENT);
  const at = (name) => gl.getAttribLocation(program, name);
  const uniform = (name) => gl.getUniformLocation(program, name);
  const lineUniform = (name) => gl.getUniformLocation(lines, name);
  gl.vertexAttrib4f(at('weights'), 0, 0, 0, 0);
  const boneTexture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, boneTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  gl.activeTexture(gl.TEXTURE0);
  const lineVao = gl.createVertexArray();
  const lineBuffer = gl.createBuffer();
  gl.bindVertexArray(lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.enableVertexAttribArray(gl.getAttribLocation(lines, 'position'));
  gl.vertexAttribPointer(gl.getAttribLocation(lines, 'position'), 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let parents = [];
  let lineCount = 0;
  let jointCount = 0;
  let showBones = false;
  let highlight = null;
  const shading = {};
  const accent = (getComputedStyle(document.documentElement).getPropertyValue('--atrium-accent-rgb') || '88, 140, 255').split(',').map((v) => Number(v) / 255);
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
  const fallback = { texture: white };
  for (const [slot, pixel] of [['normal', [128, 128, 255, 255]], ['params', [0, 255, 255, 58]]]) {
    fallback[slot] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fallback[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixel));
  }

  let draws = [];
  let camera = { yaw: 0.6, pitch: 0.25, distance: 30, target: [0, 0, 0], radius: 10 };
  let frame = 0;

  const buffer = (target, data) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  };
  const attribute = (name, data, size) => {
    const location = at(name);
    if (location < 0) return;
    if (!data) return gl.disableVertexAttribArray(location);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer(gl.ARRAY_BUFFER, data));
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };

  function begin(width, height) {
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const viewMatrix = orbitView(camera.yaw, camera.pitch, camera.distance, camera.target);
    const projectionMatrix = perspective(0.8, width / height, camera.radius / 100, camera.distance + camera.radius * 4);
    gl.useProgram(program);
    gl.uniform1i(uniform('color'), 0);
    gl.uniform1i(uniform('boneMatrices'), 1);
    gl.uniform1i(uniform('normalMap'), 2);
    gl.uniform1i(uniform('params'), 3);
    gl.uniformMatrix4fv(uniform('view'), false, viewMatrix);
    gl.uniformMatrix4fv(uniform('projection'), false, projectionMatrix);
    gl.uniform2f(uniform('outline'), 0, 0);
    gl.uniform4f(uniform('tint'), 0, 0, 0, 0);
    for (const [name, value] of Object.entries(shading)) gl.uniform1f(uniform(name), value);
    return { viewMatrix, projectionMatrix };
  }

  function render() {
    frame = 0;
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
    const { viewMatrix, projectionMatrix } = begin(width, height);
    for (const draw of draws) {
      if (!draw.visible) continue;
      gl.bindVertexArray(draw.vao);
      for (const [unit, slot] of [[2, 'normal'], [3, 'params'], [0, 'texture']]) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, draw[slot] ?? fallback[slot]);
      }
      gl.drawElements(gl.TRIANGLES, draw.count, gl.UNSIGNED_INT, 0);
    }
    const marked = highlight === null ? null : draws[highlight];
    if (marked) {
      gl.bindVertexArray(marked.vao);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.colorMask(false, false, false, false);
      gl.drawElements(gl.TRIANGLES, marked.count, gl.UNSIGNED_INT, 0);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
      gl.uniform2f(uniform('outline'), (3 * devicePixelRatio * 2) / width, (3 * devicePixelRatio * 2) / height);
      gl.uniform4f(uniform('tint'), accent[0], accent[1], accent[2], 1);
      gl.drawElements(gl.TRIANGLES, marked.count, gl.UNSIGNED_INT, 0);
      gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.DEPTH_TEST);
    }
    if (showBones && jointCount) {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(lines);
      gl.uniformMatrix4fv(lineUniform('view'), false, viewMatrix);
      gl.uniformMatrix4fv(lineUniform('projection'), false, projectionMatrix);
      gl.bindVertexArray(lineVao);
      gl.uniform3f(lineUniform('color'), 0.35, 0.65, 1);
      gl.drawArrays(gl.LINES, 0, lineCount);
      gl.uniform3f(lineUniform('color'), 1, 1, 1);
      gl.drawArrays(gl.POINTS, lineCount, jointCount);
    }
    gl.bindVertexArray(null);
  }
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  function setObjects(objects, box) {
    for (const draw of draws) gl.deleteVertexArray(draw.vao);
    highlight = null;
    draws = objects.map((object) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      attribute('position', object.positions, 3);
      attribute('normal', object.normals, 3);
      attribute('uv', object.uvs, 2);
      attribute('bones', object.bones, 4);
      attribute('weights', object.weights, 4);
      buffer(gl.ELEMENT_ARRAY_BUFFER, object.indices);
      gl.bindVertexArray(null);
      return { vao, count: object.indices.length, visible: object.visible !== false };
    });
    fit(box);
  }

  function fit(box) {
    camera = { ...camera, yaw: 0.6, pitch: 0.25, target: box.center, radius: box.radius, distance: box.radius * 2.4 };
    redraw();
  }

  const uploaded = new WeakMap();
  function setTexture(index, image, slot = 'texture') {
    if (image && !uploaded.has(image)) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      uploaded.set(image, texture);
    }
    for (const i of index) draws[i][slot] = image ? uploaded.get(image) : null;
    redraw();
  }

  function setSkeleton(next) {
    parents = next;
    jointCount = 0;
    redraw();
  }

  function setPose({ skin, joints }) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, boneTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, skin.length / 16, 0, gl.RGBA, gl.FLOAT, skin);
    gl.activeTexture(gl.TEXTURE0);
    const segments = [];
    parents.forEach((parent, i) => parent !== null && segments.push(...joints.subarray(i * 3, i * 3 + 3), ...joints.subarray(parent * 3, parent * 3 + 3)));
    lineCount = segments.length / 3;
    jointCount = joints.length / 3;
    const data = new Float32Array(segments.length + joints.length);
    data.set(segments);
    data.set(joints, segments.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    redraw();
  }

  function setShading(values) {
    Object.assign(shading, values);
    redraw();
  }

  function setBonesVisible(visible) {
    showBones = visible;
    redraw();
  }

  let target = null;
  function pick(clientX, clientY) {
    const { width, height } = canvas;
    if (!target || target.width !== width || target.height !== height) {
      if (target) gl.deleteFramebuffer(target.buffer);
      const buffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
      for (const [format, attachment] of [[gl.RGBA8, gl.COLOR_ATTACHMENT0], [gl.DEPTH_COMPONENT16, gl.DEPTH_ATTACHMENT]]) {
        const storage = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, storage);
        gl.renderbufferStorage(gl.RENDERBUFFER, format, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, storage);
      }
      target = { buffer, width, height };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.buffer);
    begin(width, height);
    draws.forEach((draw, i) => {
      if (!draw.visible) return;
      gl.uniform4f(uniform('tint'), ((i + 1) & 255) / 255, ((i + 1) >> 8) / 255, 0, 1);
      gl.bindVertexArray(draw.vao);
      gl.drawElements(gl.TRIANGLES, draw.count, gl.UNSIGNED_INT, 0);
    });
    gl.bindVertexArray(null);
    const box = canvas.getBoundingClientRect();
    const pixel = new Uint8Array(4);
    gl.readPixels(Math.floor(((clientX - box.left) / box.width) * width), Math.floor(((box.bottom - clientY) / box.height) * height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const id = pixel[0] + pixel[1] * 256;
    return id ? id - 1 : null;
  }

  function setHighlight(index) {
    highlight = index;
    redraw();
  }

  function setVisible(index, visible) {
    draws[index].visible = visible;
    redraw();
  }

  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.ctrlKey) return;
    drag = { x: event.clientX, y: event.clientY, pan: event.button !== 0 || event.shiftKey };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    Object.assign(drag, { x: event.clientX, y: event.clientY });
    if (drag.pan) {
      const view = orbitView(camera.yaw, camera.pitch, camera.distance, camera.target);
      const scale = camera.distance / canvas.clientHeight;
      camera.target = camera.target.map((t, k) => t - view[k * 4] * dx * scale + view[k * 4 + 1] * dy * scale);
    } else {
      camera.yaw -= dx * 0.01;
      camera.pitch = Math.max(-1.55, Math.min(1.55, camera.pitch + dy * 0.01));
    }
    redraw();
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.distance = Math.max(camera.radius * 0.05, camera.distance * Math.exp(event.deltaY * 0.001));
    redraw();
  }, { passive: false });
  new ResizeObserver(redraw).observe(canvas);

  return { setObjects, setTexture, setVisible, setHighlight, pick, setSkeleton, setPose, setBonesVisible, setShading, fit };
}
