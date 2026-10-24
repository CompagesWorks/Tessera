const MODEL = /\.numdlb$/i;
const EXPRESSION = /_VIS_/i;
const NEUTRAL = /N_VIS_/;
const DEFAULT_TEXTURES = {
  '/common/shader/sfxpbs/default_black': [0, 0, 0, 255],
  '/common/shader/sfxpbs/default_color': [255, 255, 255, 255],
  '/common/shader/sfxpbs/default_color2': [255, 255, 255, 255],
  '/common/shader/sfxpbs/default_color3': [255, 255, 255, 255],
  '/common/shader/sfxpbs/default_color4': [255, 255, 255, 255],
  '/common/shader/sfxpbs/default_diffuse2': null,
  '/common/shader/sfxpbs/default_gray': [123, 121, 123, 255],
  '/common/shader/sfxpbs/default_metallicbg': [0, 255, 255, 58],
  '/common/shader/sfxpbs/default_normal': [132, 120, 255, 255],
  '/common/shader/sfxpbs/default_params': [0, 255, 255, 58],
  '/common/shader/sfxpbs/default_params_r000_g025_b100': [0, 65, 255, 255],
  '/common/shader/sfxpbs/default_params_r100_g025_b100': [255, 65, 255, 255],
  '/common/shader/sfxpbs/default_params2': [255, 255, 255, 255],
  '/common/shader/sfxpbs/default_params3': [0, 117, 255, 58],
  '/common/shader/sfxpbs/default_white': [255, 255, 255, 255],
  '/common/shader/sfxpbs/fighter/default_normal': [128, 128, 255, 255],
  '/common/shader/sfxpbs/fighter/default_params': [0, 255, 255, 58],
  '#replace_cubemap': null,
};

function folderOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

const SLOTS = { texture: 'Texture0', normal: 'Texture4', params: 'Texture6' };

function colorTextures(matl, id = 'Texture0') {
  const textures = new Map();
  for (const entry of matl?.entries ?? []) {
    const color = entry.textures.find((t) => t.param_id === id) ?? (id === 'Texture0' ? entry.textures[0] : null);
    if (color && (DEFAULT_TEXTURES[color.data] || !/^[#/]/.test(color.data))) textures.set(entry.material_label, color.data);
  }
  return textures;
}

function drawList(modl, matl, objects) {
  const materials = new Map(modl.entries.map((e) => [`${e.mesh_object_name}/${e.mesh_object_subindex}`, e.material_label]));
  const list = objects.map((object) => ({ ...object, material: materials.get(`${object.name}/${object.subindex}`) ?? null, visible: !EXPRESSION.test(object.name) || NEUTRAL.test(object.name) }));
  retexture(list, matl);
  return list;
}

function bounds(objects) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of objects) {
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[i + k]);
        max[k] = Math.max(max[k], positions[i + k]);
      }
    }
  }
  if (min[0] === Infinity) return { center: [0, 0, 0], radius: 10 };
  const center = min.map((v, k) => (v + max[k]) / 2);
  return { center, radius: Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, 0.01) };
}

function retexture(list, matl) {
  const changed = new Set();
  for (const [slot, id] of Object.entries(SLOTS)) {
    const textures = colorTextures(matl, id);
    list.forEach((object, i) => {
      const texture = object.material === null ? null : (textures.get(object.material) ?? null);
      if (texture !== object[slot]) changed.add(i);
      object[slot] = texture;
    });
  }
  return [...changed];
}

function assignMaterial(modl, object, label) {
  const entry = modl.entries.find((e) => e.mesh_object_name === object.name && e.mesh_object_subindex === object.subindex);
  if (entry) entry.material_label = label;
  else modl.entries.push({ mesh_object_name: object.name, mesh_object_subindex: object.subindex, material_label: label });
  object.material = label;
}

const PARAM_KINDS = [
  ['textures', 'Texture', 20, () => '/common/shader/sfxpbs/default_white'],
  ['samplers', 'Sampler', 20, () => ({ wraps: 'Repeat', wrapt: 'Repeat', wrapr: 'Repeat', min_filter: 'LinearMipmapLinear', mag_filter: 'Linear', border_color: { r: 0, g: 0, b: 0, a: 0 }, lod_bias: 0, max_anisotropy: 'One' })],
  ['floats', 'CustomFloat', 20, () => 0],
  ['booleans', 'CustomBoolean', 20, () => false],
  ['vectors', 'CustomVector', 64, () => ({ x: 0, y: 0, z: 0, w: 0 })],
  ['blend_states', 'BlendState', 1, () => ({ source_color: 'One', color_operation: 'Add', destination_color: 'Zero', source_alpha: 'One', alpha_operation: 'Add', destination_alpha: 'Zero', alpha_sample_to_coverage: false })],
  ['rasterizer_states', 'RasterizerState', 1, () => ({ fill_mode: 'Solid', cull_mode: 'Back', depth_bias: 0 })],
];

function freeParams(entry, kind) {
  const [, prefix, count] = PARAM_KINDS.find(([k]) => k === kind);
  const used = new Set(entry[kind].map((p) => p.param_id));
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`).filter((id) => !used.has(id));
}

function addParam(entry, kind, id) {
  const [, , , value] = PARAM_KINDS.find(([k]) => k === kind);
  if (entry[kind].some((p) => p.param_id === id)) return;
  entry[kind].push({ param_id: id, data: value() });
  if (kind === 'textures') addParam(entry, 'samplers', id.replace('Texture', 'Sampler'));
}

function removeParam(entry, kind, id) {
  entry[kind] = entry[kind].filter((p) => p.param_id !== id);
}

function uniqueLabel(matl, base) {
  const labels = new Set(matl.entries.map((e) => e.material_label));
  if (!labels.has(base)) return base;
  let n = 2;
  while (labels.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function duplicateMaterial(matl, label) {
  const index = matl.entries.findIndex((e) => e.material_label === label);
  const copy = { ...structuredClone(matl.entries[index]), material_label: uniqueLabel(matl, `${label}_copy`) };
  matl.entries.splice(index + 1, 0, copy);
  return copy;
}

function renameMaterial(matl, modl, list, from, to) {
  if (from === to) return true;
  if (!to || matl.entries.some((e) => e.material_label === to)) return false;
  matl.entries.find((e) => e.material_label === from).material_label = to;
  for (const e of modl.entries) if (e.material_label === from) e.material_label = to;
  for (const o of list) if (o.material === from) o.material = to;
  return true;
}

function deleteMaterial(matl, modl, label) {
  if (modl.entries.some((e) => e.material_label === label)) return false;
  matl.entries = matl.entries.filter((e) => e.material_label !== label);
  return true;
}
