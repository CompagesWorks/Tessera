const ANCHOR = [0.5, 0, 1];
const MAX_RASTER = 256;
const textures = new Map();
const rasters = new Map();

function rect(pane) {
  const ox = ANCHOR[pane.origin & 3] ?? 0.5;
  const oy = ANCHOR[(pane.origin >> 2) & 3] ?? 0.5;
  return { x: -ox * pane.width, y: -(1 - oy) * pane.height, w: pane.width, h: pane.height };
}

async function decodeTexture(preview) {
  const image = new Image();
  image.src = `data:image/png;base64,${preview.data}`;
  await image.decode();
  const surface = document.createElement('canvas');
  surface.width = image.naturalWidth;
  surface.height = image.naturalHeight;
  const ctx = surface.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  return { width: surface.width, height: surface.height, data: ctx.getImageData(0, 0, surface.width, surface.height).data, url: image.src, size: [preview.width, preview.height], format: preview.format };
}

async function loadTextures(names, folder, onLoaded) {
  const files = (await tessera.files.list(folder).catch(() => [])).filter((entry) => /\.bntx$/i.test(entry.name));
  files.sort((a, b) => Number(b.name.startsWith('__Combined')) - Number(a.name.startsWith('__Combined')));
  for (const name of names) {
    if (textures.has(name)) continue;
    textures.set(name, null);
    const own = files.find((entry) => entry.name.toLowerCase() === `${name.toLowerCase()}.bntx`);
    const tries = own ? [[own.path, undefined]] : files.map((entry) => [entry.path, name]);
    for (const [file, texture] of tries) {
      try {
        textures.set(name, { ...(await decodeTexture(await tessera.textures.preview(file, texture))), file, texture });
        rasters.clear();
        onLoaded();
        break;
      } catch {}
    }
  }
}

function wrap(value, mode) {
  if (mode === 1) return value - Math.floor(value);
  if (mode === 2) {
    const m = value - 2 * Math.floor(value / 2);
    return m > 1 ? 2 - m : m;
  }
  return Math.min(Math.max(value, 0), 1);
}

function sampler(material) {
  const map = material?.maps[0];
  const texture = map && textures.get(material.textureNames[map.texture]);
  const black = material?.black ?? [0, 0, 0, 0];
  const white = material?.white ?? [255, 255, 255, 255];
  const srt = material?.transforms[0];
  return (u, v, out) => {
    if (!texture) {
      out[0] = white[0];
      out[1] = white[1];
      out[2] = white[2];
      out[3] = white[3];
      return;
    }
    if (srt) {
      u = (u - 0.5) * srt.scaleX + 0.5 + srt.x;
      v = (v - 0.5) * srt.scaleY + 0.5 - srt.y;
    }
    const x = Math.min(Math.floor(wrap(u, map.flagS & 3) * texture.width), texture.width - 1);
    const y = Math.min(Math.floor(wrap(v, map.flagT & 3) * texture.height), texture.height - 1);
    const i = (y * texture.width + x) * 4;
    for (let c = 0; c < 4; c++) out[c] = black[c] + ((white[c] - black[c]) * texture.data[i + c]) / 255;
  };
}

function lerp4(a, b, t) {
  return [0, 1, 2, 3].map((c) => a[c] + (b[c] - a[c]) * t);
}

function raster(key, w, h, material, uvAt, colors) {
  key = `${key}:${colors}:${material?.black}:${material?.white}`;
  if (rasters.size > 512) rasters.clear();
  if (rasters.has(key)) return rasters.get(key);
  const scale = Math.min(1, MAX_RASTER / Math.max(Math.abs(w), Math.abs(h), 1));
  const cw = Math.max(1, Math.round(Math.abs(w) * scale));
  const ch = Math.max(1, Math.round(Math.abs(h) * scale));
  const surface = document.createElement('canvas');
  surface.width = cw;
  surface.height = ch;
  const ctx = surface.getContext('2d');
  const image = ctx.createImageData(cw, ch);
  const sample = sampler(material);
  const texel = [0, 0, 0, 0];
  for (let y = 0; y < ch; y++) {
    const t = (y + 0.5) / ch;
    const left = colors && lerp4(colors[0], colors[2], t);
    const right = colors && lerp4(colors[1], colors[3], t);
    for (let x = 0; x < cw; x++) {
      const s = (x + 0.5) / cw;
      const [u, v] = uvAt(s, t);
      sample(u, v, texel);
      const i = (y * cw + x) * 4;
      for (let c = 0; c < 4; c++) image.data[i + c] = colors ? (texel[c] * (left[c] + (right[c] - left[c]) * s)) / 255 : texel[c];
    }
  }
  ctx.putImageData(image, 0, 0);
  rasters.set(key, surface);
  return surface;
}

function quadUv(uvs) {
  if (!uvs) return (s, t) => [s, t];
  return (s, t) => {
    const top = [uvs[0][0] + (uvs[1][0] - uvs[0][0]) * s, uvs[0][1] + (uvs[1][1] - uvs[0][1]) * s];
    const bottom = [uvs[2][0] + (uvs[3][0] - uvs[2][0]) * s, uvs[2][1] + (uvs[3][1] - uvs[2][1]) * s];
    return [top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t];
  };
}

