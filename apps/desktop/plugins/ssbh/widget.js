const t = (key, params) => tessera.i18n.t(key, params);

const picker = document.getElementById('file');
const view = document.getElementById('view');
const empty = document.getElementById('empty');
const filter = document.getElementById('filter');
const meshes = document.getElementById('meshes');
const materials = document.getElementById('materials');
const status = document.getElementById('status');
const save = document.getElementById('save');
const inspector = document.getElementById('inspector');
const params = document.getElementById('params');
const textureNames = document.getElementById('texture-names');
const tabs = { meshes: document.getElementById('tab-meshes'), materials: document.getElementById('tab-materials') };
const images = new Map();
let viewer = null;
let path = '';
let box = null;
let loading = 0;
let model = null;

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

function unsaved() {
  return Boolean(model?.modlDirty || model?.matlDirty);
}

function dirty() {
  save.disabled = !unsaved();
}

function labels() {
  return (model.matl?.entries ?? []).map((e) => e.material_label);
}

function meshRow(object, index) {
  const li = document.createElement('li');
  li.className = 'mesh';
  li.dataset.search = `${object.name}\n${object.material ?? ''}`.toLowerCase();
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = object.visible;
  check.setAttribute('aria-label', t('visible', { name: object.name }));
  check.addEventListener('change', () => viewer.setVisible(index, check.checked));
  const name = document.createElement('span');
  name.textContent = object.name;
  name.title = object.name;
  const material = document.createElement('select');
  material.className = 'atrium-input';
  material.setAttribute('aria-label', t('material.for', { name: object.name }));
  material.append(...[...new Set([...labels(), object.material ?? ''])].map((label) => new Option(label || '—', label)));
  material.value = object.material ?? '';
  material.addEventListener('change', () => {
    if (!material.value) return;
    assignMaterial(model.modl, object, material.value);
    model.modlDirty = true;
    dirty();
    applyTextures(retexture(model.list, model.matl));
    li.dataset.search = `${object.name}\n${object.material}`.toLowerCase();
    materials.replaceChildren(...(model.matl?.entries ?? []).map(materialRow));
    show();
  });
  li.append(check, name, material);
  return li;
}

function materialRow(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'material';
  const name = document.createElement('span');
  name.textContent = entry.material_label;
  const count = document.createElement('small');
  count.textContent = String(model.list.filter((o) => o.material === entry.material_label).length);
  count.title = t('usedBy', { count: count.textContent });
  button.append(name, count);
  button.title = `${entry.material_label}\n${entry.shader_label}`;
  button.addEventListener('click', () => inspect(entry));
  const li = document.createElement('li');
  li.dataset.search = `${entry.material_label}\n${entry.shader_label}`.toLowerCase();
  li.dataset.label = entry.material_label;
  li.classList.toggle('is-selected', !inspector.hidden && document.getElementById('material-name').textContent === entry.material_label);
  li.append(button);
  return li;
}

function inspect(entry) {
  inspector.hidden = entry === null;
  for (const li of materials.children) li.classList.toggle('is-selected', li.dataset.label === entry?.material_label);
  if (!entry) return params.replaceChildren();
  document.getElementById('material-name').textContent = entry.material_label;
  document.getElementById('material-shader').textContent = entry.shader_label;
  params.replaceChildren(
    ...materialEditor(entry, t, (id) => {
      model.matlDirty = true;
      dirty();
      if (id.startsWith('Texture')) applyTextures(retexture(model.list, model.matl));
    }),
  );
}

function show() {
  const query = filter.value.trim().toLowerCase();
  for (const list of [meshes, materials]) for (const li of list.children) li.hidden = query !== '' && !li.dataset.search.includes(query);
}

function select(tab) {
  for (const [name, button] of Object.entries(tabs)) button.setAttribute('aria-selected', String(name === tab));
  meshes.hidden = tab !== 'meshes';
  materials.hidden = tab !== 'materials';
}

function image(name) {
  const key = name.toLowerCase();
  if (!images.has(key)) {
    const file = model.files.get(`${key}.nutexb`);
    const load = async () => {
      const { data } = await tessera.textures.preview(file);
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      return img;
    };
    images.set(key, file ? load().catch(() => null) : Promise.resolve(null));
  }
  return images.get(key);
}

async function applyTextures(index) {
  const run = loading;
  const byTexture = new Map();
  for (const i of index) {
    const name = model.list[i].texture ?? '';
    byTexture.set(name, [...(byTexture.get(name) ?? []), i]);
  }
  let done = 0;
  await Promise.all(
    [...byTexture].map(async ([name, indices]) => {
      const img = name ? await image(name) : null;
      if (run !== loading) return;
      viewer.setTexture(indices, img);
      say(++done < byTexture.size ? 'textures' : '', { done, total: byTexture.size });
    }),
  );
}

async function open(next) {
  if (unsaved() && next !== path) {
    picker.value = path;
    return tessera.ui.toast('warning', t('saveFirst'));
  }
  path = next;
  picker.value = path;
  model = null;
  images.clear();
  dirty();
  inspect(null);
  meshes.replaceChildren();
  materials.replaceChildren();
  if (!path) return;
  const run = ++loading;
  try {
    viewer ??= createViewer(document.getElementById('canvas'));
    say('loading');
    const entries = await tessera.files.list(folderOf(path).slice(0, -1));
    const files = new Map(entries.map((e) => [e.name.toLowerCase(), e.path]));
    const modl = await tessera.ssbh.read(path);
    const mesh = files.get(modl.mesh_file_name.toLowerCase());
    if (!mesh) throw new Error('noMesh');
    const skeleton = files.get(modl.skeleton_file_name.toLowerCase());
    const matlPath = modl.material_file_names.map((n) => files.get(n.toLowerCase())).find(Boolean) ?? null;
    const [objects, matl] = await Promise.all([tessera.ssbh.meshes(mesh, skeleton), matlPath ? tessera.ssbh.read(matlPath) : null]);
    if (run !== loading) return;
    const list = drawList(modl, matl, objects);
    model = { modl, matl, matlPath, list, files, modlDirty: false, matlDirty: false };
    textureNames.replaceChildren(...entries.filter((e) => /\.nutexb$/i.test(e.name)).map((e) => new Option(e.name.replace(/\.nutexb$/i, ''))));
    box = bounds(list);
    viewer.setObjects(list, box);
    meshes.replaceChildren(...list.map(meshRow));
    materials.replaceChildren(...(matl?.entries ?? []).map(materialRow));
    show();
    await tessera.widget.setState({ path });
    await applyTextures(list.map((_, i) => i).filter((i) => list[i].texture));
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

save.addEventListener('click', async () => {
  if (!unsaved()) return;
  save.disabled = true;
  try {
    if (model.matlDirty) {
      await tessera.ssbh.write(model.matlPath, model.matl);
      model.matlDirty = false;
    }
    if (model.modlDirty) {
      await tessera.ssbh.write(path, model.modl);
      model.modlDirty = false;
    }
    tessera.ui.toast('success', t('saved'));
  } catch (error) {
    failed(error);
  }
  dirty();
});

picker.addEventListener('change', () => open(picker.value));
filter.addEventListener('input', show);
tabs.meshes.addEventListener('click', () => select('meshes'));
tabs.materials.addEventListener('click', () => select('materials'));
document.getElementById('close').addEventListener('click', () => inspect(null));
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
