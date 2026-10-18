const OUTPUT = 'aligned';
const DETECT = 1024;

const referenceSelect = document.getElementById('reference');
const targetsSelect = document.getElementById('targets');
const alignButton = document.getElementById('align');
const preview = document.getElementById('preview');
const referenceImage = document.getElementById('reference-image');
const referenceName = document.getElementById('reference-name');
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
let images = [];
let busy = false;
const urls = [];

const folder = (path) => path.slice(0, path.lastIndexOf('/'));
const slot = (path) => /chara_\d+/i.exec(base(path))?.[0] ?? stem(path);
const targets = () => images.filter((path) => folder(path) === targetsSelect.value && path !== referenceSelect.value && folder(path) !== OUTPUT);

function url(bytes) {
  const value = URL.createObjectURL(new Blob([bytes]));
  urls.push(value);
  return value;
}

function card(path) {
  const item = document.createElement('li');
  const img = document.createElement('img');
  img.alt = '';
  tessera.files.readBytes(path).then((bytes) => (img.src = url(bytes))).catch(() => {});
  const name = document.createElement('span');
  name.textContent = slot(path);
  name.title = path;
  const state = document.createElement('small');
  item.append(img, name, state);
  return { path, item, img, state };
}

let cards = [];
async function show() {
  urls.splice(0).forEach((value) => URL.revokeObjectURL(value));
  preview.hidden = !referenceSelect.value;
  if (referenceSelect.value) {
    referenceImage.src = url(await tessera.files.readBytes(referenceSelect.value));
    referenceName.textContent = base(referenceSelect.value);
  }
  cards = targets().map(card);
  grid.replaceChildren(...cards.map((c) => c.item));
  empty.hidden = cards.length > 0 && Boolean(referenceSelect.value);
  alignButton.disabled = busy || !referenceSelect.value || cards.length === 0;
}

async function refresh() {
  images = await projectImages();
  fill(referenceSelect, images, (path) => path, t('choose'));
  const folders = [...new Set(images.map(folder))].filter((dir) => dir !== OUTPUT);
  fill(targetsSelect, folders, (dir) => dir || t('root'), t('choose'));
  await show();
}

function estimateOff(reference, target) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker('features.js');
    } catch {
      return resolve(estimate(reference, target));
    }
    worker.onmessage = ({ data }) => {
      worker.terminate();
      resolve(data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      resolve(estimate(reference, target));
    };
    worker.postMessage({ reference, target });
  });
}

async function alignAll() {
  busy = true;
  alignButton.disabled = true;
  document.body.setAttribute('aria-busy', 'true');
  let done = 0;
  try {
    const reference = await load(referenceSelect.value);
    const small = pixels(reference, DETECT);
    for (const [index, c] of cards.entries()) {
      alignButton.textContent = `${index + 1}/${cards.length}`;
      c.state.textContent = t('aligning');
      c.item.className = '';
      try {
        const target = await load(c.path);
        const small2 = pixels(target, DETECT);
        const found = await estimateOff(small.image, small2.image);
        if (!found) throw new Error(t('noMatch'));
        const k = small.scale / small2.scale;
        const canvas = document.createElement('canvas');
        canvas.width = target.width;
        canvas.height = target.height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.setTransform(found.a * k, found.b * k, -found.b * k, found.a * k, found.tx / small2.scale, found.ty / small2.scale);
        ctx.drawImage(reference, 0, 0);
        const out = `${OUTPUT}/${stem(c.path)}.png`;
        await savePng(canvas, out);
        c.img.src = canvas.toDataURL();
        c.state.textContent = t('matches', { inliers: found.inliers, matches: found.matches });
        c.item.className = 'done';
        done += 1;
      } catch (error) {
        c.state.textContent = String(error.message ?? error);
        c.item.className = 'failed';
      }
    }
    tessera.ui.toast(done === cards.length ? 'success' : 'warning', t('aligned', { done, total: cards.length, folder: OUTPUT }));
  } catch (error) {
    failed(error);
  } finally {
    busy = false;
    alignButton.textContent = t('align');
    document.body.removeAttribute('aria-busy');
    alignButton.disabled = false;
  }
}

picker(document.getElementById('import-reference'), false, async (files) => {
  const [path] = await importFiles(files, 'reference');
  await refresh();
  if (path) referenceSelect.value = path;
  await show();
});
picker(document.getElementById('import-targets'), true, async (files) => {
  const [path] = await importFiles(files, 'targets');
  await refresh();
  if (path) targetsSelect.value = folder(path);
  await show();
});
referenceSelect.addEventListener('change', () => show().catch(failed));
targetsSelect.addEventListener('change', () => show().catch(failed));
alignButton.addEventListener('click', () => alignAll());

tessera.ready.then(refresh).catch(failed);
