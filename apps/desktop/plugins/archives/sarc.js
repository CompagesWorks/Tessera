function sarcMagic(bytes, at) {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function yaz0Decompress(bytes) {
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, false);
  const out = new Uint8Array(size);
  let src = 16;
  let dst = 0;
  while (dst < size) {
    const flags = bytes[src++];
    for (let bit = 7; bit >= 0 && dst < size; bit--) {
      if (flags & (1 << bit)) {
        out[dst++] = bytes[src++];
        continue;
      }
      const a = bytes[src++];
      const b = bytes[src++];
      const back = dst - (((a & 0x0f) << 8) | b) - 1;
      const length = a >> 4 ? (a >> 4) + 2 : bytes[src++] + 0x12;
      if (back < 0 || src > bytes.length) throw new Error('truncated');
      for (let i = 0; i < length; i++) out[dst++] = out[back + i];
    }
  }
  return out;
}

// shortcut: stores bytes uncompressed inside a valid Yaz0 stream, files grow ~12%; add real matching if size matters
function yaz0Store(data) {
  const out = new Uint8Array(16 + data.length + Math.ceil(data.length / 8));
  out.set([0x59, 0x61, 0x7a, 0x30]);
  new DataView(out.buffer).setUint32(4, data.length, false);
  let dst = 16;
  for (let i = 0; i < data.length; i += 8) {
    out[dst++] = 0xff;
    const chunk = data.subarray(i, i + 8);
    out.set(chunk, dst);
    dst += chunk.length;
  }
  return out;
}

const UNNAMED = /^@([0-9a-f]{8})$/;

function sarcHash(name, key) {
  const unnamed = UNNAMED.exec(name);
  if (unnamed) return parseInt(unnamed[1], 16);
  let hash = 0;
  for (const byte of new TextEncoder().encode(name)) hash = (Math.imul(hash, key) + ((byte << 24) >> 24)) >>> 0;
  return hash;
}

function readArchive(input) {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) throw new Error('zstd');
  const yaz0 = sarcMagic(bytes, 0) === 'Yaz0';
  if (yaz0) bytes = yaz0Decompress(bytes);
  if (bytes.length < 0x20 || sarcMagic(bytes, 0) !== 'SARC') throw new Error('not-sarc');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[6] === 0xff && bytes[7] === 0xfe;
  const dataOffset = view.getUint32(0x0c, little);
  const fat = view.getUint16(4, little);
  if (sarcMagic(bytes, fat) !== 'SFAT') throw new Error('not-sarc');
  const count = view.getUint16(fat + 6, little);
  const key = view.getUint32(fat + 8, little);
  const nodes = fat + 12;
  const fnt = nodes + count * 16;
  if (sarcMagic(bytes, fnt) !== 'SFNT') throw new Error('not-sarc');
  const names = fnt + 8;
  const files = [];
  for (let i = 0; i < count; i++) {
    const at = nodes + i * 16;
    const attributes = view.getUint32(at + 4, little);
    const nameAt = names + (attributes & 0xffff) * 4;
    const name = attributes & 0x01000000 ? new TextDecoder().decode(bytes.subarray(nameAt, bytes.indexOf(0, nameAt))) : `@${view.getUint32(at, little).toString(16).padStart(8, '0')}`;
    const start = dataOffset + view.getUint32(at + 8, little);
    const end = dataOffset + view.getUint32(at + 12, little);
    if (end > bytes.length || start > end) throw new Error('truncated');
    files.push({ name, data: bytes.slice(start, end), align: alignOf(start) });
  }
  return { little, yaz0, key, dataAlign: alignOf(dataOffset), files };
}

function alignOf(offset) {
  let align = 4;
  while (align < 0x2000 && offset % (align * 2) === 0) align *= 2;
  return align;
}

function writeArchive({ little, yaz0, key = 0x65, dataAlign, files }) {
  const sorted = files.map((f) => ({ ...f, hash: sarcHash(f.name, key) })).sort((a, b) => a.hash - b.hash);
  const nameBytes = sorted.map((f) => (UNNAMED.test(f.name) ? null : new TextEncoder().encode(f.name)));
  const fntSize = nameBytes.reduce((sum, n) => sum + (n ? (n.length + 4) & ~3 : 0), 0);
  const maxAlign = Math.max(4, ...sorted.map((f) => f.align ?? 4));
  const headerEnd = 0x14 + 12 + sorted.length * 16 + 8 + fntSize;
  const dataOffset = Math.ceil(headerEnd / (dataAlign ?? maxAlign)) * (dataAlign ?? maxAlign);
  const starts = [];
  let at = dataOffset;
  for (const f of sorted) {
    at = Math.ceil(at / (f.align ?? 4)) * (f.align ?? 4);
    starts.push(at);
    at += f.data.length;
  }
  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  out.set([0x53, 0x41, 0x52, 0x43]);
  view.setUint16(4, 0x14, little);
  view.setUint16(6, 0xfeff, little);
  view.setUint32(8, out.length, little);
  view.setUint32(0x0c, dataOffset, little);
  view.setUint16(0x10, 0x0100, little);
  out.set([0x53, 0x46, 0x41, 0x54], 0x14);
  view.setUint16(0x18, 12, little);
  view.setUint16(0x1a, sorted.length, little);
  view.setUint32(0x1c, key, little);
  const fnt = 0x20 + sorted.length * 16;
  out.set([0x53, 0x46, 0x4e, 0x54], fnt);
  view.setUint16(fnt + 4, 8, little);
  let nameAt = 0;
  sorted.forEach((f, i) => {
    const node = 0x20 + i * 16;
    view.setUint32(node, f.hash, little);
    view.setUint32(node + 4, nameBytes[i] ? 0x01000000 | (nameAt / 4) : 0, little);
    view.setUint32(node + 8, starts[i] - dataOffset, little);
    view.setUint32(node + 12, starts[i] - dataOffset + f.data.length, little);
    out.set(f.data, starts[i]);
    if (!nameBytes[i]) return;
    out.set(nameBytes[i], fnt + 8 + nameAt);
    nameAt += (nameBytes[i].length + 4) & ~3;
  });
  return yaz0 ? yaz0Store(out) : out;
}
