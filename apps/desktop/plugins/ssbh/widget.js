const t = (key, params) => tessera.i18n.t(key, params);

const picker = document.getElementById('file');
const view = document.getElementById('view');
const empty = document.getElementById('empty');
const filter = document.getElementById('filter');
const meshes = document.getElementById('meshes');
const status = document.getElementById('status');
let viewer = null;
let path = '';
let box = null;
let loading = 0;

function failed(error) {
  const key = `error.${error.message}`;
  tessera.ui.toast('error', t(key) === key ? String(error.message ?? error) : t(key));
}

function say(key, params) {
  status.hidden = !key;
  status.textContent = key ? t(key, params) : '';
}

async function walk(dir, found) {
  for (const entry of await tessera.files.list(dir)) {
    if (entry.kind === 'dir') await walk(entry.path, found);
    else if (MODEL.test(entry.name)) found.push(entry.path);
  }
  return found;
}

function row(object, index) {
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = object.visible;
  check.addEventListener('change', () => viewer.setVisible(index, check.checked));
  const name = document.createElement('span');
  name.textContent = object.name;
  const material = document.createElement('small');
  material.textContent = object.material ?? '';
  const label = document.createElement('label');
  label.title = object.material ? `${object.name}\n${object.material}` : object.name;
  label.append(check, name, material);
  const li = document.createElement('li');
  li.dataset.search = `${object.name}\n${object.material ?? ''}`.toLowerCase();
  li.append(label);
  return li;
}

function show() {
  const query = filter.value.trim().toLowerCase();
  for (const li of meshes.children) li.hidden = query !== '' && !li.dataset.search.includes(query);
}

async function texture(file) {
  const { data } = await tessera.textures.preview(file);
  const image = new Image();
  image.src = `data:image/png;base64,${data}`;
  await image.decode();
  return image;
}

async function open(next) {
  path = next;
  picker.value = path;
  meshes.replaceChildren();
  if (!path) return;
  const run = ++loading;
  try {
    viewer ??= createViewer(document.getElementById('canvas'));
    say('loading');
    const folder = folderOf(path);
    const files = new Map((await tessera.files.list(folder.slice(0, -1))).map((e) => [e.name.toLowerCase(), e.path]));
    const modl = await tessera.ssbh.read(path);
    const mesh = files.get(modl.mesh_file_name.toLowerCase());
    if (!mesh) throw new Error('noMesh');
    const skeleton = files.get(modl.skeleton_file_name.toLowerCase());
    const material = modl.material_file_names.map((n) => files.get(n.toLowerCase())).find(Boolean);
    const [objects, matl] = await Promise.all([tessera.ssbh.meshes(mesh, skeleton), material ? tessera.ssbh.read(material) : null]);
    if (run !== loading) return;
    const list = drawList(modl, matl, objects);
    box = bounds(list);
    viewer.setObjects(list, box);
    meshes.replaceChildren(...list.map(row));
    show();
    await tessera.widget.setState({ path });
    const byTexture = new Map();
    list.forEach((object, i) => object.texture && byTexture.set(object.texture, [...(byTexture.get(object.texture) ?? []), i]));
    let done = 0;
    await Promise.all(
      [...byTexture].map(async ([name, index]) => {
        const file = files.get(`${name.toLowerCase()}.nutexb`);
        if (file) {
          const image = await texture(file).catch(() => null);
          if (run !== loading) return;
          if (image) viewer.setTexture(index, image);
        }
        say(++done < byTexture.size ? 'textures' : '', { done, total: byTexture.size });
      }),
    );
    if (run === loading) say('');
  } catch (error) {
    if (run === loading) say('');
    failed(error);
  }
}

async function refresh(wanted = path) {
  const paths = (await walk('', [])).sort((a, b) => a.localeCompare(b));
  picker.replaceChildren(...paths.map((p) => new Option(p, p)));
  empty.hidden = paths.length > 0;
  view.hidden = paths.length === 0;
  picker.hidden = paths.length === 0;
  if (wanted !== path || !paths.includes(path)) await open(paths.includes(wanted) ? wanted : (paths[0] ?? ''));
  else picker.value = path;
}

picker.addEventListener('change', () => open(picker.value));
filter.addEventListener('input', show);
document.getElementById('reset').addEventListener('click', () => {
  if (viewer && box) viewer.fit(box);
});
tessera.on('files.selected', ({ path: selected }) => {
  if (selected && MODEL.test(selected) && selected !== path) open(selected);
});
tessera.on('files.dropped', ({ paths }) => {
  if (MODEL.test(paths[0])) open(paths[0]);
  else tessera.ui.toast('warning', t('notModel', { name: paths[0] }));
});

let pending;
tessera.files.watch(() => {
  clearTimeout(pending);
  pending = setTimeout(() => refresh().catch(() => {}), 300);
});
tessera.ready
  .then(async () => refresh((await tessera.widget.getState())?.path))
  .catch(failed);
