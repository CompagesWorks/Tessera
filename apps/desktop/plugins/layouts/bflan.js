const PANE_CURVES = ['x', 'y', 'z', 'rotateX', 'rotateY', 'rotation', 'scaleX', 'scaleY', 'width', 'height'];

function readBflan(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ascii = (at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length < 0x14 || ascii(0, 4) !== 'FLAN') throw new Error('not-bflan');
  const little = bytes[4] === 0xff && bytes[5] === 0xfe;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at) => view.getUint16(at, little);
  const u32 = (at) => view.getUint32(at, little);
  const f32 = (at) => view.getFloat32(at, little);
  const name = (at, max) => {
    let end = at;
    while (end < at + max && bytes[end]) end++;
    return new TextDecoder().decode(bytes.subarray(at, end));
  };
  const keys = (at, count, step) =>
    Array.from({ length: count }, (_, k) => (step ? [f32(at + k * 8), u16(at + k * 8 + 4), 0] : [f32(at + k * 12), f32(at + k * 12 + 4), f32(at + k * 12 + 8)]));
  const curve = (at) => {
    const step = bytes[at + 2] !== 2;
    return { index: bytes[at], target: bytes[at + 1], step, keys: keys(at + u32(at + 8), u16(at + 4), step) };
  };
  const tag = (at) => ({ tag: ascii(at, 4), curves: Array.from({ length: bytes[at + 4] }, (_, c) => curve(at + u32(at + 8 + c * 4))) });
  const entry = (at) => ({ name: name(at, 28), target: bytes[at + 29], tags: Array.from({ length: bytes[at + 28] }, (_, t) => tag(at + u32(at + 32 + t * 4))) });
  const anim = { frames: 0, loop: false, entries: [] };
  let at = u16(6);
  for (let i = u16(0x10); i > 0 && at + 8 <= bytes.length; i--) {
    const size = u32(at + 4);
    if (size < 8 || at + size > bytes.length) throw new Error('truncated');
    if (ascii(at, 4) === 'pai1') {
      anim.frames = u16(at + 8);
      anim.loop = bytes[at + 10] === 1;
      const table = at + u32(at + 16);
      anim.entries = Array.from({ length: u16(at + 14) }, (_, e) => entry(at + u32(table + e * 4)));
    }
    at += size;
  }
  return anim;
}

function sampleCurve({ keys, step }, frame) {
  if (!keys.length) return 0;
  if (frame <= keys[0][0]) return keys[0][1];
  for (let k = 1; k < keys.length; k++) {
    const [f1, v1, s1] = keys[k];
    if (frame >= f1) continue;
    const [f0, v0, s0] = keys[k - 1];
    if (step) return v0;
    const d = f1 - f0;
    const t = (frame - f0) / d;
    return v0 + (v1 - v0) * (3 * t * t - 2 * t * t * t) + d * (s0 * (t * t * t - 2 * t * t + t) + s1 * (t * t * t - t * t));
  }
  return keys[keys.length - 1][1];
}
