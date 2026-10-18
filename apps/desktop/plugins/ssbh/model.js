const MODEL = /\.numdlb$/i;
const EXPRESSION = /_VIS_/i;
const NEUTRAL = /N_VIS_/;

function folderOf(path) {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

function colorTextures(matl) {
  const textures = new Map();
  for (const entry of matl?.entries ?? []) {
    const color = entry.textures.find((t) => t.param_id === 'Texture0') ?? entry.textures[0];
    if (color && !color.data.startsWith('#') && !color.data.startsWith('/')) textures.set(entry.material_label, color.data);
  }
  return textures;
}

function drawList(modl, matl, objects) {
  const textures = colorTextures(matl);
  const materials = new Map(modl.entries.map((e) => [`${e.mesh_object_name}/${e.mesh_object_subindex}`, e.material_label]));
  return objects.map((object) => {
    const material = materials.get(`${object.name}/${object.subindex}`) ?? null;
    return { ...object, material, texture: material === null ? null : (textures.get(material) ?? null), visible: !EXPRESSION.test(object.name) || NEUTRAL.test(object.name) };
  });
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
  const textures = colorTextures(matl);
  const changed = [];
  list.forEach((object, i) => {
    const texture = object.material === null ? null : (textures.get(object.material) ?? null);
    if (texture !== object.texture) changed.push(i);
    object.texture = texture;
  });
  return changed;
}

function assignMaterial(modl, object, label) {
  const entry = modl.entries.find((e) => e.mesh_object_name === object.name && e.mesh_object_subindex === object.subindex);
  if (entry) entry.material_label = label;
  else modl.entries.push({ mesh_object_name: object.name, mesh_object_subindex: object.subindex, material_label: label });
  object.material = label;
}
