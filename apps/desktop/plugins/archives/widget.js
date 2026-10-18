const list = document.getElementById('list');
const empty = document.getElementById('empty');
let busy = false;

async function run(action, path) {
  if (busy) return;
  busy = true;
  document.body.setAttribute('aria-busy', 'true');
  try {
    await action(path);
  } catch (error) {
    failed(error);
  } finally {
    busy = false;
    document.body.removeAttribute('aria-busy');
  }
}

function button(label, icon, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'atrium-btn atrium-btn-secondary';
  node.innerHTML = `<i class="bi bi-${icon}"></i> `;
  node.append(label);
  node.addEventListener('click', onClick);
  return node;
}

function row(path) {
  const name = document.createElement('td');
  name.className = 'name';
  name.title = path;
  const folder = document.createElement('span');
  folder.className = 'folder';
  folder.textContent = path.slice(0, path.lastIndexOf('/') + 1);
  name.append(folder, base(path));
  const actions = document.createElement('td');
  actions.className = 'actions';
  actions.append(button(t('extract'), 'box-arrow-up', () => run(extract, path)), button(t('repack'), 'box-arrow-in-down', () => run(repack, path)));
  const tr = document.createElement('tr');
  tr.append(name, actions);
  return tr;
}

async function refresh() {
  const paths = (await walk('', [], ARCHIVE)).sort((a, b) => a.localeCompare(b));
  list.replaceChildren(...paths.map(row));
  empty.hidden = paths.length > 0;
}

let pending;
tessera.files.watch(() => {
  clearTimeout(pending);
  pending = setTimeout(() => refresh().catch(() => {}), 300);
});
tessera.ready.then(refresh).catch(failed);
