const t = (key, params) => tessera.i18n.t(key, params);
const MSBT = /\.x?msbt$/i;
const XML = /\.xmsbt$/i;

const picker = document.getElementById('file');
const filter = document.getElementById('filter');
const save = document.getElementById('save');
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const edits = new Map();
let current = null;
let path = '';

function failed(error) {
  const key = `error.${error.message}`;
  tessera.ui.toast('error', t(key) === key ? String(error.message ?? error) : t(key));
}

async function walk(dir, found) {
  for (const entry of await tessera.files.list(dir)) {
    if (entry.kind === 'dir') await walk(entry.path, found);
    else if (MSBT.test(entry.name)) found.push(entry.path);
  }
  return found;
}

function dirty() {
  save.disabled = edits.size === 0;
  save.textContent = edits.size ? t('saveCount', { count: edits.size }) : t('save');
}

function row(entry) {
  const label = document.createElement('td');
  label.className = 'label';
  label.textContent = entry.label;
  label.title = entry.label;
  const text = document.createElement('textarea');
  text.className = 'atrium-input';
  text.value = entry.text;
  text.rows = Math.min(Math.max(entry.text.split('\n').length, 1), 6);
  text.setAttribute('aria-label', entry.label);
  text.addEventListener('input', () => {
    if (text.value === entry.text) edits.delete(entry.index);
    else edits.set(entry.index, text.value);
    text.classList.toggle('is-edited', edits.has(entry.index));
    dirty();
  });
  const cell = document.createElement('td');
  cell.append(text);
  const tr = document.createElement('tr');
  tr.append(label, cell);
  tr.dataset.search = `${entry.label}\n${entry.text}`.toLowerCase();
  return tr;
}

function show() {
  const query = filter.value.trim().toLowerCase();
  for (const tr of list.children) tr.hidden = query !== '' && !tr.dataset.search.includes(query);
}

async function open(next) {
  if (edits.size && next !== path) {
    picker.value = path;
    return tessera.ui.toast('warning', t('saveFirst'));
  }
  path = next;
  picker.value = path;
  edits.clear();
  dirty();
  current = null;
  list.replaceChildren();
  if (!path) return;
  try {
    current = (XML.test(path) ? parseXmsbt : parseMsbt)(await tessera.files.readBytes(path));
    list.replaceChildren(...current.entries.map(row));
    show();
    await tessera.widget.setState({ path });
  } catch (error) {
    failed(error);
  }
}

async function scanning(run) {
  const scan = document.getElementById('scan');
  scan.hidden = false;
  try {
    return await run();
  } finally {
    scan.hidden = true;
  }
}

async function refresh(wanted = path) {
  const paths = (await scanning(() => walk('', []))).sort((a, b) => a.localeCompare(b));
  picker.replaceChildren(...paths.map((p) => new Option(p, p)));
  empty.hidden = paths.length > 0;
  picker.hidden = paths.length === 0;
  if (wanted !== path || !paths.includes(path)) await open(paths.includes(wanted) ? wanted : (paths[0] ?? ''));
  else picker.value = path;
}

save.addEventListener('click', async () => {
  if (!current || edits.size === 0) return;
  try {
    const bytes = (current.xml ? writeXmsbt : writeMsbt)(current, edits);
    await tessera.files.writeBytes(path, bytes);
    current = (current.xml ? parseXmsbt : parseMsbt)(bytes);
    edits.clear();
    dirty();
    list.replaceChildren(...current.entries.map(row));
    show();
    tessera.ui.toast('success', t('saved', { name: path.slice(path.lastIndexOf('/') + 1) }));
  } catch (error) {
    failed(error);
  }
});

picker.addEventListener('change', () => open(picker.value));
filter.addEventListener('input', show);
tessera.on('files.selected', ({ path: selected }) => {
  if (selected && MSBT.test(selected) && selected !== path) open(selected);
});
tessera.on('files.dropped', ({ paths }) => {
  if (MSBT.test(paths[0])) open(paths[0]);
  else tessera.ui.toast('warning', t('notMsbt', { name: paths[0] }));
});

let pending;
tessera.files.watch(() => {
  clearTimeout(pending);
  pending = setTimeout(() => refresh().catch(() => {}), 300);
});
tessera.ready
  .then(async () => refresh((await tessera.widget.getState())?.path))
  .catch(failed);
