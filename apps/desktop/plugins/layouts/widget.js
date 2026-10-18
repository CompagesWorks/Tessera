const t = (key, params) => tessera.i18n.t(key, params);
const BFLYT = /\.bflyt$/i;
const ICONS = { pane: 'square', picture: 'image', text: 'fonts', window: 'window', bounding: 'bounding-box', part: 'boxes', alignment: 'align-center', scissor: 'scissors' };
const MAX_PART_DEPTH = 4;

const picker = document.getElementById('file');
const showHidden = document.getElementById('hidden');
const showBoxes = document.getElementById('boxes');
const empty = document.getElementById('empty');
const main = document.getElementById('main');
const tree = document.getElementById('tree');
const canvas = document.getElementById('canvas');
const props = document.getElementById('props');
const fitButton = document.getElementById('fit');
const saveButton = document.getElementById('save');
const revertButton = document.getElementById('revert');
let dirty = false;
let fields = {};
let layout = null;
let selected = null;
let path = '';
let parts = new Map();
const rows = new Map();
const ids = new WeakMap();
const camera = { zoom: 1, x: 0, y: 0 };

function failed(error) {
  const key = `error.${error.message}`;
  tessera.ui.toast('error', t(key) === key ? String(error.message ?? error) : t(key));
}

async function walk(dir, found) {
  for (const entry of await tessera.files.list(dir)) {
    if (entry.kind === 'dir') await walk(entry.path, found);
    else if (BFLYT.test(entry.name)) found.push(entry.path);
  }
  return found;
}

const folderOf = (file) => file.slice(0, file.lastIndexOf('/'));

let nextId = 0;

function idOf(pane) {
  if (!ids.has(pane)) ids.set(pane, `p${(nextId += 1)}`);
  return ids.get(pane);
}

function prepare(target) {
  for (const material of target.materials) material.textureNames = target.textures;
  return target;
}

async function loadParts(target, folder, depth = 0) {
  if (depth >= MAX_PART_DEPTH) return;
  const names = new Set();
  const visit = (pane) => {
    if (pane.part) names.add(pane.part);
    pane.children.forEach(visit);
  };
  visit(target.root);
  for (const name of names) {
    if (parts.has(name)) continue;
    parts.set(name, null);
    try {
      const part = prepare(readBflyt(await tessera.files.readBytes(`${folder}/${name}.bflyt`)));
      if (!part.root) continue;
      parts.set(name, part);
      await loadParts(part, folder, depth + 1);
    } catch {}
  }
}

function entries() {
  const list = [];
  const visit = (pane, owner, matrix, parent, hiddenParent, alpha, top, depth) => {
    const hidden = hiddenParent || !pane.visible;
    let m = matrix;
    if (parent) {
      const ax = ANCHOR[(pane.origin >> 4) & 3] ?? 0.5;
      const ay = ANCHOR[(pane.origin >> 6) & 3] ?? 0.5;
      m = m.translate((ax - 0.5) * parent.width, (0.5 - ay) * parent.height);
    }
    const base = m;
    m = m.translate(pane.x, pane.y).rotate(pane.rotation).scale(pane.scaleX, pane.scaleY);
    const own = alpha * (pane.alpha / 255);
    const entry = { pane, owner, base, matrix: m, hidden, alpha: own, top: top ?? pane };
    if (!hidden || showHidden.checked) list.push(entry);
    const inherited = pane.influenceAlpha ? own : alpha;
    const part = pane.part && depth < MAX_PART_DEPTH ? parts.get(pane.part) : null;
    if (part) {
      const scaled = m.scale(pane.partScale?.[0] || 1, pane.partScale?.[1] || 1);
      for (const child of part.root.children) visit(child, part, scaled, part.root, hidden, inherited, top ?? pane, depth + 1);
    }
    for (const child of pane.children) visit(child, owner, m, pane, hidden, inherited, top, depth);
  };
  visit(layout.root, layout, new DOMMatrix(), null, false, 1, null, 0);
  return list;
}

function view() {
  const ratio = window.devicePixelRatio || 1;
  return new DOMMatrix().translate(canvas.width / 2, canvas.height / 2).scale(camera.zoom * ratio, -camera.zoom * ratio).translate(-camera.x, -camera.y);
}