function blit(ctx, surface, x0, top, w, h) {
  ctx.save();
  ctx.translate(x0, top);
  ctx.scale(1, -1);
  ctx.drawImage(surface, 0, 0, w, h);
  ctx.restore();
}

function frameUv(flip, s0, s1, t0, t1) {
  return (s, t) => {
    let u = s0 + (s1 - s0) * s;
    let v = t0 + (t1 - t0) * t;
    if (flip === 1 || flip === 4) u = 1 - u;
    if (flip === 2 || flip === 4) v = 1 - v;
    return [u, v];
  };
}

function drawWindow(ctx, pane, r, owner, id) {
  const { window: win } = pane;
  const [fl, fr, ft, fb] = win.frameSize;
  const top = r.y + r.h;
  const material = (index) => owner.materials[index];
  const frames = win.frames;
  if (win.kind !== 2 && win.content) {
    const [il, ir, it, ib] = win.inflation;
    const x0 = r.x + (win.kind === 1 ? fl : fl) - il;
    const x1 = r.x + r.w - fr + ir;
    const y1 = top - (win.kind === 1 ? 0 : ft) + it;
    const y0 = r.y + (win.kind === 1 ? 0 : fb) - ib;
    blit(ctx, raster(`${id}:c`, x1 - x0, y1 - y0, material(win.content.material), quadUv(win.content.uvs), win.content.colors), x0, y1, x1 - x0, y1 - y0);
  }
  if (!frames.length) return;
  const pick = (i, implicit) => (frames.length === 1 ? { material: frames[0].material, flip: implicit } : frames[i] ?? frames[0]);
  if (win.kind === 1 || win.kind === 2) {
    const left = pick(0, 0);
    const right = pick(1, 1);
    const span = r.w - fr;
    blit(ctx, raster(`${id}:l`, span, r.h, material(left.material), frameUv(left.flip, 0, span / fl, 0, 1)), r.x, top, span, r.h);
    blit(ctx, raster(`${id}:r`, fr, r.h, material(right.material), frameUv(right.flip, 0, 1, 0, 1)), r.x + span, top, fr, r.h);
    return;
  }
  const corners = [
    [pick(0, 0), r.x, top, r.w - fr, ft, 0, (r.w - fr) / fl, 0, 1],
    [pick(1, 1), r.x + r.w - fr, top, fr, r.h - fb, 0, 1, 0, (r.h - fb) / ft],
    [pick(3, 4), r.x + fl, r.y + fb, r.w - fl, fb, 1 - (r.w - fl) / fr, 1, 0, 1],
    [pick(2, 2), r.x, top - ft, fl, r.h - ft, 0, 1, 1 - (r.h - ft) / fb, 1],
  ];
  corners.forEach(([frame, x, y, w, h, s0, s1, t0, t1], i) => {
    if (w > 0 && h > 0) blit(ctx, raster(`${id}:f${i}`, w, h, material(frame.material), frameUv(frame.flip, s0, s1, t0, t1)), x, y, w, h);
  });
}

function drawPane(ctx, entry, id) {
  const { pane, owner } = entry;
  const r = rect(pane);
  if (pane.type === 'picture' && pane.picture) {
    const quad = pane.picture;
    blit(ctx, raster(id, r.w, r.h, owner.materials[quad.material], quadUv(quad.uvs), quad.colors), r.x, r.y + r.h, r.w, r.h);
  } else if (pane.type === 'window' && pane.window) {
    drawWindow(ctx, pane, r, owner, id);
  } else if (pane.type === 'text' && pane.text) {
    const white = owner.materials[pane.material]?.white ?? [255, 255, 255, 255];
    const css = (tint) => {
      const [red, green, blue, alpha] = [0, 1, 2, 3].map((c) => (white[c] * (tint ?? [255, 255, 255, 255])[c]) / 255);
      return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
    };
    const size = Math.max(pane.fontHeight || Math.abs(r.h) * 0.6, 1);
    const lines = pane.text.split('\n');
    const step = size + (pane.lineSpace || 0);
    const horizontal = pane.textAlign & 3;
    const vertical = (pane.textAlign >> 2) & 3;
    const x = horizontal === 1 ? r.x : horizontal === 2 ? r.x + r.w : r.x + r.w / 2;
    const block = step * lines.length;
    const top = vertical === 1 ? -(r.y + r.h) : vertical === 2 ? -r.y - block : -(r.y + r.h / 2) - block / 2;
    ctx.save();
    ctx.scale(1, -1);
    const gradient = ctx.createLinearGradient(0, top, 0, top + block);
    gradient.addColorStop(0, css(pane.topColor));
    gradient.addColorStop(1, css(pane.bottomColor ?? pane.topColor));
    ctx.fillStyle = gradient;
    ctx.font = `bold ${size * 0.85}px system-ui`;
    ctx.textAlign = horizontal === 1 ? 'left' : horizontal === 2 ? 'right' : 'center';
    ctx.textBaseline = 'middle';
    if (pane.italic) ctx.transform(1, 0, -pane.italic, 1, 0, 0);
    lines.forEach((line, i) => ctx.fillText(line, x, top + step * (i + 0.5), Math.abs(r.w)));
    ctx.restore();
  }
}
