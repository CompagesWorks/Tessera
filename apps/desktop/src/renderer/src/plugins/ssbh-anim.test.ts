import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/ssbh/anim.js?raw';
const { pose, bindPose, compose, decompose, visibleBy, frameCount, motionFolders } = new Function(
  `${source}; return { pose, bindPose, compose, decompose, visibleBy, frameCount, motionFolders };`,
)();

const I = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const moved = (x: number, y: number, z: number) => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [x, y, z, 1]];
const skel = {
  bones: [
    { name: 'Trans', transform: I, parent_index: null },
    { name: 'Hip', transform: moved(0, 5, 0), parent_index: 0 },
    { name: 'Head', transform: moved(0, 3, 0), parent_index: 1 },
  ],
};
const track = (translation: number[], scale = [1, 1, 1], compensate = false) => ({
  name: 'Transform',
  compensate_scale: compensate,
  transform_flags: { override_translation: false, override_rotation: false, override_scale: false, override_compensate_scale: false },
  values: { Transform: [{ translation: { x: translation[0], y: translation[1], z: translation[2] }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: scale[0], y: scale[1], z: scale[2] } }] },
});

function close(actual: ArrayLike<number>, expected: number[]) {
  expect(Array.from(actual).map((v) => Math.round(v * 1e5) / 1e5)).toEqual(expected);
}

describe('ssbh animation', () => {
  it('gives identity skinning at the bind pose', () => {
    const p = pose(skel, bindPose(skel), null, 0);
    close(p.skin.slice(32, 48), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    close(p.joints, [0, 0, 0, 0, 5, 0, 0, 8, 0]);
  });

  it('moves children with an animated parent and keeps unanimated bones at bind', () => {
    const anim = { final_frame_index: 9, groups: [{ group_type: 'Transform', nodes: [{ name: 'Hip', tracks: [track([2, 5, 0])] }] }] };
    const p = pose(skel, bindPose(skel), anim, 4);
    close(p.joints, [0, 0, 0, 2, 5, 0, 2, 8, 0]);
    close(p.skin.slice(44, 47), [2, 0, 0]);
    expect(frameCount(anim)).toBe(10);
  });

  it('cancels the parent scale when compensate scale is set', () => {
    const anim = {
      final_frame_index: 0,
      groups: [{ group_type: 'Transform', nodes: [{ name: 'Hip', tracks: [track([0, 5, 0], [2, 2, 2])] }, { name: 'Head', tracks: [track([0, 3, 0], [1, 1, 1], true)] }] }],
    };
    const p = pose(skel, bindPose(skel), anim, 0);
    close(p.joints.slice(6), [0, 8, 0]);
    close(p.skin.slice(32, 33), [1]);
  });

  it('round-trips transforms and reads visibility by node prefix', () => {
    const parts = { translation: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, scale: { x: 2, y: 2, z: 2 } };
    const back = decompose(compose(parts));
    close([back.translation.x, back.rotation.y, back.rotation.w, back.scale.z], [1, 0.70711, 0.70711, 2]);
    const visibility = new Map([['Eye', false], ['EyeN_VIS_O_OBJ', true]]);
    expect(visibleBy(visibility, 'EyeN_VIS_O_OBJShape')).toBe(true);
    expect(visibleBy(visibility, 'EyeD_VIS_O_OBJShape')).toBe(false);
    expect(visibleBy(visibility, 'Body')).toBe(null);
    expect(motionFolders('fighter/purin/model/body/c00/model.numdlb')).toEqual(['fighter/purin/model/body/c00/', 'fighter/purin/motion/body/c00/']);
  });
});
