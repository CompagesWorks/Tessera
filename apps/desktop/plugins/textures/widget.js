const TEXTURE = /\.(nutexb|bntx|dds|png|jpe?g|webp|gif|bmp|tga|tiff?)$/i;

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const filter = document.getElementById('filter');
const quality = document.getElementById('quality');
const all = document.getElementById('all');
const gamma = document.getElementById('gamma');
const drop = document.getElementById('drop');
const rows = new Map();
let busy = false;

const extension = (path) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
const toast = (kind, message) => tessera.ui.toast(kind, message);
const failed = (error) => toast('error', String(error.message ?? error));

async function walk(path, found) {
  for (const entry of await tessera.files.list(path)) {
    if (entry.kind === 'dir') await walk(entry.path, found);
    else if (TEXTURE.test(entry.name)) found.push(entry.path);
  }
  return found;
}

function select(options, value, label) {
  const node = document.createElement('select');
  node.className = 'atrium-input';
  node.setAttribute('aria-label', label);
  for (const [optionValue, text] of options) node.append(new Option(text, optionValue, false, optionValue === value));
  return node;
}

function cell(...children) {
  const td = document.createElement('td');
  td.append(...children);
  return td;
}

function row(path) {
  const slash = path.lastIndexOf('/');
  const input = extension(path);
  const output = select(
    OUTPUTS.filter((type) => type !== input).map((type) => [type, `.${type}`]),
    input === 'nutexb' ? 'png' : 'nutexb',
    t('output.for', { path }),
  );
  const format = select([['', t('auto')], ...FORMATS.map((f) => [f, f])], '', t('format.for', { path }));
  const mipmaps = select(MIPMAPS.map(([value, key]) => [value, t(key)]), 'GeneratedAutomatic', t('mipmaps.for', { path }));
  const convert = document.createElement('button');
  convert.type = 'button';
  convert.className = 'atrium-btn atrium-btn-secondary';
  convert.textContent = t('convert');
  const name = document.createElement('div');
  name.className = 'name';
  name.title = path;
  const folder = document.createElement('span');
  folder.className = 'folder';
  folder.textContent = path.slice(0, slash + 1);
  name.append(folder, path.slice(slash + 1));
  const tr = document.createElement('tr');
  tr.append(cell(name), cell(output), cell(format), cell(mipmaps), cell(convert));
  const sync = () => {
    format.disabled = mipmaps.disabled = output.value === 'png';
  };
  output.addEventListener('change', sync);
  sync();
  const item = {
    path,
    tr,
    run: () =>
      tessera.textures.convert(path, path.replace(TEXTURE, `.${output.value}`), {
        format: format.value || undefined,
        mipmaps: mipmaps.value,
        quality: quality.value,
        gammaFix: gamma.checked,
      }),
  };
  convert.addEventListener('click', () => work([item]));
  tr.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    const choice = await tessera.ui.contextMenu({ x: event.clientX, y: event.clientY, path, items: [{ id: 'convert', label: t('convert'), icon: 'arrow-repeat' }] });
    if (choice === 'convert') work([item]);
  });
  return item;
}

function show() {
  const query = filter.value.trim().toLowerCase();
  for (const item of rows.values()) item.tr.hidden = query !== '' && !item.path.toLowerCase().includes(query);
}

async function refresh() {
  const paths = (await walk('', [])).sort((a, b) => a.localeCompare(b));
  for (const path of [...rows.keys()]) if (!paths.includes(path)) rows.delete(path);
  for (const path of paths) if (!rows.has(path)) rows.set(path, row(path));
  list.replaceChildren(...paths.map((path) => rows.get(path).tr));
  empty.hidden = paths.length > 0;
  show();
}

async function work(items) {
  if (busy || items.length === 0) return;
  busy = true;
  document.body.setAttribute('aria-busy', 'true');
  let done = 0;
  try {
    for (const item of items) {
      all.textContent = `${done}/${items.length}`;
      await item.run();
      done += 1;
    }
    toast('success', items.length === 1 ? t('converted', { name: items[0].path.slice(items[0].path.lastIndexOf('/') + 1) }) : t('convertedMany', { count: done }));
  } catch (error) {
    failed(error);
  } finally {
    busy = false;
    all.textContent = t('convertAll');
    document.body.removeAttribute('aria-busy');
  }
}

function target(path) {
  const item = rows.get(path);
  if (!item) return toast('warning', t('notTexture', { name: path }));
  filter.value = '';
  show();
  for (const other of rows.values()) other.tr.classList.toggle('is-target', other === item);
  item.tr.scrollIntoView({ block: 'nearest' });
  item.tr.querySelector('select').focus();
}

async function add(files) {
  for (const file of files) {
    if (!TEXTURE.test(file.name)) {
      toast('warning', t('notTexture', { name: file.name }));
      continue;
    }
    await tessera.files.writeBytes(file.name, new Uint8Array(await file.arrayBuffer())).catch(failed);
  }
  await refresh();
}

let depth = 0;
document.addEventListener('dragenter', () => {
  depth += 1;
  drop.hidden = false;
});
document.addEventListener('dragleave', () => {
  depth = Math.max(depth - 1, 0);
  drop.hidden = depth > 0 ? drop.hidden : true;
});
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  depth = 0;
  drop.hidden = true;
  if (event.dataTransfer.files.length > 0) void add([...event.dataTransfer.files]);
});
tessera.on('files.dropped', ({ paths }) => target(paths[0]));

filter.addEventListener('input', show);
all.addEventListener('click', () => work([...rows.values()].filter((item) => !item.tr.hidden)));

let pending;
tessera.files.watch(() => {
  clearTimeout(pending);
  pending = setTimeout(() => refresh().catch(() => {}), 300);
});
tessera.ready.then(refresh).catch(failed);
