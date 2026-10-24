const PRC_MAGIC = 'paracobn';
const PRC_TYPES = [null, 'bool', 'i8', 'u8', 'i16', 'u16', 'i32', 'u32', 'float', 'hash40', 'string', 'list', 'struct'];
const PRC_RANGES = { i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535], i32: [-(2 ** 31), 2 ** 31 - 1], u32: [0, 2 ** 32 - 1] };
const PRC_CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function hash40(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0 || bytes.length > 255) throw new Error('invalid-value');
  let crc = ~0;
  for (const b of bytes) crc = PRC_CRC[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return bytes.length * 2 ** 32 + ((~crc) >>> 0);
}

function parsePrc(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x10 || String.fromCharCode(...bytes.subarray(0, 8)) !== PRC_MAGIC) throw new Error('not-prc');
  const refStart = 0x10 + view.getUint32(8, true);
  const dataStart = refStart + view.getUint32(12, true);
  if (dataStart >= bytes.length) throw new Error('truncated');
  const hashes = [];
  for (let at = 0x10; at + 8 <= refStart; at += 8) hashes.push(Number(view.getBigUint64(at, true)));
  const hash = (index) => {
    if (index >= hashes.length) throw new Error('truncated');
    return hashes[index];
  };
  const read = (at, depth) => {
    if (depth > 64) throw new Error('truncated');
    const type = PRC_TYPES[bytes[at]];
    switch (type) {
      case 'bool': return { type, value: bytes[at + 1] !== 0 };
      case 'i8': return { type, value: view.getInt8(at + 1) };
      case 'u8': return { type, value: view.getUint8(at + 1) };
      case 'i16': return { type, value: view.getInt16(at + 1, true) };
      case 'u16': return { type, value: view.getUint16(at + 1, true) };
      case 'i32': return { type, value: view.getInt32(at + 1, true) };
      case 'u32': return { type, value: view.getUint32(at + 1, true) };
      case 'float': return { type, value: view.getFloat32(at + 1, true) };
      case 'hash40': return { type, value: hash(view.getUint32(at + 1, true)) };
      case 'string': {
        const start = refStart + view.getUint32(at + 1, true);
        const end = bytes.indexOf(0, start);
        if (end < 0 || end >= dataStart) throw new Error('truncated');
        return { type, value: new TextDecoder().decode(bytes.subarray(start, end)) };
      }
      case 'list': {
        const children = [];
        for (let i = 0, count = view.getUint32(at + 1, true); i < count; i++) children.push(read(at + view.getUint32(at + 5 + i * 4, true), depth + 1));
        return { type, children };
      }
      case 'struct': {
        const ref = refStart + view.getUint32(at + 5, true);
        const children = [];
        for (let i = 0, count = view.getUint32(at + 1, true); i < count; i++) {
          children.push({ hash: hash(view.getUint32(ref + i * 8, true)), param: read(at + view.getUint32(ref + i * 8 + 4, true), depth + 1) });
        }
        return { type, children };
      }
      default: throw new Error('truncated');
    }
  };
  try {
    const root = read(dataStart, 0);
    if (root.type !== 'struct') throw new Error('not-prc');
    return root;
  } catch (error) {
    throw error instanceof RangeError ? new Error('truncated') : error;
  }
}

function writePrc(root) {
  const hashes = [0];
  const hashIndex = new Map([[0, 0]]);
  const indexOf = (h) => {
    if (!hashIndex.has(h)) hashIndex.set(h, hashes.push(h) - 1);
    return hashIndex.get(h);
  };
  const refs = [];
  const refOffsets = new Map();
  let refSize = 0;
  const ref = (key, chunk) => {
    if (!refOffsets.has(key)) {
      refOffsets.set(key, refSize);
      refs.push(chunk);
      refSize += chunk.length;
    }
    return refOffsets.get(key);
  };
  const chunks = [];
  let size = 0;
  const out = (length) => {
    const chunk = new Uint8Array(length);
    chunks.push(chunk);
    size += length;
    return new DataView(chunk.buffer);
  };
  const write = (node) => {
    const start = size;
    const type = PRC_TYPES.indexOf(node.type);
    if (node.type === 'list') {
      const v = out(5 + node.children.length * 4);
      v.setUint8(0, type);
      v.setUint32(1, node.children.length, true);
      node.children.forEach((child, i) => {
        v.setUint32(5 + i * 4, size - start, true);
        write(child);
      });
      return;
    }
    if (node.type === 'struct') {
      const sorted = [...node.children].sort((a, b) => a.hash - b.hash);
      const v = out(9);
      v.setUint8(0, type);
      v.setUint32(1, sorted.length, true);
      const pairs = new Uint8Array(sorted.length * 8);
      const p = new DataView(pairs.buffer);
      for (const [i, child] of sorted.entries()) {
        p.setUint32(i * 8, indexOf(child.hash), true);
        p.setUint32(i * 8 + 4, size - start, true);
        write(child.param);
      }
      v.setUint32(5, ref(`s${pairs.join(',')}`, pairs), true);
      return;
    }
    const v = out(node.type === 'bool' || node.type === 'i8' || node.type === 'u8' ? 2 : node.type === 'i16' || node.type === 'u16' ? 3 : 5);
    v.setUint8(0, type);
    switch (node.type) {
      case 'bool': return v.setUint8(1, node.value ? 1 : 0);
      case 'i8': return v.setInt8(1, node.value);
      case 'u8': return v.setUint8(1, node.value);
      case 'i16': return v.setInt16(1, node.value, true);
      case 'u16': return v.setUint16(1, node.value, true);
      case 'i32': return v.setInt32(1, node.value, true);
      case 'u32': return v.setUint32(1, node.value, true);
      case 'float': return v.setFloat32(1, node.value, true);
      case 'hash40': return v.setUint32(1, indexOf(node.value), true);
      case 'string': {
        const text = new TextEncoder().encode(node.value);
        const chunk = new Uint8Array(text.length + 1);
        chunk.set(text);
        return v.setUint32(1, ref(`t${node.value}`, chunk), true);
      }
      default: throw new Error('invalid-value');
    }
  };
  write(root);
  const bytes = new Uint8Array(0x10 + hashes.length * 8 + refSize + size);
  const view = new DataView(bytes.buffer);
  bytes.set([...PRC_MAGIC].map((c) => c.charCodeAt(0)));
  view.setUint32(8, hashes.length * 8, true);
  view.setUint32(12, refSize, true);
  hashes.forEach((h, i) => view.setBigUint64(0x10 + i * 8, BigInt(h), true));
  let at = 0x10 + hashes.length * 8;
  for (const chunk of [...refs, ...chunks]) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

function prcValue(type, text) {
  const trimmed = text.trim();
  if (type === 'string') {
    if (text.includes('\0')) throw new Error('invalid-value');
    return text;
  }
  if (type === 'float') {
    const value = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(value)) throw new Error('invalid-value');
    return Math.fround(value);
  }
  if (type === 'hash40') return /^0x[0-9a-f]{1,10}$/i.test(trimmed) ? parseInt(trimmed, 16) : hash40(trimmed);
  const range = PRC_RANGES[type];
  const value = Number(trimmed);
  if (!range || !/^-?\d+$/.test(trimmed) || value < range[0] || value > range[1]) throw new Error('invalid-value');
  return value;
}
