import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/layouts/bflan.js?raw';
const { readBflan, sampleCurve } = new Function(`${source}; return { readBflan, sampleCurve };`)();

function file() {
  const bytes = new Uint8Array(0x100);
  const view = new DataView(bytes.buffer);
  bytes.set([0x46, 0x4c, 0x41, 0x4e, 0xff, 0xfe, 0x14, 0]);
  view.setUint16(0x10, 1, true);
  const pai = 0x14;
  bytes.set([0x70, 0x61, 0x69, 0x31], pai);
  view.setUint32(pai + 4, 0x100 - pai, true);
  view.setUint16(pai + 8, 30, true);
  bytes[pai + 10] = 1;
  view.setUint16(pai + 14, 1, true);
  view.setUint32(pai + 16, 0x14, true);
  view.setUint32(pai + 0x14, 0x18, true);
  const entry = pai + 0x18;
  bytes.set([...'P_icon'].map((c) => c.charCodeAt(0)), entry);
  bytes[entry + 28] = 2;
  view.setUint32(entry + 32, 0x28, true);
  view.setUint32(entry + 36, 0x60, true);
  const flpa = entry + 0x28;
  bytes.set([...'FLPA'].map((c) => c.charCodeAt(0)), flpa);
  bytes[flpa + 4] = 1;
  view.setUint32(flpa + 8, 12, true);
  const curve = flpa + 12;
  bytes.set([0, 1, 2], curve);
  view.setUint16(curve + 4, 2, true);
  view.setUint32(curve + 8, 12, true);
  [0, 10, 0, 20, 50, 0].forEach((value, i) => view.setFloat32(curve + 12 + i * 4, value, true));
  const flvi = entry + 0x60;
  bytes.set([...'FLVI'].map((c) => c.charCodeAt(0)), flvi);
  bytes[flvi + 4] = 1;
  view.setUint32(flvi + 8, 12, true);
  const step = flvi + 12;
  bytes.set([0, 0, 1], step);
  view.setUint16(step + 4, 2, true);
  view.setUint32(step + 8, 12, true);
  view.setFloat32(step + 12, 0, true);
  view.setUint16(step + 16, 0, true);
  view.setFloat32(step + 20, 5, true);
  view.setUint16(step + 24, 1, true);
  return bytes;
}

describe('bflan', () => {
  it('reads pane curves', () => {
    const anim = readBflan(file());
    expect(anim).toMatchObject({ frames: 30, loop: true });
    expect(anim.entries[0]).toMatchObject({ name: 'P_icon', target: 0 });
    expect(anim.entries[0].tags.map((tag: { tag: string }) => tag.tag)).toEqual(['FLPA', 'FLVI']);
    expect(anim.entries[0].tags[0].curves[0]).toMatchObject({ target: 1, step: false, keys: [[0, 10, 0], [20, 50, 0]] });
  });

  it('samples hermite and step curves', () => {
    const [flpa, flvi] = readBflan(file()).entries[0].tags.map((tag: { curves: unknown[] }) => tag.curves[0]);
    expect(sampleCurve(flpa, -5)).toBe(10);
    expect(sampleCurve(flpa, 10)).toBeCloseTo(30);
    expect(sampleCurve(flpa, 99)).toBe(50);
    expect([0, 4, 5, 9].map((f) => sampleCurve(flvi, f))).toEqual([0, 0, 1, 1]);
  });

  it('refuses other files', () => {
    expect(() => readBflan(new Uint8Array(32))).toThrow('not-bflan');
  });
});
