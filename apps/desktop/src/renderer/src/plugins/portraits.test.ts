import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/portraits/features.js?raw';
const { estimate } = new Function(`${source}; return { estimate };`)();

function texture(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  const blobs = Array.from({ length: 60 }, (_, i) => [(i * 97) % width, (i * 53 + i * i) % height, 6 + (i % 9), (i * 41) % 256] as const);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = 40;
      for (const [bx, by, r, c] of blobs) if (Math.abs(x - bx) < r && Math.abs(y - by) < r * 0.6) v = c;
      data.set([v, 255 - v, (v * 3) % 256, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

function warp(src: ReturnType<typeof texture>, width: number, height: number, a: number, b: number, tx: number, ty: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  const norm = a * a + b * b;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - tx;
      const dy = y - ty;
      const sx = Math.round((a * dx + b * dy) / norm);
      const sy = Math.round((-b * dx + a * dy) / norm);
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue;
      data.set(src.data.subarray((sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

describe('portraits alignment', () => {
  it('recovers a scaled, rotated and shifted crop of the reference', () => {
    const reference = texture(320, 320);
    const scale = 1.6;
    const angle = 0.12;
    const a = scale * Math.cos(angle);
    const b = scale * Math.sin(angle);
    const target = warp(reference, 240, 240, a, b, -150, -120);
    const t = estimate(reference, target);
    expect(t).not.toBeNull();
    for (const [x, y] of [[95, 75], [245, 75], [95, 225], [245, 225]] as const) {
      const error = Math.hypot(t.a * x - t.b * y + t.tx - (a * x - b * y - 150), t.b * x + t.a * y + t.ty - (b * x + a * y - 120));
      expect(error).toBeLessThan(4);
    }
  });

  it('gives up on unrelated images', () => {
    const blank = { data: new Uint8ClampedArray(100 * 100 * 4), width: 100, height: 100 };
    expect(estimate(texture(200, 200), blank)).toBeNull();
  });
});
