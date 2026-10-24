function nus3Ascii(bytes, at, length) {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function parseNus3audio(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || nus3Ascii(bytes, 0, 4) !== 'NUS3') throw new Error('not-nus3audio');
  const sections = {};
  for (let at = 8; at + 8 <= bytes.length; ) {
    let magic = nus3Ascii(bytes, at, 4);
    if (magic === 'AUDI') {
      magic = nus3Ascii(bytes, at, 8);
      at += 4;
    }
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > bytes.length) throw new Error('truncated');
    sections[magic] = at + 8;
    at += 8 + size;
  }
  if (!['AUDIINDX', 'TNID', 'NMOF', 'ADOF'].every((magic) => magic in sections)) throw new Error('not-nus3audio');
  const count = view.getUint32(sections.AUDIINDX, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    const id = view.getUint32(sections.TNID + i * 4, true);
    let name = view.getUint32(sections.NMOF + i * 4, true);
    const end = bytes.indexOf(0, name);
    const offset = view.getUint32(sections.ADOF + i * 8, true);
    const size = view.getUint32(sections.ADOF + i * 8 + 4, true);
    if (end < 0 || offset + size > bytes.length) throw new Error('truncated');
    name = new TextDecoder().decode(bytes.subarray(name, end));
    files.push({ id, name, data: bytes.slice(offset, offset + size) });
  }
  return { files };
}

function writeNus3audio({ files }) {
  const names = files.map((file) => new TextEncoder().encode(file.name));
  const count = files.length;
  const stringsStart = 8 + 16 + (8 + count * 4) * 2 + (8 + count * 8) + 8;
  const stringsSize = names.reduce((sum, name) => sum + name.length + 1, 0);
  const junkStart = stringsStart + stringsSize;
  const junkSize = (16 - ((junkStart + 16) % 16)) % 16;
  const packStart = junkStart + 8 + junkSize + 8;
  const padded = (length) => Math.ceil(length / 16) * 16;
  const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
  const unique = [];
  const offsets = [];
  let packSize = 0;
  for (const file of files) {
    let found = unique.find((entry) => same(entry.data, file.data));
    if (!found) {
      found = { data: file.data, offset: packStart + packSize };
      unique.push(found);
      packSize += padded(file.data.length);
    }
    offsets.push(found.offset);
  }
  const out = new Uint8Array(packStart + packSize);
  const view = new DataView(out.buffer);
  let at = 0;
  const magic = (text) => {
    for (let i = 0; i < text.length; i++) out[at++] = text.charCodeAt(i);
  };
  const u32 = (value) => {
    view.setUint32(at, value, true);
    at += 4;
  };
  magic('NUS3');
  u32(out.length - 8);
  magic('AUDIINDX');
  u32(4);
  u32(count);
  magic('TNID');
  u32(count * 4);
  files.forEach((file) => u32(file.id));
  magic('NMOF');
  u32(count * 4);
  let name = stringsStart;
  names.forEach((bytes) => {
    u32(name);
    name += bytes.length + 1;
  });
  magic('ADOF');
  u32(count * 8);
  files.forEach((file, i) => {
    u32(offsets[i]);
    u32(file.data.length);
  });
  magic('TNNM');
  u32(stringsSize);
  names.forEach((bytes) => {
    out.set(bytes, at);
    at += bytes.length + 1;
  });
  magic('JUNK');
  u32(junkSize);
  at += junkSize;
  magic('PACK');
  u32(packSize);
  unique.forEach((entry) => out.set(entry.data, entry.offset));
  return out;
}

function nus3Format(data) {
  if (data.length === 0) return 'empty';
  if (data[0] === 0x01 && data[1] === 0x00 && data[2] === 0x00 && data[3] === 0x80) return 'lopus';
  if (nus3Ascii(data, 0, 4) === 'IDSP') return 'idsp';
  return 'bin';
}

function pcm16Wav(channels, rate) {
  const frames = channels[0]?.length ?? 0;
  const size = frames * channels.length * 2;
  const out = new Uint8Array(44 + size);
  const view = new DataView(out.buffer);
  const text = (at, value) => [...value].forEach((char, i) => (out[at + i] = char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + size, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, size, true);
  let at = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      view.setInt16(at, Math.round(Math.max(-1, Math.min(1, channel[frame])) * 32767), true);
      at += 2;
    }
  }
  return out;
}
