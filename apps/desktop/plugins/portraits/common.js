const t = (key, params) => tessera.i18n.t(key, params);
const IMAGE = /\.(png|jpe?g|webp)$/i;
const base = (path) => path.slice(path.lastIndexOf('/') + 1);
const stem = (path) => base(path).replace(/\.[^.]+$/, '');
const failed = (error) => tessera.ui.toast('error', String(error.message ?? error));

async function walk(dir, found) {
  for (const entry of await tessera.files.list(dir)) {
    if (entry.kind === 'dir') await walk(entry.path, found);
    else if (IMAGE.test(entry.name)) found.push(entry.path);
  }
  return found;
}

const projectImages = async () => {
  const scan = document.getElementById('scan');
  scan.hidden = false;
  try {
    return (await walk('', [])).sort((a, b) => a.localeCompare(b));
  } finally {
    scan.hidden = true;
  }
};

async function load(path) {
  const bytes = await tessera.files.readBytes(path);
  return createImageBitmap(new Blob([bytes]));
}

function fill(select, values, label = (value) => value, first) {
  const current = select.value;
  select.replaceChildren(...(first ? [new Option(first, '')] : []), ...values.map((value) => new Option(label(value), value)));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

async function importFiles(files, folder) {
  const paths = [];
  for (const file of files) {
    if (!IMAGE.test(file.name)) {
      tessera.ui.toast('warning', t('notImage', { name: file.name }));
      continue;
    }
    const path = folder ? `${folder}/${file.name}` : file.name;
    await tessera.files.writeBytes(path, new Uint8Array(await file.arrayBuffer()));
    paths.push(path);
  }
  return paths;
}

function picker(button, multiple, onFiles) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.png,.jpg,.jpeg,.webp';
  input.multiple = multiple;
  input.hidden = true;
  input.addEventListener('change', () => {
    if (input.files.length > 0) onFiles([...input.files]).catch(failed);
    input.value = '';
  });
  button.after(input);
  button.addEventListener('click', () => input.click());
}

async function savePng(canvas, path) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  await tessera.files.writeBytes(path, new Uint8Array(await blob.arrayBuffer()));
}

function pixels(bitmap, max) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { image: ctx.getImageData(0, 0, canvas.width, canvas.height), scale: canvas.width / bitmap.width };
}
