import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/ssbh/model.js?raw';
const { drawList, bounds, folderOf } = new Function(`${source}; return { drawList, bounds, folderOf };`)();

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
      ['eye', null],
      [null, null],
    ]);
    expect(
      drawList({ entries: [] }, null, ['body', 'Purin_EyeN_VIS_O_OBJShape', 'Purin_Eye_Blink_VIS_O_OBJShape'].map((name) => ({ name, subindex: 0 }))).map(
        (o: { visible: boolean }) => o.visible,
      ),
    ).toEqual([true, true, false]);
    expect(drawList(modl, null, [{ name: 'body', subindex: 0 }])[0].texture).toBe(null);
  });

  it('frames the model', () => {
    const box = bounds([{ positions: new Float32Array([0, 0, 0, 2, 4, 4]) }]);
    expect(box.center).toEqual([1, 2, 2]);
    expect(box.radius).toBe(3);
    expect(bounds([]).radius).toBe(10);
    expect(folderOf('fighter/mario/model/body/c00/model.numdlb')).toBe('fighter/mario/model/body/c00/');
  });
});
