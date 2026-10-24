const t = (key, params) => tessera.i18n.t(key, params);
const PRC = /\.(prc|stprm|stdat)$/i;
const LABELS = 'https://raw.githubusercontent.com/ultimate-research/param-labels/master/ParamLabels.csv';
const LIMIT = 300;

const picker = document.getElementById('file');
const filter = document.getElementById('filter');
const save = document.getElementById('save');
const list = document.getElementById('list');
const more = document.getElementById('more');
const empty = document.getElementById('empty');
const labels = new Map();
const edits = new Map();
let root = null;
let rows = [];
let path = '';

function failed(error) {
  const key = `error.${error.message}`;
  tessera.ui.toast('error', t(key) === key ? String(error.message ?? error) : t(key));
}

async function walk(dir, found) {
  for (const entry of await tessera.files.list(dir)) {
    if (entry.kind === 'dir') await walk(entry.path, found);
    else if (PRC.test(entry.name)) found.push(entry.path);
  }
  return found;
}

function name(hash) {
  return labels.get(hash) ?? `0x${hash.toString(16).padStart(10, '0')}`;
}

function shown(node, value = node.value) {
  if (node.type === 'hash40') return name(value);
  if (node.type === 'float') return String(Number(value.toPrecision(7)));
  return String(value);
}

function tag(node, index) {
  const first = node.type === 'struct' ? node.children[0]?.param : null;
  return first && (first.type === 'hash40' || first.type === 'string') ? `${index}:${shown(first)}` : String(index);
}

function flatten(node, prefix, out) {
  if (node.type === 'struct') {
    for (const child of node.children) flatten(child.param, prefix ? `${prefix}.${name(child.hash)}` : name(child.hash), out);
  } else if (node.type === 'list') {
    node.children.forEach((child, index) => flatten(child, `${prefix}[${tag(child, index)}]`, out));
  } else {
    out.push({ path: prefix, node, search: `${prefix} ${shown(node)}`.toLowerCase() });
  }
  return out;
}

function dirty() {
  save.disabled = edits.size === 0;
  save.textContent = edits.size ? t('saveCount', { count: edits.size }) : t('save');
}

function edit(node, value, input) {
  if (value === node.value) edits.delete(node);
  else edits.set(node, value);
  input.classList.toggle('is-edited', edits.has(node));
  dirty();
}

function row({ path: label, node }) {
  const param = document.createElement('td');
  param.className = 'param';
  param.textContent = label;
  param.title = label;
  const input = document.createElement('input');
  input.setAttribute('aria-label', label);
  if (node.type === 'bool') {
    input.type = 'checkbox';
    input.checked = edits.get(node) ?? node.value;
    input.addEventListener('change', () => edit(node, input.checked, input));
  } else {
    input.className = 'atrium-input';
    input.value = shown(node, edits.has(node) ? edits.get(node) : node.value);
    input.addEventListener('input', () => {
      try {
        const value = prcValue(node.type, input.value);
        if (node.type === 'hash40' && !/^0x/i.test(input.value.trim())) labels.set(value, input.value.trim());
        input.removeAttribute('aria-invalid');
        edit(node, value, input);
      } catch {
        input.setAttribute('aria-invalid', 'true');
      }
    });
  }
  input.classList.toggle('is-edited', edits.has(node));
  const value = document.createElement('td');
  value.append(input);
  const type = document.createElement('td');
  type.className = 'type';
  type.textContent = node.type;
  const tr = document.createElement('tr');
  tr.append(param, value, type);
  return tr;
}

function show() {
  const terms = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched = rows.filter((r) => terms.every((term) => r.search.includes(term)));
  list.replaceChildren(...matched.slice(0, LIMIT).map(row));
  more.hidden = matched.length <= LIMIT;
  more.textContent = t('more', { shown: LIMIT, count: matched.length });
}

function rebuild() {
  rows = root ? flatten(root, '', []) : [];
  show();
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
  root = null;
  rebuild();
  if (!path) return;
  try {
    root = parsePrc(await tessera.files.readBytes(path));
    rebuild();
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

async function loadLabels() {
  try {
    const response = await tessera.net.fetch(LABELS, { responseType: 'text' });
    if (response.status !== 200) throw new Error(response.statusText);
    for (const line of response.body.split('\n')) {
      const comma = line.indexOf(',');
      const label = line.slice(comma + 1).trim();
      if (comma > 2 && label) labels.set(parseInt(line.slice(2, comma), 16), label);
    }
    rebuild();
  } catch {
    tessera.ui.toast('warning', t('labelsFailed'));
  }
}

save.addEventListener('click', async () => {
  if (!root || edits.size === 0) return;
  const previous = [...edits.keys()].map((node) => [node, node.value]);
  try {
    for (const [node, value] of edits) node.value = value;
    const bytes = writePrc(root);
    await tessera.files.writeBytes(path, bytes);
    root = parsePrc(bytes);
    edits.clear();
    dirty();
    rebuild();
    tessera.ui.toast('success', t('saved', { name: path.slice(path.lastIndexOf('/') + 1) }));
  } catch (error) {
    for (const [node, value] of previous) node.value = value;
    failed(error);
  }
});

picker.addEventListener('change', () => open(picker.value));
filter.addEventListener('input', show);
tessera.on('files.selected', ({ path: selected }) => {
  if (selected && PRC.test(selected) && selected !== path) open(selected);
});
tessera.on('files.dropped', ({ paths }) => {
  if (PRC.test(paths[0])) open(paths[0]);
  else tessera.ui.toast('warning', t('notPrc', { name: paths[0] }));
});

let pending;
tessera.files.watch(() => {
  clearTimeout(pending);
  pending = setTimeout(() => refresh().catch(() => {}), 300);
});
tessera.ready
  .then(async () => {
    loadLabels();
    await refresh((await tessera.widget.getState())?.path);
  })
  .catch(failed);
