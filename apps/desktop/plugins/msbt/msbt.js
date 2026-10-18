const MSBT_MAGIC = 'MsgStdBn';

function msbtAscii(bytes, at, length) {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function parseMsbt(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x20 || msbtAscii(bytes, 0, 8) !== MSBT_MAGIC) throw new Error('not-msbt');
  const little = bytes[8] === 0xff && bytes[9] === 0xfe;
  const encoding = bytes[0x0c];
  if (encoding !== 1) throw new Error('unsupported-encoding');
  const header = bytes.slice(0, 0x20);
  const sections = [];
  let at = 0x20;
  for (let i = view.getUint16(0x0e, little); i > 0 && at + 16 <= bytes.length; i--) {
    const magic = msbtAscii(bytes, at, 4);
    const size = view.getUint32(at + 4, little);
    if (at + 16 + size > bytes.length) throw new Error('truncated');
    sections.push({ magic, data: bytes.slice(at + 16, at + 16 + size) });
    at += 16 + size + ((16 - (size % 16)) % 16);
  }
  const lbl = sections.find((s) => s.magic === 'LBL1');
  const txt = sections.find((s) => s.magic === 'TXT2');
  if (!txt) throw new Error('no-text');
  const texts = readTexts(txt.data, little);
  const labels = lbl ? readLabels(lbl.data, little) : [];
  const entries = texts.map((text, index) => ({ index, label: labels[index] ?? String(index), text }));
  if (labels.length > 0) entries.sort((a, b) => a.label.localeCompare(b.label));
  return { little, header, sections, entries };
}

function readLabels(data, little) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const labels = [];
  for (let group = 0, groups = view.getUint32(0, little); group < groups; group++) {
    let count = view.getUint32(4 + group * 8, little);
    let at = view.getUint32(8 + group * 8, little);
    for (; count > 0; count--) {
      const length = data[at];
      const name = new TextDecoder().decode(data.subarray(at + 1, at + 1 + length));
      labels[view.getUint32(at + 1 + length, little)] = name;
      at += 5 + length;
    }
  }
  return labels;
}

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readTexts(data, little) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, little);
  const texts = [];
  for (let i = 0; i < count; i++) {
    const end = i + 1 < count ? view.getUint32(8 + i * 4, little) : data.length;
    let at = view.getUint32(4 + i * 4, little);
    let text = '';
    while (at + 1 < end) {
      const unit = view.getUint16(at, little);
      at += 2;
      if (unit === 0) break;
      if (unit === 0x0e) {
        const group = view.getUint16(at, little);
        const type = view.getUint16(at + 2, little);
        const size = view.getUint16(at + 4, little);
        const params = data.subarray(at + 6, at + 6 + size);
        at += 6 + size;
        text += `[${group}.${type}${size ? ':' + hex(params) : ''}]`;
      } else if (unit === 0x0f) {
        text += `[/${view.getUint16(at, little)}.${view.getUint16(at + 2, little)}]`;
        at += 4;
      } else if (unit === 0x5b) {
        text += '[[';
      } else {
        text += String.fromCharCode(unit);
      }
    }
    texts.push(text);
  }
  return texts;
}

function encodeText(text, little) {
  const out = [];
  const push = (...units) => {
    for (const unit of units) out.push(little ? unit & 0xff : unit >> 8, little ? unit >> 8 : unit & 0xff);
  };
  const tag = /^\[(\/?)(\d+)\.(\d+)(?::([0-9a-fA-F]*))?\]/;
  for (let i = 0; i < text.length; ) {
    if (text.startsWith('[[', i)) {
      push(0x5b);
      i += 2;
      continue;
    }
    const match = text[i] === '[' ? tag.exec(text.slice(i)) : null;
    if (!match) {
      push(text.charCodeAt(i));
      i += 1;
      continue;
    }
    const [whole, close, group, type, params = ''] = match;
    if (params.length % 2) throw new Error(`bad-tag:${whole}`);
    if (close) push(0x0f, +group, +type);
    else {
      push(0x0e, +group, +type, params.length / 2);
      for (let p = 0; p < params.length; p += 2) out.push(parseInt(params.slice(p, p + 2), 16));
    }
    i += whole.length;
  }
  push(0);
  return out;
}

function writeMsbt(file, edits) {
  const { little } = file;
  const texts = [];
  for (const entry of file.entries) texts[entry.index] = edits?.get(entry.index) ?? entry.text;
  const encoded = texts.map((text) => encodeText(text, little));
  const txtSize = 4 + encoded.length * 4 + encoded.reduce((sum, e) => sum + e.length, 0);
  const txt = new Uint8Array(txtSize);
  const txtView = new DataView(txt.buffer);
  txtView.setUint32(0, encoded.length, little);
  let at = 4 + encoded.length * 4;
  encoded.forEach((units, i) => {
    txtView.setUint32(4 + i * 4, at, little);
    txt.set(units, at);
    at += units.length;
  });
  const sections = file.sections.map((s) => (s.magic === 'TXT2' ? { magic: s.magic, data: txt } : s));
  const total = 0x20 + sections.reduce((sum, s) => sum + 16 + s.data.length + ((16 - (s.data.length % 16)) % 16), 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(file.header);
  view.setUint32(0x12, total, little);
  at = 0x20;
  for (const s of sections) {
    for (let c = 0; c < 4; c++) out[at + c] = s.magic.charCodeAt(c);
    view.setUint32(at + 4, s.data.length, little);
    out.set(s.data, at + 16);
    at += 16 + s.data.length;
    while (at % 16) out[at++] = 0xab;
  }
  return out;
}

function parseXmsbt(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const source = new TextDecoder(encoding).decode(bytes);
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'xmsbt') throw new Error('not-xmsbt');
  const nodes = [...doc.documentElement.children].filter((node) => node.nodeName === 'entry');
  const entries = nodes.map((node, index) => ({ index, label: node.getAttribute('label') ?? String(index), text: node.querySelector('text')?.textContent ?? '' }));
  return { xml: true, encoding, declaration: /^\s*<\?xml[^>]*\?>/.exec(source)?.[0] ?? '', doc, nodes, entries };
}

function writeXmsbt(file, edits) {
  for (const [index, text] of edits ?? []) {
    const node = file.nodes[index];
    let target = node.querySelector('text');
    if (!target) target = node.appendChild(file.doc.createElement('text'));
    target.textContent = text;
  }
  const body = new XMLSerializer().serializeToString(file.doc).replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  const text = file.declaration ? `${file.declaration}\n${body}` : body;
  if (file.encoding === 'utf-8') return new TextEncoder().encode(text);
  const out = new Uint8Array(2 + text.length * 2);
  const view = new DataView(out.buffer);
  const little = file.encoding === 'utf-16le';
  view.setUint16(0, 0xfeff, little);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), little);
  return out;
}
