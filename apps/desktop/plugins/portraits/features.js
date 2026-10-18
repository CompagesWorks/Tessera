const PATCH = 13;
const BORDER = 18;
const PER_LEVEL = 300;

const PAIRS = (() => {
  let seed = 0x2545f491;
  const random = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const point = () => Math.max(-PATCH, Math.min(PATCH, Math.round((random() + random() + random() - 1.5) * 12)));
  return Array.from({ length: 256 }, () => [point(), point(), point(), point()]);
})();

function grayscale(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i += 1) {
    const p = i * 4;
    out[i] = ((rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) * rgba[p + 3]) / 255;
  }
  return out;
}

function boxBlur(src, width, height, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const size = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += src[y * width + Math.min(width - 1, Math.max(0, x + k))];
      tmp[y * width + x] = sum / size;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += tmp[Math.min(height - 1, Math.max(0, y + k)) * width + x];
      out[y * width + x] = sum / size;
    }
  }
  return out;
}

function resize(src, width, height, nw, nh) {
  const out = new Float32Array(nw * nh);
  const fx = width / nw;
  const fy = height / nh;
  for (let y = 0; y < nh; y += 1) {
    const sy = Math.min(height - 1, (y + 0.5) * fy - 0.5);
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = Math.max(0, sy - y0);
    for (let x = 0; x < nw; x += 1) {
      const sx = Math.min(width - 1, (x + 0.5) * fx - 0.5);
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = Math.max(0, sx - x0);
      const top = src[y0 * width + x0] * (1 - wx) + src[y0 * width + x1] * wx;
      const bottom = src[y1 * width + x0] * (1 - wx) + src[y1 * width + x1] * wx;
      out[y * nw + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

function corners(img, width, height, count) {
  const xx = new Float32Array(img.length);
  const yy = new Float32Array(img.length);
  const xy = new Float32Array(img.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx = img[i + 1] - img[i - 1];
      const gy = img[i + width] - img[i - width];
      xx[i] = gx * gx;
      yy[i] = gy * gy;
      xy[i] = gx * gy;
    }
  }
  const sxx = boxBlur(xx, width, height, 2);
  const syy = boxBlur(yy, width, height, 2);
  const sxy = boxBlur(xy, width, height, 2);
  const response = new Float32Array(img.length);
  for (let i = 0; i < img.length; i += 1) {
    const trace = sxx[i] + syy[i];
    response[i] = sxx[i] * syy[i] - sxy[i] * sxy[i] - 0.04 * trace * trace;
  }
  const found = [];
  for (let y = BORDER; y < height - BORDER; y += 1) {
    for (let x = BORDER; x < width - BORDER; x += 1) {
      const i = y * width + x;
      const r = response[i];
      if (r <= 1) continue;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if ((dx || dy) && response[i + dy * width + dx] >= r) peak = false;
      if (peak) found.push({ x, y, r });
    }
  }
  return found.sort((a, b) => b.r - a.r).slice(0, count);
}

function describe(img, smooth, width, point) {
  let m01 = 0;
  let m10 = 0;
  for (let dy = -15; dy <= 15; dy += 1) {
    for (let dx = -15; dx <= 15; dx += 1) {
      if (dx * dx + dy * dy > 225) continue;
      const v = img[(point.y + dy) * width + point.x + dx];
      m10 += dx * v;
      m01 += dy * v;
    }
  }
  const angle = Math.atan2(m01, m10);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const bits = new Uint32Array(8);
  const at = (px, py) => smooth[(point.y + Math.round(px * s + py * c)) * width + point.x + Math.round(px * c - py * s)];
  PAIRS.forEach(([ax, ay, bx, by], k) => {
    if (at(ax, ay) < at(bx, by)) bits[k >> 5] |= 1 << (k & 31);
  });
  return bits;
}

function features(rgba, width, height) {
  const out = [];
  let img = grayscale(rgba, width, height);
  let w = width;
  let h = height;
  let factor = 1;
  for (let level = 0; level < 8 && Math.min(w, h) > BORDER * 3; level += 1) {
    const smooth = boxBlur(img, w, h, 2);
    for (const point of corners(img, w, h, PER_LEVEL)) out.push({ x: point.x * factor, y: point.y * factor, bits: describe(img, smooth, w, point) });
    const nw = Math.round(w / 1.3);
    const nh = Math.round(h / 1.3);
    factor *= w / nw;
    img = resize(img, w, h, nw, nh);
    w = nw;
    h = nh;
  }
  return out;
}

function popcount(x) {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

function match(from, to) {
  const pairs = [];
  for (const a of from) {
    let best = Infinity;
    let second = Infinity;
    let bestPoint = null;
    for (const b of to) {
      let d = 0;
      for (let k = 0; k < 8 && d < second; k += 1) d += popcount(a.bits[k] ^ b.bits[k]);
      if (d < best) {
        second = best;
        best = d;
        bestPoint = b;
      } else if (d < second) second = d;
    }
    if (bestPoint && best < 0.75 * second) pairs.push([a.x, a.y, bestPoint.x, bestPoint.y]);
  }
  return pairs;
}

function fit(pairs) {
  let px = 0, py = 0, qx = 0, qy = 0;
  for (const [x1, y1, x2, y2] of pairs) {
    px += x1;
    py += y1;
    qx += x2;
    qy += y2;
  }
  const n = pairs.length;
  px /= n;
  py /= n;
  qx /= n;
  qy /= n;
  let dot = 0, cross = 0, norm = 0;
  for (const [x1, y1, x2, y2] of pairs) {
    const ax = x1 - px, ay = y1 - py, bx = x2 - qx, by = y2 - qy;
    dot += ax * bx + ay * by;
    cross += ax * by - ay * bx;
    norm += ax * ax + ay * ay;
  }
  if (norm < 16) return null;
  const a = dot / norm;
  const b = cross / norm;
  return { a, b, tx: qx - (a * px - b * py), ty: qy - (b * px + a * py) };
}

function inliers(pairs, t, threshold) {
  return pairs.filter(([x1, y1, x2, y2]) => Math.hypot(t.a * x1 - t.b * y1 + t.tx - x2, t.b * x1 + t.a * y1 + t.ty - y2) < threshold);
}

function estimate(reference, target) {
  const pairs = match(features(reference.data, reference.width, reference.height), features(target.data, target.width, target.height));
  if (pairs.length < 10) return null;
  const threshold = Math.max(3, Math.max(target.width, target.height) / 150);
  let best = [];
  let seed = 1;
  const pick = () => (seed = (Math.imul(seed, 48271) >>> 0) % 2147483647) % pairs.length;
  for (let i = 0; i < 2000; i += 1) {
    const t = fit([pairs[pick()], pairs[pick()]]);
    if (!t) continue;
    const found = inliers(pairs, t, threshold);
    if (found.length > best.length) best = found;
  }
  if (best.length < 8) return null;
  let t = fit(best);
  for (let i = 0; i < 4 && t; i += 1) t = fit(inliers(pairs, t, i < 2 ? threshold : threshold / 2));
  return t && { ...t, inliers: inliers(pairs, t, threshold).length, matches: pairs.length };
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = ({ data }) => postMessage(estimate(data.reference, data.target));
