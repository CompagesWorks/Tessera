import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/models/model.js?raw';
const { drawList, bounds, folderOf, retexture, assignMaterial, freeParams, addParam, removeParam, duplicateMaterial, renameMaterial, deleteMaterial } = new Function(
  `${source}; return { drawList, bounds, folderOf, retexture, assignMaterial, freeParams, addParam, removeParam, duplicateMaterial, renameMaterial, deleteMaterial };`,
)();

describe('ssbh model', () => {
  const modl = {
    entries: [
      { mesh_object_name: 'body', mesh_object_subindex: 0, material_label: 'skin' },
      { mesh_object_name: 'eye', mesh_object_subindex: 0, material_label: 'eye' },
    ],
  };
  const matl = {
    entries: [
      { material_label: 'skin', textures: [{ param_id: 'Texture4', data: 'def_nor' }, { param_id: 'Texture0', data: 'def_col' }] },
      { material_label: 'eye', textures: [{ param_id: 'Texture0', data: '/common/shader/sfxpbs/default_white' }] },
    ],
  };

  it('pairs each mesh with its material and color texture', () => {
    const list = drawList(modl, matl, [
      { name: 'body', subindex: 0 },
      { name: 'eye', subindex: 0 },
      { name: 'body', subindex: 1 },
    ]);
    expect(list.map((o: { material: string | null; texture: string | null }) => [o.material, o.texture])).toEqual([
      ['skin', 'def_col'],
      ['eye', '/common/shader/sfxpbs/default_white'],
      [null, null],
    ]);
    expect(
      drawList({ entries: [] }, null, ['body', 'Purin_EyeN_VIS_O_OBJShape', 'Purin_Eye_Blink_VIS_O_OBJShape'].map((name) => ({ name, subindex: 0 }))).map(
        (o: { visible: boolean }) => o.visible,
      ),
    ).toEqual([true, true, false]);
    expect(drawList(modl, null, [{ name: 'body', subindex: 0 }])[0].texture).toBe(null);
  });

  it('follows material edits and reassignments', () => {
    const model = structuredClone(modl);
    const materials = structuredClone(matl);
    const list = drawList(model, materials, [
      { name: 'body', subindex: 0 },
      { name: 'eye', subindex: 0 },
      { name: 'hat', subindex: 0 },
    ]);
    materials.entries[0]!.textures[1]!.data = 'alt_col';
    expect(retexture(list, materials)).toEqual([0]);
    expect(list[0]!.texture).toBe('alt_col');
    assignMaterial(model, list[1], 'skin');
    assignMaterial(model, list[2], 'skin');
    expect(model.entries[1]!.material_label).toBe('skin');
    expect(model.entries[2]).toEqual({ mesh_object_name: 'hat', mesh_object_subindex: 0, material_label: 'skin' });
    expect(retexture(list, materials)).toEqual([1, 2]);
    expect(retexture(list, materials)).toEqual([]);
  });

  it('duplicates, renames and deletes materials', () => {
    const model: typeof modl = structuredClone(modl);
    const materials: { entries: { material_label: string; textures: { param_id: string; data: string }[] }[] } = structuredClone(matl);
    const list = drawList(model, materials, [{ name: 'body', subindex: 0 }]);
    const copy = duplicateMaterial(materials, 'skin');
    expect(copy.material_label).toBe('skin_copy');
    expect(duplicateMaterial(materials, 'skin').material_label).toBe('skin_copy_2');
    expect(materials.entries.map((e: { material_label: string }) => e.material_label)).toEqual(['skin', 'skin_copy_2', 'skin_copy', 'eye']);
    copy.textures[0].data = 'changed';
    expect(materials.entries[0]?.textures[0]?.data).toBe('def_nor');
    expect(renameMaterial(materials, model, list, 'skin', 'eye')).toBe(false);
    expect(renameMaterial(materials, model, list, 'skin', '')).toBe(false);
    expect(renameMaterial(materials, model, list, 'skin', 'body_mat')).toBe(true);
    expect([model.entries[0]?.material_label, list[0].material, materials.entries[0]?.material_label]).toEqual(['body_mat', 'body_mat', 'body_mat']);
    expect(deleteMaterial(materials, model, 'body_mat')).toBe(false);
    expect(deleteMaterial(materials, model, 'skin_copy')).toBe(true);
    expect(materials.entries).toHaveLength(3);
  });

  it('adds and removes parameters with their sampler', () => {
    const entry = { textures: [{ param_id: 'Texture0', data: 'a' }], samplers: [{ param_id: 'Sampler0', data: {} }], floats: [], booleans: [], vectors: [], blend_states: [], rasterizer_states: [] };
    expect(freeParams(entry, 'textures')).toHaveLength(19);
    expect(freeParams(entry, 'vectors')).toHaveLength(64);
    addParam(entry, 'textures', 'Texture10');
    addParam(entry, 'textures', 'Texture2');
    addParam(entry, 'textures', 'Texture0');
    expect(entry.textures.map((p) => p.param_id)).toEqual(['Texture0', 'Texture10', 'Texture2']);
    expect(entry.samplers.map((p) => p.param_id)).toEqual(['Sampler0', 'Sampler10', 'Sampler2']);
    expect(entry.textures[0]?.data).toBe('a');
    addParam(entry, 'blend_states', 'BlendState0');
    expect(freeParams(entry, 'blend_states')).toEqual([]);
    removeParam(entry, 'textures', 'Texture2');
    expect(entry.textures.map((p) => p.param_id)).toEqual(['Texture0', 'Texture10']);
  });

  it('frames the model', () => {
    const box = bounds([{ positions: new Float32Array([0, 0, 0, 2, 4, 4]) }]);
    expect(box.center).toEqual([1, 2, 2]);
    expect(box.radius).toBe(3);
    expect(bounds([]).radius).toBe(10);
    expect(folderOf('fighter/mario/model/body/c00/model.numdlb')).toBe('fighter/mario/model/body/c00/');
  });
});
