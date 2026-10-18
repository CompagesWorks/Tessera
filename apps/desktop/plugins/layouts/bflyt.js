const PANE_TYPES = { pan1: 'pane', pic1: 'picture', txt1: 'text', wnd1: 'window', bnd1: 'bounding', prt1: 'part', ali1: 'alignment', scr1: 'scissor' };

const PANE_FIELDS = [
  ['flags', 'u8', 8],
  ['origin', 'u8', 9],
  ['alpha', 'u8', 10],
  ['partFlags', 'u8', 11],
  ['x', 'f32', 44],
  ['y', 'f32', 48],
  ['z', 'f32', 52],
  ['rotateX', 'f32', 56],
  ['rotateY', 'f32', 60],
  ['rotation', 'f32', 64],
  ['scaleX', 'f32', 68],
  ['scaleY', 'f32', 72],
  ['width', 'f32', 76],
  ['height', 'f32', 80],
];

const TEXT_FIELDS = [
  ['material', 'u16', 0x58],
  ['fontIndex', 'u16', 0x5a],
  ['textAlign', 'u8', 0x5c],
  ['lineAlign', 'u8', 0x5d],
  ['italic', 'f32', 0x60],
  ['topColor', 'rgba', 0x68],
  ['bottomColor', 'rgba', 0x6c],
  ['fontWidth', 'f32', 0x70],
  ['fontHeight', 'f32', 0x74],
  ['charSpace', 'f32', 0x78],
  ['lineSpace', 'f32', 0x7c],
  ['shadowX', 'f32', 0x84],
  ['shadowY', 'f32', 0x88],
  ['shadowWidth', 'f32', 0x8c],
  ['shadowHeight', 'f32', 0x90],
  ['shadowTop', 'rgba', 0x94],
  ['shadowBottom', 'rgba', 0x98],
  ['shadowItalic', 'f32', 0x9c],
];

const QUAD_FIELDS = [
  ['colors.0', 'rgba', 0],
  ['colors.1', 'rgba', 4],
  ['colors.2', 'rgba', 8],
  ['colors.3', 'rgba', 12],
  ['material', 'u16', 16],
];

const WINDOW_FIELDS = [
  ['inflation.0', 'i16', 0x54],
  ['inflation.1', 'i16', 0x56],
  ['inflation.2', 'i16', 0x58],
  ['inflation.3', 'i16', 0x5a],
  ['frameSize.0', 'u16', 0x5c],
  ['frameSize.1', 'u16', 0x5e],
  ['frameSize.2', 'u16', 0x60],
  ['frameSize.3', 'u16', 0x62],
  ['windowFlags', 'u8', 0x65],
];

const MAP_FIELDS = [
  ['texture', 'u16', 0],
  ['flagS', 'u8', 2],
  ['flagT', 'u8', 3],
];

const TRANSFORM_FIELDS = [
  ['x', 'f32', 0],
  ['y', 'f32', 4],
  ['rotation', 'f32', 8],
  ['scaleX', 'f32', 12],
  ['scaleY', 'f32', 16],
];

function bflytCodec(bytes, little) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const get = (type, at) => {
    if (type === 'u8') return bytes[at];
    if (type === 'u16') return view.getUint16(at, little);
    if (type === 'i16') return view.getInt16(at, little);
    if (type === 'u32') return view.getUint32(at, little);
    if (type === 'f32') return view.getFloat32(at, little);
    return [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
  };
  const clamp = (value, max) => Math.min(Math.max(Math.round(value), 0), max);
  const set = (type, at, value) => {
    if (type === 'u8') bytes[at] = clamp(value, 255);
    else if (type === 'u16') view.setUint16(at, clamp(value, 0xffff), little);
    else if (type === 'i16') view.setInt16(at, Math.min(Math.max(Math.round(value), -0x8000), 0x7fff), little);
    else if (type === 'u32') view.setUint32(at, value >>> 0, little);
    else if (type === 'f32') view.setFloat32(at, value, little);
    else bytes.set(value.map((c) => clamp(c, 255)), at);
  };
  const path = (target, key) => {
    const parts = key.split('.');
    const last = parts.pop();
    for (const part of parts) target = target[part];
    return [target, last];
  };
  return {
    get,
    set,
    read(target, base, fields) {
      for (const [key, type, offset] of fields) {
        const [owner, last] = path(target, key);
        owner[last] = get(type, base + offset);
      }
    },
    write(source, base, fields) {
      for (const [key, type, offset] of fields) {
        const [owner, last] = path(source, key);
        set(type, base + offset, owner[last]);
      }
    },
  };
}

