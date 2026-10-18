const t = (key, params) => tessera.i18n.t(key, params);

const tree = document.getElementById('tree');
const status = document.getElementById('status');
const where = document.getElementById('where');
const expanded = new Set();
let selected = null;

const FILE_ICONS = {
  nutexb: 'file-image',
  bntx: 'file-image',
  png: 'file-image',
  webm: 'file-play',
  nus3audio: 'file-music',
  nus3bank: 'file-music',
  prc: 'file-code',
  stprm: 'file-code',
  stdat: 'file-code',
  xmb: 'file-code',
  msbt: 'file-text',
  arc: 'file-zip',
};

const fileIcon = (name) => FILE_ICONS[name.split('.').pop().toLowerCase()] ?? 'file-earmark';

function size(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function say(message) {
  status.textContent = message;
  status.hidden = !message;
}

function failed(error) {
  const key = `error.${error.message}`;
  const message = t(key) === key ? String(error.message ?? error) : t(key);
  say(message);
  tessera.ui.toast('error', message);
}

async function busy(message, action) {
  document.body.setAttribute('aria-busy', 'true');
  say(message);
  try {
    return await action();
  } finally {
    document.body.removeAttribute('aria-busy');
  }
}

async function extract(entry) {
  const done = await busy(t('extracting', { name: entry.name }), () => tessera.arc.extract(entry.path));
  say('');
  tessera.ui.toast(done.failed ? 'warning' : 'success', t('extracted', done));
}

function select(path) {
  selected = path;
  for (const row of tree.querySelectorAll('.row')) row.classList.toggle('is-selected', row.dataset.path === path);
}

function menu(event, entry) {
  event.preventDefault();
  event.stopPropagation();
  select(entry.path);
  const box = event.currentTarget.getBoundingClientRect();
  tessera.ui
    .contextMenu({ x: event.clientX || box.left + 24, y: event.clientY || box.bottom, items: [{ id: 'extract', label: t('extract'), icon: 'box-arrow-up' }] })
    .then((id) => id === 'extract' && extract(entry))
    .catch(failed);
}

function toggle(node, children, entry, depth) {
  if (expanded.has(entry.path)) expanded.delete(entry.path);
  else expanded.add(entry.path);
  tessera.widget.setState({ expanded: [...expanded] });
  const open = expanded.has(entry.path);
  node.classList.toggle('is-open', open);
  node.setAttribute('aria-expanded', String(open));
  node.querySelector('.folder').className = `folder bi bi-${open ? 'folder2-open' : 'folder2'}`;
  if (open) level(children, entry.path, depth + 1).catch(failed);
  else children.replaceChildren();
}

function row(entry, depth, container) {
  const node = document.createElement('div');
  node.className = 'row';
  node.role = 'treeitem';
  node.tabIndex = 0;
  node.title = entry.path;
  node.dataset.path = entry.path;
  node.style.setProperty('--depth', String(depth));
  node.classList.toggle('is-selected', entry.path === selected);
  node.addEventListener('contextmenu', (event) => menu(event, entry));
  node.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    node.click();
  });
  if (!entry.dir) {
    node.innerHTML = `<span class="spacer"></span><i class="bi bi-${fileIcon(entry.name)}"></i>`;
    node.append(entry.name);
    const bytes = document.createElement('span');
    bytes.className = 'size';
    bytes.textContent = size(entry.size);
    node.append(bytes);
    node.addEventListener('click', () => select(entry.path));
    container.append(node);
    return;
  }
  const open = expanded.has(entry.path);
  node.classList.add('is-dir');
  node.classList.toggle('is-open', open);
  node.setAttribute('aria-expanded', String(open));
  node.innerHTML = `<i class="bi bi-chevron-right"></i><i class="folder bi bi-${open ? 'folder2-open' : 'folder2'}"></i>`;
  node.append(entry.name);
  const children = document.createElement('div');
  children.role = 'group';
  node.addEventListener('click', () => toggle(node, children, entry, depth));
  container.append(node, children);
  if (open) level(children, entry.path, depth + 1).catch(failed);
}

async function level(container, path, depth) {
  const entries = await tessera.arc.list(path);
  container.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.setProperty('--depth', String(depth));
    empty.textContent = t('empty');
    container.append(empty);
  }
  for (const entry of entries) row(entry, depth, container);
}

async function load() {
  const info = await tessera.external.info();
  if (!info.picked) return;
  where.textContent = info.name;
  await busy(t('loading'), () => level(tree, '', 0));
  say('');
}

document.getElementById('pick').addEventListener('click', () =>
  tessera.arc
    .pick()
    .then((picked) => picked && load())
    .catch(failed),
);

tessera.ready
  .then(async () => {
    const state = await tessera.widget.getState();
    for (const path of Array.isArray(state?.expanded) ? state.expanded : []) expanded.add(path);
    await load();
  })
  .catch(failed);
