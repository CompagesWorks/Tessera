const t = (key, params) => tessera.i18n.t(key, params);

const list = document.getElementById('list');
const table = document.querySelector('table');
const status = document.getElementById('status');
const where = document.getElementById('where');
const up = document.getElementById('up');
let current = '';

const parentOf = (path) => path.replace(/\/$/, '').replace(/\/?[^/]*$/, '');

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
  status.hidden = false;
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
  status.hidden = list.children.length > 0;
  tessera.ui.toast(done.failed ? 'warning' : 'success', t('extracted', done));
}

function row(entry) {
  const name = document.createElement('td');
  name.className = 'name';
  name.title = entry.path;
  name.innerHTML = `<i class="bi bi-${entry.dir ? 'folder' : 'file-earmark'}"></i> `;
  name.append(entry.name);
  const bytes = document.createElement('td');
  bytes.className = 'size';
  bytes.textContent = size(entry.size);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'atrium-btn atrium-btn-secondary';
  button.textContent = t('extract');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    extract(entry).catch(failed);
  });
  const actions = document.createElement('td');
  actions.className = 'actions';
  actions.append(button);
  const tr = document.createElement('tr');
  tr.append(name, bytes, actions);
  if (entry.dir) {
    tr.className = 'dir';
    tr.tabIndex = 0;
    tr.addEventListener('click', () => open(entry.path).catch(failed));
    tr.addEventListener('keydown', (event) => event.key === 'Enter' && event.target === tr && open(entry.path).catch(failed));
  }
  return tr;
}

async function open(path) {
  const entries = await busy(t('loading'), () => tessera.arc.list(path));
  current = path;
  where.textContent = path || '/';
  up.disabled = !path;
  list.replaceChildren(...entries.map(row));
  table.hidden = false;
  status.textContent = t('empty');
  status.hidden = entries.length > 0;
}

up.addEventListener('click', () => open(parentOf(current)).catch(failed));
document.getElementById('pick').addEventListener('click', () =>
  tessera.external
    .pick()
    .then((picked) => picked && open(''))
    .catch(failed),
);

tessera.ready
  .then(async () => {
    if ((await tessera.external.info()).picked) await open('');
  })
  .catch(failed);
