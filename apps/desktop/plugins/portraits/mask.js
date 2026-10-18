const $ = (id) => document.getElementById(id);
const imageSelect = $('image');
const maskSelect = $('mask');
const canvas = $('canvas');
const stage = $('stage');
const ctx = canvas.getContext('2d');
const sliders = { scale: $('scale'), rotation: $('rotation'), brush: $('brush'), opacity: $('opacity'), zoom: $('zoom') };
const overlay = document.createElement('canvas');
const mask = document.createElement('canvas');
const maskCtx = mask.getContext('2d', { willReadFrequently: true });
let image = null;
let source = null;
let place = { x: 0, y: 0 };
let pointer = null;
let stroke = null;
const undoStack = [];
const redoStack = [];

const mode = () => document.querySelector('input[name="mode"]:checked').value;
const rotation = () => (Number(sliders.rotation.value) * Math.PI) / 180;
const factors = () => {
  const s = Number(sliders.scale.value) / 100;
  return [(canvas.width * s) / mask.width, (canvas.height * s) / mask.height];
};

function alphaMask(bitmap) {
  mask.width = bitmap.width;
  mask.height = bitmap.height;
  maskCtx.clearRect(0, 0, mask.width, mask.height);
  maskCtx.drawImage(bitmap, 0, 0);
  const data = maskCtx.getImageData(0, 0, mask.width, mask.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i + 3] = ((px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) * px[i + 3]) / 255;
    px[i] = px[i + 1] = px[i + 2] = 255;
  }
  maskCtx.putImageData(data, 0, 0);
}

function drawMask(target) {
  const [sx, sy] = factors();
  target.save();
  target.translate(place.x, place.y);
  target.rotate(rotation());
  target.scale(sx, sy);
  target.drawImage(mask, -mask.width / 2, -mask.height / 2);
  target.restore();
}

function render() {
  if (!image) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const o = overlay.getContext('2d');
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, overlay.width, overlay.height);
  o.fillStyle = `rgba(0, 0, 0, ${Number(sliders.opacity.value) / 100})`;
  o.fillRect(0, 0, overlay.width, overlay.height);
  o.globalCompositeOperation = 'destination-out';
  drawMask(o);
  ctx.drawImage(overlay, 0, 0);
  if (pointer && mode() !== 'move') {
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, Number(sliders.brush.value), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, canvas.width / canvas.getBoundingClientRect().width);
    ctx.strokeStyle = mode() === 'draw' ? '#3b82f6' : '#ef4444';
    ctx.stroke();
  }
}

function labels() {
  $('scale-value').value = `${sliders.scale.value}%`;
  $('rotation-value').value = `${sliders.rotation.value}°`;
  $('brush-value').value = sliders.brush.value;
  $('opacity-value').value = `${sliders.opacity.value}%`;
  $('zoom-value').value = `${(Number(sliders.zoom.value) / 100).toFixed(2)}x`;
  $('mode-label').textContent = t(`mode.${mode()}`);
  if (image) canvas.style.width = `${(image.width * Number(sliders.zoom.value)) / 100}px`;
  render();
}

const snapshot = () => ({ data: maskCtx.getImageData(0, 0, mask.width, mask.height), place: { ...place }, scale: sliders.scale.value, rotation: sliders.rotation.value });

function restore(state) {
  mask.width = state.data.width;
  mask.height = state.data.height;
  maskCtx.putImageData(state.data, 0, 0);
  place = { ...state.place };
  sliders.scale.value = state.scale;
  sliders.rotation.value = state.rotation;
  labels();
}

function remember() {
  undoStack.push(snapshot());
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
}

function step(from, to) {
  if (from.length === 0) return;
  to.push(snapshot());
  restore(from.pop());
}

function at(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) * canvas.width) / rect.width, y: ((event.clientY - rect.top) * canvas.height) / rect.height };
}

function toMask({ x, y }) {
  const [sx, sy] = factors();
  const c = Math.cos(-rotation());
  const s = Math.sin(-rotation());
  const dx = x - place.x;
  const dy = y - place.y;
  return { x: (dx * c - dy * s) / sx + mask.width / 2, y: (dx * s + dy * c) / sy + mask.height / 2 };
}

function paint(from, to) {
  const [sx, sy] = factors();
  const a = toMask(from);
  const b = toMask(to);
  maskCtx.save();
  maskCtx.globalCompositeOperation = mode() === 'draw' ? 'source-over' : 'destination-out';
  maskCtx.strokeStyle = '#fff';
  maskCtx.lineCap = maskCtx.lineJoin = 'round';
  maskCtx.lineWidth = (Number(sliders.brush.value) * 4) / (sx + sy);
  maskCtx.beginPath();
  maskCtx.moveTo(a.x, a.y);
  maskCtx.lineTo(b.x + 0.01, b.y);
  maskCtx.stroke();
  maskCtx.restore();
}