function fit() {
  let box = null;
  for (const { pane, matrix } of entries()) {
    if (pane === layout.root || pane.type === 'pane' || pane.type === 'part') continue;
    const r = rect(pane);
    for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
      const p = matrix.transformPoint(new DOMPoint(x, y));
      box = box ? { x0: Math.min(box.x0, p.x), y0: Math.min(box.y0, p.y), x1: Math.max(box.x1, p.x), y1: Math.max(box.y1, p.y) } : { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
  }
  box ??= { x0: -layout.width / 2, y0: -layout.height / 2, x1: layout.width / 2, y1: layout.height / 2 };
  camera.x = (box.x0 + box.x1) / 2;
  camera.y = (box.y0 + box.y1) / 2;
  camera.zoom = Math.min(canvas.clientWidth / Math.max(box.x1 - box.x0, 1), canvas.clientHeight / Math.max(box.y1 - box.y0, 1)) * 0.9;
  draw();
}

function color(name, fallback) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function grid(ctx, matrix) {
  const inverse = matrix.inverse();
  const a = inverse.transformPoint(new DOMPoint(0, 0));
  const b = inverse.transformPoint(new DOMPoint(canvas.width, canvas.height));
  const step = 10 ** Math.ceil(Math.log10(40 / camera.zoom));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = 1;
  for (const [axis, from, to] of [['x', Math.min(a.x, b.x), Math.max(a.x, b.x)], ['y', Math.min(a.y, b.y), Math.max(a.y, b.y)]]) {
    for (let v = Math.ceil(from / step) * step; v <= to; v += step) {
      const p = matrix.transformPoint(new DOMPoint(axis === 'x' ? v : 0, axis === 'y' ? v : 0));
      ctx.globalAlpha = Math.abs(v) < step / 2 ? 0.35 : 0.1;
      ctx.beginPath();
      if (axis === 'x') {
        ctx.moveTo(Math.round(p.x) + 0.5, 0);
        ctx.lineTo(Math.round(p.x) + 0.5, canvas.height);
      } else {
        ctx.moveTo(0, Math.round(p.y) + 0.5);
        ctx.lineTo(canvas.width, Math.round(p.y) + 0.5);
      }
      ctx.stroke();
    }
  }
}

function draw() {
  if (!layout) return;
  const restore = pose();
  try {
    paint();
  } finally {
    restore();
  }
}

function paint() {
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * ratio);
  canvas.height = Math.round(canvas.clientHeight * ratio);
  const matrix = view();
  const muted = color('--atrium-text-muted', '#888');
  const accent = color('--atrium-accent-color', '#4c8dff');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = muted;
  grid(ctx, matrix);
  ctx.setTransform(matrix);
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-layout.width / 2, -layout.height / 2, layout.width, layout.height);
  ctx.imageSmoothingEnabled = true;
  const list = entries();
  for (const entry of list) {
    if (entry.pane === layout.root) continue;
    ctx.setTransform(matrix.multiply(entry.matrix));
    ctx.globalAlpha = entry.alpha * (entry.hidden ? 0.35 : 1);
    drawPane(ctx, entry, idOf(entry.pane));
  }
  for (const entry of list) {
    const isSelected = entry.pane === selected;
    if (!isSelected && (!showBoxes.checked || entry.owner !== layout || entry.pane === layout.root)) continue;
    const r = rect(entry.pane);
    ctx.setTransform(matrix.multiply(entry.matrix));
    ctx.lineWidth = 1 / Math.max(camera.zoom * ratio * Math.hypot(entry.matrix.a, entry.matrix.b), 0.0001);
    ctx.setLineDash(entry.hidden ? [4 * ctx.lineWidth, 4 * ctx.lineWidth] : []);
    ctx.globalAlpha = isSelected ? 1 : 0.45;
    ctx.strokeStyle = isSelected ? accent : muted;
    if (isSelected) {
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.15;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

let redraw = 0;
const scheduleDraw = () => {
  cancelAnimationFrame(redraw);
  redraw = requestAnimationFrame(draw);
};

function inside(entry, x, y) {
  const ratio = window.devicePixelRatio || 1;
  const p = view().multiply(entry.matrix).inverse().transformPoint(new DOMPoint(x * ratio, y * ratio));
  const r = rect(entry.pane);
  return p.x >= Math.min(r.x, r.x + r.w) && p.x <= Math.max(r.x, r.x + r.w) && p.y >= Math.min(r.y, r.y + r.h) && p.y <= Math.max(r.y, r.y + r.h);
}

function hit(x, y) {
  const list = entries().filter(({ pane }) => pane.type !== 'pane' && pane !== layout.root);
  for (let i = list.length - 1; i >= 0; i--) if (inside(list[i], x, y)) return list[i].top;
  return layout.root;
}

async function save() {
  if (!layout || !dirty) return;
  try {
    const bytes = writeBflyt(layout);
    await tessera.files.writeBytes(path, bytes);
    const index = layout.panes.indexOf(selected);
    const materialIndex = layout.materials.indexOf(selected);
    layout = prepare(readBflyt(bytes));
    buildTree();
    refreshTextureList();
    setDirty(false);
    if (index >= 0) selectPane(layout.panes[index]);
    else if (materialIndex >= 0) selectMaterial(layout.materials[materialIndex]);
    else if (typeof selected === 'string') selectTexture(selected);
    else selectPane(layout.root);
    tessera.ui.toast('success', t('saved', { name: path.slice(path.lastIndexOf('/') + 1) }));
  } catch (error) {
    failed(error);
  }
}

function row(label, icon, onClick, key, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = extraClass;
  button.innerHTML = `<i class="bi bi-${icon}"></i> `;
  button.append(label);
  button.addEventListener('click', onClick);
  rows.set(key, button);
  return button;
}

function folder(label, icon, children) {
  const li = document.createElement('li');
  li.setAttribute('role', 'treeitem');
  li.setAttribute('aria-expanded', 'false');
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = `<i class="bi bi-chevron-right chevron"></i><i class="bi bi-${icon}"></i> `;
  button.append(`${label} (${children.length})`);
  const ul = document.createElement('ul');
  ul.setAttribute('role', 'group');
  ul.hidden = true;
  ul.append(...children);
  button.addEventListener('click', () => {
    ul.hidden = !ul.hidden;
    li.setAttribute('aria-expanded', String(!ul.hidden));
  });
  li.append(button, ul);
  return li;
}

function leaf(button) {
  const li = document.createElement('li');
  li.setAttribute('role', 'treeitem');
  li.append(button);
  return li;
}

function node(pane) {
  const li = leaf(row(pane.name, ICONS[pane.type] ?? 'square', () => selectPane(pane), pane, pane.visible ? '' : 'is-hidden'));
  rows.get(pane).title = t(`type.${pane.type}`);
  rows.get(pane).addEventListener('contextmenu', (event) => paneMenu(pane, event));
  if (pane.children.length) {
    const ul = document.createElement('ul');
    ul.setAttribute('role', 'group');
    ul.append(...pane.children.map(node));
    li.append(ul);
  }
  return li;
}

function buildTree() {
  rows.clear();
  tree.replaceChildren(
    folder(t('res.textures'), 'images', layout.textures.map((name) => leaf(row(name, 'image', () => selectTexture(name), name)))),
    folder(t('res.fonts'), 'fonts', layout.fonts.map((name) => leaf(row(name, 'type', () => {}, `font:${name}`)))),
    folder(t('res.materials'), 'palette', layout.materials.map((material) => leaf(row(material.name.trim(), 'circle-half', () => selectMaterial(material), material)))),
    node(layout.root),
  );
}

async function open(next, force = false) {
  if (dirty && !force && next !== path) {
    picker.value = path;
    tessera.ui.toast('warning', t('saveFirst'));
    return;
  }
  setDirty(false);
  path = next;
  picker.value = path;
  layout = null;
  parts = new Map();
  main.hidden = true;
  loadAnimations(path);
  if (!path) return;
  try {
    const opened = prepare(readBflyt(await tessera.files.readBytes(path)));
    if (!opened.root) throw new Error('not-bflyt');
    layout = opened;
    buildTree();
    main.hidden = false;
    selected = null;
    selectPane(layout.root);
    fit();
    await tessera.widget.setState({ path });
    const blyt = folderOf(path);
    timgFolder = `${folderOf(blyt)}/timg`;
    refreshTextureList();
    await loadParts(layout, blyt);
    if (layout !== opened) return;
    fit();
    const names = new Set([layout, ...[...parts.values()].filter(Boolean)].flatMap((item) => item.textures));
    await loadTextures([...names], timgFolder, () => {
      if (layout !== opened) return;
      scheduleDraw();
      refreshTextureList();
    });
  } catch (error) {
    failed(error);
  }
}

async function refresh(wanted = path) {
  const paths = (await walk('', [])).sort((a, b) => a.localeCompare(b));
  picker.replaceChildren(...paths.map((p) => new Option(p, p)));
  empty.hidden = paths.length > 0;
  picker.hidden = paths.length === 0;
  if (wanted !== path || !paths.includes(path)) await open(paths.includes(wanted) ? wanted : (paths[0] ?? ''));
  else picker.value = path;
}

picker.addEventListener('change', () => open(picker.value));
showHidden.addEventListener('change', draw);
showBoxes.addEventListener('change', draw);
fitButton.addEventListener('click', () => layout && fit());
canvas.addEventListener('dblclick', () => layout && fit());
canvas.addEventListener(
  'wheel',
  (event) => {
    if (!layout) return;
    event.preventDefault();
    const ratio = window.devicePixelRatio || 1;
    const point = new DOMPoint(event.offsetX * ratio, event.offsetY * ratio);
    const before = view().inverse().transformPoint(point);
    camera.zoom = Math.min(Math.max(camera.zoom * Math.exp(-event.deltaY * 0.0015), 0.01), 100);
    const after = view().inverse().transformPoint(point);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    scheduleDraw();
  },
  { passive: false },
);
let drag = null;
function screenToWorld(x, y) {
  const ratio = window.devicePixelRatio || 1;
  return view().inverse().transformPoint(new DOMPoint(x * ratio, y * ratio));
}

canvas.addEventListener('pointerdown', (event) => {
  if (!layout || event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  drag = { x: event.offsetX, y: event.offsetY, moved: false };
  const entry = selected && editablePane(selected) && selected !== layout.root ? entries().find((item) => item.pane === selected && item.owner === layout) : null;
  if (entry && inside(entry, event.offsetX, event.offsetY)) {
    Object.assign(drag, { pane: selected, base: entry.base.inverse(), start: screenToWorld(event.offsetX, event.offsetY), origin: [selected.x, selected.y] });
  }
});
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.offsetX - drag.x;
  const dy = event.offsetY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  drag.moved = true;
  if (drag.pane) {
    const from = drag.base.transformPoint(drag.start);
    const to = drag.base.transformPoint(screenToWorld(event.offsetX, event.offsetY));
    drag.pane.x = Math.round((drag.origin[0] + to.x - from.x) * 10) / 10;
    drag.pane.y = Math.round((drag.origin[1] + to.y - from.y) * 10) / 10;
    syncFields(drag.pane);
    changed();
    return;
  }
  canvas.classList.add('is-panning');
  camera.x -= dx / camera.zoom;
  camera.y += dy / camera.zoom;
  drag.x = event.offsetX;
  drag.y = event.offsetY;
  scheduleDraw();
});
canvas.addEventListener('pointerup', (event) => {
  if (drag && !drag.moved) selectPane(hit(event.offsetX, event.offsetY));
  drag = null;
  canvas.classList.remove('is-panning');
});
new ResizeObserver(scheduleDraw).observe(canvas);
canvas.addEventListener('contextmenu', (event) => layout && paneMenu(hit(event.offsetX, event.offsetY), event));
canvas.addEventListener('keydown', (event) => {
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
  const move = moves[event.key];
  if (!move || !selected || !editablePane(selected) || selected === layout.root) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  selected.x += move[0] * step;
  selected.y += move[1] * step;
  syncFields(selected);
  changed();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Delete' && layout && selected && typeof selected === 'object' && selected.children && !event.target.closest('input, textarea, select')) {
    event.preventDefault();
    removePane(selected);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});
saveButton.addEventListener('click', save);
revertButton.addEventListener('click', () => open(path, true));
tessera.on('files.selected', ({ path: chosen }) => {
  if (chosen && BFLYT.test(chosen) && chosen !== path) open(chosen);
});
tessera.on('files.dropped', ({ paths }) => {
  if (BFLYT.test(paths[0])) open(paths[0]);
  else tessera.ui.toast('warning', t('notBflyt', { name: paths[0] }));
});

let pending;
tessera.files.watch(() => {
  clearTimeout(pending);
  pending = setTimeout(() => refresh().catch(() => {}), 300);
});
tessera.ready.then(async () => refresh((await tessera.widget.getState())?.path)).catch(failed);