function materialLayout(flags, modern) {
  const count = (shift, mask) => (flags >> shift) & mask;
  return {
    maps: count(0, 3) * 4,
    transforms: count(2, 3) * 20,
    texGens: count(4, 3) * (modern ? 16 : 4),
    tev: count(6, 7) * 4,
    alphaCompare: (flags >> 9) & 1 ? 8 : 0,
    blend: (flags >> 10) & 1 ? 4 : 0,
    blendLogic: (flags >> 12) & 1 ? 4 : 0,
    indirect: (flags >> 14) & 1 ? 12 : 0,
    projection: count(15, 3) * 20,
    fontShadow: (flags >> 17) & 1 ? 8 : 0,
    detailedCombiner: (flags >> 19) & 1 ? 28 + count(6, 7) * 16 : 0,
  };
}

function readBflyt(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ascii = (at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
  if (bytes.length < 0x14 || ascii(0, 4) !== 'FLYT') throw new Error('not-bflyt');
  const little = bytes[4] === 0xff && bytes[5] === 0xfe;
  const codec = bflytCodec(bytes, little);
  const { get } = codec;
  const u16 = (at) => get('u16', at);
  const u32 = (at) => get('u32', at);
  const f32 = (at) => get('f32', at);
  const cstring = (at, max = bytes.length) => {
    let end = at;
    while (end < max && bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(at, end));
  };
  const strings = (start, end) => {
    const count = u16(start + 8);
    return Array.from({ length: count }, (_, i) => cstring(start + 12 + u32(start + 12 + i * 4), end));
  };
  const version = u32(8);
  const modern = version >>> 24 >= 8;
  const material = (at, end) => {
    const flags = u32(modern ? at + 0x1c : at + 0x24);
    const colorsAt = modern ? at + 0x24 : at + 0x1c;
    const sizes = materialLayout(flags, modern);
    const offsets = {};
    let cursor = modern ? at + 0x2c : at + 0x28;
    for (const [key, size] of Object.entries(sizes)) {
      offsets[key] = cursor;
      cursor += size;
    }
    const result = { name: cstring(at, at + 0x1c), flags, black: get('rgba', colorsAt), white: get('rgba', colorsAt + 4), colorsAt, offsets, maps: [], transforms: [], tev: [], exact: cursor === end };
    for (let i = 0; i < sizes.maps / 4 && offsets.maps + i * 4 + 4 <= end; i++) {
      const map = {};
      codec.read(map, offsets.maps + i * 4, MAP_FIELDS);
      result.maps.push(map);
    }
    for (let i = 0; i < sizes.transforms / 20 && offsets.transforms + i * 20 + 20 <= end; i++) {
      const transform = {};
      codec.read(transform, offsets.transforms + i * 20, TRANSFORM_FIELDS);
      result.transforms.push(transform);
    }
    if (!result.exact) return result;
    for (let i = 0; i < sizes.tev / 4; i++) result.tev.push({ colorMode: bytes[offsets.tev + i * 4], alphaMode: bytes[offsets.tev + i * 4 + 1] });
    if (sizes.alphaCompare) result.alphaCompare = { mode: bytes[offsets.alphaCompare], value: f32(offsets.alphaCompare + 4) };
    if (sizes.blend) result.blend = { op: bytes[offsets.blend], source: bytes[offsets.blend + 1], dest: bytes[offsets.blend + 2], logic: bytes[offsets.blend + 3] };
    if (sizes.fontShadow) result.fontShadow = { black: get('rgba', offsets.fontShadow), white: get('rgba', offsets.fontShadow + 4) };
    return result;
  };
  const quad = (at, end) => {
    if (at + 0x14 > end) return null;
    const result = { at, colors: [] };
    codec.read(result, at, QUAD_FIELDS);
    result.uvs = bytes[at + 18] > 0 && at + 0x34 <= end ? [0, 1, 2, 3].map((corner) => [f32(at + 20 + corner * 8), f32(at + 24 + corner * 8)]) : null;
    return result;
  };
  const layout = { little, version, width: 0, height: 0, name: '', textures: [], fonts: [], materials: [], root: null, panes: [], controlNames: new Set(), source: bytes.slice() };
  const stack = [];
  let last = null;
  let at = u16(6);
  const total = u16(0x10);
  for (let i = total; i > 0 && at + 8 <= bytes.length; i--) {
    const ordinal = total - i;
    const magic = ascii(at, 4);
    const size = u32(at + 4);
    const end = at + size;
    if (size < 8 || end > bytes.length) throw new Error('truncated');
    if (magic === 'lyt1') {
      layout.width = f32(at + 12);
      layout.height = f32(at + 16);
      layout.name = cstring(at + 28, end);
    } else if (magic === 'txl1') {
      layout.textures = strings(at, end);
      layout.textureCount = layout.textures.length;
    }
    else if (magic === 'fnl1') layout.fonts = strings(at, end);
    else if (magic === 'mat1') {
      const count = u16(at + 8);
      const offsets = Array.from({ length: count }, (_, m) => at + u32(at + 12 + m * 4));
      layout.materials = offsets.map((start, m) => material(start, offsets[m + 1] ?? end));
    } else if (magic === 'cnt1') {
      for (const match of new TextDecoder('latin1').decode(bytes.subarray(at + 8, end)).matchAll(/[ -~]{2,}/g)) layout.controlNames.add(match[0]);
    } else if (magic === 'pas1') {
      if (last) stack.push(last);
    } else if (magic === 'pae1') {
      last = stack.pop() ?? null;
    } else if (PANE_TYPES[magic]) {
      const pane = { at, size, ordinal, type: PANE_TYPES[magic], name: cstring(at + 12, at + 36), children: [] };
      codec.read(pane, at, PANE_FIELDS);
      pane.visible = (pane.flags & 1) === 1;
      pane.influenceAlpha = (pane.flags & 2) === 2;
      if (magic === 'pic1') pane.picture = quad(at + 0x54, end);
      if (magic === 'txt1' && end >= at + 0xa0) {
        codec.read(pane, at, TEXT_FIELDS);
        pane.font = layout.fonts[pane.fontIndex];
        pane.textCapacity = u16(at + 0x56);
        pane.textOffset = u32(at + 0x64);
        const nameOffset = u32(at + 0x80);
        pane.textId = nameOffset ? cstring(at + nameOffset, end) : '';
        let text = '';
        for (let c = at + pane.textOffset; pane.textOffset && c + 1 < Math.min(end, at + pane.textOffset + pane.textCapacity); c += 2) {
          const unit = u16(c);
          if (unit === 0) break;
          text += String.fromCharCode(unit);
        }
        pane.text = text;
        pane.originalText = text;
      }
      if (magic === 'wnd1' && end >= at + 0x70) {
        const win = { inflation: [], frameSize: [] };
        codec.read(win, at, WINDOW_FIELDS);
        win.kind = (win.windowFlags >> 2) & 3;
        win.content = quad(at + u32(at + 0x68), end);
        const table = at + u32(at + 0x6c);
        win.frames = Array.from({ length: bytes[at + 0x64] }, (_, f) => {
          const frameAt = at + u32(table + f * 4);
          return { at: frameAt, material: u16(frameAt), flip: bytes[frameAt + 2] };
        });
        pane.window = win;
      }
      if (magic === 'prt1' && end > at + 0x60) {
        pane.partScale = [f32(at + 0x58), f32(at + 0x5c)];
        pane.part = cstring(at + 0x60 + u32(at + 0x54) * 0x28, end);
      }
      layout.panes.push(pane);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(pane);
      else if (!layout.root) layout.root = pane;
      last = pane;
    }
    at = end;
  }
  return layout;
}

function resizeText(out, pane, little) {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const encoded = new Uint8Array(pane.text.length * 2 + 2);
  const textView = new DataView(encoded.buffer);
  for (let i = 0; i < pane.text.length; i++) textView.setUint16(i * 2, pane.text.charCodeAt(i), little);
  const start = pane.at + pane.textOffset;
  if (encoded.length <= pane.textCapacity) {
    out.fill(0, start, start + pane.textCapacity);
    out.set(encoded, start);
    view.setUint16(pane.at + 0x54, encoded.length, little);
    return out;
  }
  const align = (value) => (value + 3) & ~3;
  const oldEnd = align(pane.textOffset + pane.textCapacity);
  const newEnd = align(pane.textOffset + encoded.length);
  const delta = newEnd - oldEnd;
  const grown = new Uint8Array(out.length + delta);
  grown.set(out.subarray(0, start));
  grown.set(encoded, start);
  grown.set(out.subarray(pane.at + oldEnd), pane.at + newEnd);
  const grownView = new DataView(grown.buffer);
  grownView.setUint32(pane.at + 4, pane.size + delta, little);
  grownView.setUint16(pane.at + 0x54, encoded.length, little);
  grownView.setUint16(pane.at + 0x56, encoded.length, little);
  for (const field of [0x80, 0xa0]) {
    if (field + 4 > pane.textOffset) continue;
    const offset = grownView.getUint32(pane.at + field, little);
    if (offset >= oldEnd) grownView.setUint32(pane.at + field, offset + delta, little);
  }
  return grown;
}

function writeBflyt(layout) {
  let out = layout.source.slice();
  const codec = bflytCodec(out, layout.little);
  for (const pane of layout.panes) {
    const name = new TextEncoder().encode(pane.name);
    if (name.length > 24) throw new Error('name-too-long');
    pane.flags = (pane.flags & ~3) | (pane.visible ? 1 : 0) | (pane.influenceAlpha ? 2 : 0);
    codec.write(pane, pane.at, PANE_FIELDS);
    out.fill(0, pane.at + 12, pane.at + 36);
    out.set(name, pane.at + 12);
    for (const quad of [pane.picture, pane.window?.content]) {
      if (!quad) continue;
      codec.write(quad, quad.at, QUAD_FIELDS);
      quad.uvs?.forEach(([u, v], corner) => {
        codec.set('f32', quad.at + 20 + corner * 8, u);
        codec.set('f32', quad.at + 24 + corner * 8, v);
      });
    }
    if (pane.type === 'text' && pane.textOffset !== undefined) codec.write(pane, pane.at, TEXT_FIELDS);
    if (pane.window) {
      pane.window.windowFlags = (pane.window.windowFlags & ~0x0c) | ((pane.window.kind & 3) << 2);
      codec.write(pane.window, pane.at, WINDOW_FIELDS);
      for (const frame of pane.window.frames) {
        codec.set('u16', frame.at, frame.material);
        codec.set('u8', frame.at + 2, frame.flip);
      }
    }
    if (pane.partScale) {
      codec.set('f32', pane.at + 0x58, pane.partScale[0]);
      codec.set('f32', pane.at + 0x5c, pane.partScale[1]);
    }
  }
  for (const material of layout.materials) {
    codec.set('rgba', material.colorsAt, material.black);
    codec.set('rgba', material.colorsAt + 4, material.white);
    material.maps.forEach((map, i) => codec.write(map, material.offsets.maps + i * 4, MAP_FIELDS));
    material.transforms.forEach((transform, i) => codec.write(transform, material.offsets.transforms + i * 20, TRANSFORM_FIELDS));
    if (!material.exact) continue;
    material.tev.forEach((stage, i) => {
      codec.set('u8', material.offsets.tev + i * 4, stage.colorMode);
      codec.set('u8', material.offsets.tev + i * 4 + 1, stage.alphaMode);
    });
    if (material.alphaCompare) {
      codec.set('u8', material.offsets.alphaCompare, material.alphaCompare.mode);
      codec.set('f32', material.offsets.alphaCompare + 4, material.alphaCompare.value);
    }
    if (material.blend) ['op', 'source', 'dest', 'logic'].forEach((key, i) => codec.set('u8', material.offsets.blend + i, material.blend[key]));
    if (material.fontShadow) {
      codec.set('rgba', material.offsets.fontShadow, material.fontShadow.black);
      codec.set('rgba', material.offsets.fontShadow + 4, material.fontShadow.white);
    }
  }
  const resized = layout.panes.filter((pane) => !pane.removed && pane.type === 'text' && pane.text !== pane.originalText);
  if (resized.some((pane) => !pane.textOffset)) throw new Error('no-text-buffer');
  for (const pane of resized.sort((a, b) => b.at - a.at)) out = resizeText(out, pane, layout.little);
  if (layout.panes.some((pane) => pane.removed)) out = removePanes(out, layout);
  if (layout.textures.length !== (layout.textureCount ?? 0)) out = rebuildTextureList(out, layout);
  new DataView(out.buffer).setUint32(0x0c, out.length, layout.little);
  return out;
}

function removePanes(bytes, layout) {
  const little = layout.little;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections = [];
  let at = view.getUint16(6, little);
  for (let i = view.getUint16(0x10, little); i > 0; i--) {
    const size = view.getUint32(at + 4, little);
    sections.push({ magic: String.fromCharCode(...bytes.subarray(at, at + 4)), at, size });
    at += size;
  }
  const dropped = new Set();
  for (const pane of layout.panes.filter((item) => item.removed)) {
    let k = pane.ordinal;
    dropped.add(k);
    if (sections[k + 1]?.magic === 'usd1') dropped.add(++k);
    if (sections[k + 1]?.magic !== 'pas1') continue;
    let depth = 0;
    for (k += 1; k < sections.length; k++) {
      dropped.add(k);
      if (sections[k].magic === 'pas1') depth++;
      if (sections[k].magic === 'pae1' && --depth === 0) break;
    }
  }
  const names = new Set(layout.panes.filter((pane) => dropped.has(pane.ordinal)).map((pane) => pane.name));
  const nameLength = layout.version >>> 24 >= 8 ? 0x22 : 0x10;
  const parts = [bytes.subarray(0, sections[0].at)];
  for (const [k, section] of sections.entries()) {
    if (dropped.has(k)) continue;
    const chunk = bytes.subarray(section.at, section.at + section.size);
    if (section.magic !== 'grp1') {
      parts.push(chunk);
      continue;
    }
    const countAt = 8 + nameLength;
    const count = new DataView(chunk.buffer, chunk.byteOffset).getUint16(countAt, little);
    const kept = [];
    for (let i = 0; i < count; i++) {
      const entry = chunk.subarray(countAt + 2 + i * 24, countAt + 2 + (i + 1) * 24);
      const end = entry.indexOf(0);
      if (!names.has(new TextDecoder().decode(entry.subarray(0, end < 0 ? 24 : end)))) kept.push(entry);
    }
    const rebuilt = new Uint8Array(chunk.length - (count - kept.length) * 24);
    rebuilt.set(chunk.subarray(0, countAt + 2));
    kept.forEach((entry, i) => rebuilt.set(entry, countAt + 2 + i * 24));
    rebuilt.set(chunk.subarray(countAt + 2 + count * 24), countAt + 2 + kept.length * 24);
    const rebuiltView = new DataView(rebuilt.buffer);
    rebuiltView.setUint32(4, rebuilt.length, little);
    rebuiltView.setUint16(countAt, kept.length, little);
    parts.push(rebuilt);
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  new DataView(out.buffer).setUint16(0x10, sections.length - dropped.size, little);
  return out;
}

function rebuildTextureList(bytes, layout) {
  const little = layout.little;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = view.getUint16(6, little);
  for (let i = view.getUint16(0x10, little); i > 0; i--) {
    const size = view.getUint32(at + 4, little);
    if (String.fromCharCode(...bytes.subarray(at, at + 4)) === 'txl1') {
      const names = layout.textures.map((name) => new TextEncoder().encode(name));
      const table = names.length * 4;
      const body = names.reduce((sum, name) => sum + name.length + 1, 0);
      const section = new Uint8Array((12 + table + body + 3) & ~3);
      const sectionView = new DataView(section.buffer);
      section.set(bytes.subarray(at, at + 12));
      sectionView.setUint32(4, section.length, little);
      sectionView.setUint16(8, names.length, little);
      let cursor = table;
      names.forEach((name, index) => {
        sectionView.setUint32(12 + index * 4, cursor, little);
        section.set(name, 12 + cursor);
        cursor += name.length + 1;
      });
      const out = new Uint8Array(bytes.length - size + section.length);
      out.set(bytes.subarray(0, at));
      out.set(section, at);
      out.set(bytes.subarray(at + size), at + section.length);
      return out;
    }
    at += size;
  }
  throw new Error('no-texture-list');
}