function center() {
  place = { x: canvas.width / 2, y: canvas.height / 2 };
  sliders.scale.value = 100;
  sliders.rotation.value = 0;
}

async function loadMask() {
  source = maskSelect.value ? await load(maskSelect.value) : await createImageBitmap(await (await fetch('mask.png')).blob());
  alphaMask(source);
  labels();
}

async function loadImage() {
  const path = imageSelect.value;
  image = path ? await load(path) : null;
  canvas.hidden = !image;
  $('empty').hidden = Boolean(image);
  $('save').disabled = !image;
  if (!image) return;
  canvas.width = overlay.width = image.width;
  canvas.height = overlay.height = image.height;
  undoStack.length = redoStack.length = 0;
  center();
  const fit = Math.min(4, (stage.clientWidth - 32) / image.width, (stage.clientHeight - 72) / image.height);
  sliders.zoom.value = Math.max(25, Math.round(fit * 100));
  labels();
}

async function refresh() {
  const images = await projectImages();
  const first = !imageSelect.value;
  fill(imageSelect, images, (path) => path, t('choose'));
  fill(maskSelect, images, (path) => path, t('mask.default'));
  if (first) imageSelect.value = images.find((path) => /^aligned\/.*chara_4/i.test(path)) ?? '';
}

async function save() {
  const out = document.createElement('canvas');
  out.width = image.width;
  out.height = image.height;
  const o = out.getContext('2d');
  o.drawImage(image, 0, 0);
  o.globalCompositeOperation = 'destination-in';
  drawMask(o);
  const path = imageSelect.value;
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const target = $('overwrite').checked ? path.replace(/\.[^./]+$/, '.png') : `${dir}masked_${stem(path)}.png`;
  await savePng(out, target);
  tessera.ui.toast('success', t('saved', { name: target }));
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  canvas.setPointerCapture(event.pointerId);
  remember();
  stroke = at(event);
  if (mode() !== 'move') paint(stroke, stroke);
  render();
});
canvas.addEventListener('pointermove', (event) => {
  const next = at(event);
  pointer = next;
  if (stroke) {
    if (mode() === 'move') {
      place.x += next.x - stroke.x;
      place.y += next.y - stroke.y;
    } else paint(stroke, next);
    stroke = next;
  }
  render();
});
canvas.addEventListener('pointerup', () => (stroke = null));
canvas.addEventListener('pointerleave', () => {
  pointer = null;
  render();
});
stage.addEventListener('wheel', (event) => {
  if (!image) return;
  event.preventDefault();
  sliders.zoom.value = Number(sliders.zoom.value) * (event.deltaY < 0 ? 1.1 : 1 / 1.1);
  labels();
}, { passive: false });
stage.addEventListener('keydown', (event) => {
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') step(undoStack, redoStack);
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') step(redoStack, undoStack);
  else if (moves[event.key] && image) {
    remember();
    place.x += moves[event.key][0] * (event.shiftKey ? 10 : 1);
    place.y += moves[event.key][1] * (event.shiftKey ? 10 : 1);
  } else return;
  event.preventDefault();
  render();
});

for (const slider of [sliders.scale, sliders.rotation]) slider.addEventListener('pointerdown', remember);
for (const slider of Object.values(sliders)) slider.addEventListener('input', labels);
for (const radio of document.querySelectorAll('input[name="mode"]')) radio.addEventListener('change', labels);
$('undo').addEventListener('click', () => step(undoStack, redoStack));
$('redo').addEventListener('click', () => step(redoStack, undoStack));
$('reset-mask').addEventListener('click', () => {
  remember();
  alphaMask(source);
  render();
});
$('reset-place').addEventListener('click', () => {
  remember();
  center();
  labels();
});
$('save').addEventListener('click', () => save().catch(failed));
imageSelect.addEventListener('change', () => loadImage().catch(failed));
maskSelect.addEventListener('change', () => {
  remember();
  loadMask().catch(failed);
});
picker($('import-image'), false, async (files) => {
  const [path] = await importFiles(files, '');
  await refresh();
  if (path) imageSelect.value = path;
  await loadImage();
});
picker($('import-mask'), false, async (files) => {
  const [path] = await importFiles(files, 'masks');
  await refresh();
  if (path) maskSelect.value = path;
  remember();
  await loadMask();
});

tessera.ready
  .then(async () => {
    await refresh();
    await loadMask();
    await loadImage();
  })
  .catch(failed);
