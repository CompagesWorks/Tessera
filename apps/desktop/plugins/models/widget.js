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
const bonesList = document.getElementById('bones');
const animPicker = document.getElementById('anim');
const play = document.getElementById('play');
const slider = document.getElementById('frame');
const frameLabel = document.getElementById('frame-label');
const speed = document.getElementById('speed');
const loop = document.getElementById('loop');
const filesList = document.getElementById('files');
const tabs = { meshes: document.getElementById('tab-meshes'), materials: document.getElementById('tab-materials'), bones: document.getElementById('tab-bones'), files: document.getElementById('tab-files') };
const panels = { meshes, materials, bones: bonesList, files: filesList };
const images = new Map();
let viewer = null;
let path = '';
let box = null;
let loading = 0;
let model = null;
let selected = null;
let anims = [];
let motion = null;
let playing = false;
let last = 0;
let picked = null;

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
    else if (MODEL.test(entry.name)) found.models.push(entry.path);
    else if (ANIM.test(entry.name)) found.anims.push(entry.path);
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
  check.addEventListener('change', () => showMesh(index, check.checked));
  object.check = check;
  const name = document.createElement('span');
  name.textContent = object.name;
  name.title = object.name;
  const material = materialButton(object.material);
  material.setAttribute('aria-label', t('material.for', { name: object.name }));
  material.addEventListener('click', () => openMaterialMenu(material, object.material, (label) => {
    assignMaterial(model.modl, object, label);
    material.replaceChildren(...materialButton(label).childNodes);
    model.modlDirty = true;
    dirty();
    applyTextures(retexture(model.list, model.matl));
    li.dataset.search = `${object.name}\n${object.material}`.toLowerCase();
    materials.replaceChildren(...(model.matl?.entries ?? []).map(materialRow));
    show();
  }));
  li.append(check, name, material);
  li.addEventListener('pointerenter', () => viewer?.setHighlight(index));
  li.addEventListener('pointerleave', () => viewer?.setHighlight(picked));
  li.addEventListener('focusin', () => viewer?.setHighlight(index));
  li.addEventListener('focusout', () => viewer?.setHighlight(picked));
  return li;
}

function swatch(label) {
  const box = document.createElement('span');
  box.className = 'swatch';
  const texture = label ? colorTextures(model.matl).get(label) : null;
  if (texture) {
    image(texture).then((img) => {
      if (img) box.style.backgroundImage = `url(${img.src})`;
    });
  }
  return box;
}

function materialButton(label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'atrium-input material-pick';
  button.setAttribute('aria-haspopup', 'listbox');
  const name = document.createElement('span');
  name.textContent = label || '—';
  button.append(swatch(label), name, Object.assign(document.createElement('i'), { className: 'bi bi-chevron-down' }));
  return button;
}

let closeMenu = null;
function openMaterialMenu(anchor, current, choose) {
  closeMenu?.();
  const menu = document.createElement('div');
  menu.className = 'material-menu';
  menu.role = 'listbox';
  for (const label of labels()) {
    const option = document.createElement('button');
    option.type = 'button';
    option.role = 'option';
    option.setAttribute('aria-selected', String(label === current));
    const name = document.createElement('span');
    name.textContent = label;
    option.append(swatch(label), name);
    option.addEventListener('click', () => {
      closeMenu();
      if (label !== current) choose(label);
    });
    menu.append(option);
  }
  const box = anchor.getBoundingClientRect();
  const below = innerHeight - box.bottom;
  Object.assign(menu.style, { left: `${box.left}px`, width: `${Math.max(box.width, 180)}px` });
  if (below < 220 && box.top > below) Object.assign(menu.style, { bottom: `${innerHeight - box.top + 2}px`, maxHeight: `${box.top - 8}px` });
  else Object.assign(menu.style, { top: `${box.bottom + 2}px`, maxHeight: `${below - 8}px` });
  document.body.append(menu);
  (menu.querySelector('[aria-selected="true"]') ?? menu.firstChild)?.focus();
  const outside = (event) => !menu.contains(event.target) && !anchor.contains(event.target) && closeMenu();
  const keys = (event) => {
    const options = [...menu.children];
    const at = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      closeMenu();
      anchor.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      options[(at + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
    }
  };
  const scrolled = (event) => !menu.contains(event.target) && closeMenu();
  addEventListener('pointerdown', outside, true);
  addEventListener('scroll', scrolled, true);
  menu.addEventListener('keydown', keys);
  closeMenu = () => {
    menu.remove();
    removeEventListener('pointerdown', outside, true);
    removeEventListener('scroll', scrolled, true);
    closeMenu = null;
  };
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
  li.classList.toggle('is-selected', entry === selected);
  li.append(button);
  return li;
}

function edited() {
  model.matlDirty = true;
  dirty();
}

function materialsChanged() {
  edited();
  materials.replaceChildren(...(model.matl?.entries ?? []).map(materialRow));
  meshes.replaceChildren(...model.list.map(meshRow));
  show();
  applyTextures(retexture(model.list, model.matl));
}

function inspect(entry) {
  selected = entry;
  inspector.hidden = entry === null;
  for (const li of materials.children) li.classList.toggle('is-selected', li.dataset.label === entry?.material_label);
  if (!entry) return params.replaceChildren();
  document.getElementById('material-name').textContent = entry.material_label;
  document.getElementById('material-shader').textContent = entry.shader_label;
  const scroll = params.scrollTop;
  params.replaceChildren(
    ...materialEditor(entry, t, {
      change: (id) => {
        edited();
        if (id.startsWith('Texture')) applyTextures(retexture(model.list, model.matl));
      },
      rebuild: () => {
        edited();
        applyTextures(retexture(model.list, model.matl));
        inspect(entry);
      },
    }),
  );
  params.scrollTop = scroll;
}

async function renameSelected() {
  const entry = selected;
  const values = await tessera.ui.form({
    title: t('material.rename'),
    icon: 'pencil',
    confirmText: t('material.renameConfirm'),
    fields: [
      { type: 'text', id: 'label', label: t('material.label'), value: entry.material_label },
      { type: 'text', id: 'shader', label: t('material.shader'), value: entry.shader_label },
    ],
  });
  if (!values || selected !== entry) return;
  const label = values.label.trim();
  if (!renameMaterial(model.matl, model.modl, model.list, entry.material_label, label)) return tessera.ui.toast('warning', t('material.taken', { name: label }));
  if (values.shader.trim()) entry.shader_label = values.shader.trim();
  if (model.modl.entries.some((e) => e.material_label === label)) model.modlDirty = true;
  materialsChanged();
  inspect(entry);
}

function duplicateSelected() {
  const copy = duplicateMaterial(model.matl, selected.material_label);
  materialsChanged();
  select('materials');
  inspect(copy);
}

function deleteSelected() {
  const label = selected.material_label;
  if (!deleteMaterial(model.matl, model.modl, label)) return tessera.ui.toast('warning', t('material.inUse', { name: label }));
  inspect(null);
  materialsChanged();
  tessera.ui.toast('info', t('material.deleted', { name: label }));
}

function pickMesh(index) {
  picked = index;
  viewer.setHighlight(index);
  [...meshes.children].forEach((li, i) => li.classList.toggle('is-selected', i === index));
  if (index === null) return;
  const li = meshes.children[index];
  if (li.hidden) {
    filter.value = '';
    show();
  }
  select('meshes');
  li.scrollIntoView({ block: 'nearest' });
}

function showMesh(index, visible) {
  const object = model.list[index];
  object.visible = visible;
  object.check.checked = visible;
  viewer.setVisible(index, visible);
}

const FILE_ICONS = { numshb: 'triangle', numdlb: 'triangle', numshexb: 'triangle', nusktb: 'diagram-3', nuhlpb: 'bezier2', numatb: 'circle-half', nuanmb: 'film' };

function textureWarning({ width, height, format }) {
  return /^BC/.test(format ?? '') && (width % 4 || height % 4) ? t('warn.blocks', { width, height }) : '';
}

function fileRow(entry) {
  const li = document.createElement('li');
  li.className = 'file';
  li.title = entry.name;
  li.dataset.search = entry.name.toLowerCase();
  const ext = entry.name.split('.').pop().toLowerCase();
  const icon = document.createElement('i');
  icon.className = `bi bi-${FILE_ICONS[ext] ?? 'file-earmark'}`;
  const name = document.createElement('span');
  name.textContent = entry.name;
  li.append(icon, name);
  if (ext === 'nutexb') {
    const run = loading;
    image(entry.name.replace(/\.nutexb$/i, '')).then((img) => {
      if (run !== loading) return;
      if (!img) {
        icon.className = 'bi bi-exclamation-triangle warn';
        li.title = `${entry.name}\n${t('warn.unreadable')}`;
        return;
      }
      const thumb = img.cloneNode();
      thumb.className = 'thumb';
      thumb.alt = '';
      icon.replaceWith(thumb);
      const { width, height, format, mipmaps } = img.info;
      const warning = textureWarning(img.info);
      li.title = `${entry.name}\n${width}×${height} · ${format ?? ''} · ${t('mipmaps', { count: mipmaps })}${warning ? `\n⚠ ${warning}` : ''}`;
      if (warning) li.append(Object.assign(document.createElement('i'), { className: 'bi bi-exclamation-triangle warn' }));
    });
  }
  return li;
}

function boneRows(skel) {
  const depth = [];
  const level = (i) => (depth[i] ??= skel.bones[i].parent_index === null ? 0 : level(skel.bones[i].parent_index) + 1);
  return skel.bones.map((bone, i) => {
    const li = document.createElement('li');
    li.className = 'bone';
    li.style.paddingLeft = `${4 + Math.min(level(i), 24) * 10}px`;
    li.textContent = bone.name;
    li.title = bone.name;
    li.dataset.search = bone.name.toLowerCase();
    return li;
  });
}

function applyFrame() {
  if (!model?.skel) return;
  const frame = motion ? motion.frame : 0;
  const p = pose(model.skel, model.bind, motion?.anim ?? null, frame, model.hlpb);
  viewer.setPose(p);
  model.list.forEach((object, i) => {
    const visible = motion ? visibleBy(p.visibility, object.name) : object.initial;
    if (visible !== null && visible !== object.visible) showMesh(i, visible);
  });
  slider.value = String(Math.floor(frame));
  frameLabel.textContent = motion ? `${Math.floor(frame)} / ${motion.frames - 1}` : '0 / 0';
}

function setPlaying(next) {
  playing = next && Boolean(motion);
  play.replaceChildren(Object.assign(document.createElement('i'), { className: playing ? 'bi bi-pause-fill' : 'bi bi-play-fill' }));
  play.title = t(playing ? 'pause' : 'play');
  play.setAttribute('aria-label', play.title);
  if (playing) {
    if (!loop.checked && motion.frame >= motion.frames - 1) motion.frame = 0;
    last = performance.now();
    requestAnimationFrame(tick);
  }
}

function tick(now) {
  if (!playing || !motion) return;
  const next = motion.frame + (Math.max(now - last, 0) / 1000) * 60 * (Number(speed.value) || 1);
  last = now;
  motion.frame = loop.checked ? next % motion.frames : Math.min(next, motion.frames - 1);
  applyFrame();
  if (!loop.checked && motion.frame >= motion.frames - 1) return setPlaying(false);
  requestAnimationFrame(tick);
}

function animOptions() {
  const folders = path ? motionFolders(path) : [];
  const list = anims.filter((a) => folders.includes(folderOf(a)));
  if (motion && !list.includes(motion.path)) list.unshift(motion.path);
  animPicker.replaceChildren(new Option(t('anim.none'), ''), ...list.map((a) => new Option(a.slice(a.lastIndexOf('/') + 1), a)));
  animPicker.value = motion?.path ?? '';
  animPicker.disabled = !model?.skel;
}

async function openAnim(next) {
  setPlaying(false);
  motion = null;
  slider.disabled = play.disabled = true;
  if (next && model?.skel) {
    const run = loading;
    try {
      say('loadingAnim');
      const anim = await tessera.ssbh.read(next);
      if (run !== loading) return;
      motion = { path: next, anim, frames: frameCount(anim), frame: 0 };
      slider.max = String(motion.frames - 1);
      slider.disabled = play.disabled = false;
    } catch (error) {
      failed(error);
    }
    say('');
  }
  animOptions();
  applyFrame();
  if (motion) setPlaying(true);
}

function show() {
  const query = filter.value.trim().toLowerCase();
  for (const list of [meshes, materials, bonesList, filesList]) for (const li of list.children) li.hidden = query !== '' && !li.dataset.search.includes(query);
}

function select(tab) {
  for (const [name, button] of Object.entries(tabs)) button.setAttribute('aria-selected', String(name === tab));
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== tab;
}

function image(name) {
  const key = name.toLowerCase();
  if (!images.has(key)) {
    const file = model.files.get(`${key}.nutexb`);
    const load = async () => {
      const { data, width, height, format, mipmaps } = await tessera.textures.preview(file);
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      return Object.assign(img, { info: { width, height, format, mipmaps } });
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
  closeMenu?.();
  model = null;
  picked = null;
  setPlaying(false);
  motion = null;
  images.clear();
  dirty();
  inspect(null);
  meshes.replaceChildren();
  materials.replaceChildren();
  bonesList.replaceChildren();
  filesList.replaceChildren();
  animOptions();
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
    const helpers = entries.find((e) => /\.nuhlpb$/i.test(e.name))?.path;
    const [objects, matl, skel, hlpb] = await Promise.all([
      tessera.ssbh.meshes(mesh, skeleton),
      matlPath ? tessera.ssbh.read(matlPath) : null,
      skeleton ? tessera.ssbh.read(skeleton) : null,
      skeleton && helpers ? tessera.ssbh.read(helpers).catch(() => null) : null,
    ]);
    if (run !== loading) return;
    const list = drawList(modl, matl, objects);
    for (const object of list) object.initial = object.visible;
    model = { modl, matl, matlPath, list, files, skel, hlpb, bind: skel && bindPose(skel), modlDirty: false, matlDirty: false };
    textureNames.replaceChildren(...entries.filter((e) => /\.nutexb$/i.test(e.name)).map((e) => new Option(e.name.replace(/\.nutexb$/i, ''))));
    box = bounds(list);
    viewer.setObjects(list, box);
    meshes.replaceChildren(...list.map(meshRow));
    materials.replaceChildren(...(matl?.entries ?? []).map(materialRow));
    bonesList.replaceChildren(...(skel ? boneRows(skel) : []));
    filesList.replaceChildren(...entries.filter((e) => e.kind !== 'dir').map(fileRow));
    show();
    viewer.setSkeleton(skel ? skel.bones.map((b) => b.parent_index) : []);
    applyFrame();
    animOptions();
    await tessera.widget.setState({ path });
    await applyTextures(list.map((_, i) => i).filter((i) => list[i].texture));
    if (run === loading) say('');
  } catch (error) {
    if (run === loading) say('');
    failed(error);
  }
}

async function refresh(wanted = path) {
  const found = await walk('', { models: [], anims: [] });
  const paths = found.models.sort((a, b) => a.localeCompare(b));
  anims = found.anims.sort((a, b) => a.localeCompare(b));
  picker.replaceChildren(...paths.map((p) => new Option(p, p)));
  empty.hidden = paths.length > 0;
  view.hidden = paths.length === 0;
  picker.hidden = paths.length === 0;
  if (wanted !== path || !paths.includes(path)) await open(paths.includes(wanted) ? wanted : (paths[0] ?? ''));
  else {
    picker.value = path;
    animOptions();
  }
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
tabs.bones.addEventListener('click', () => select('bones'));
tabs.files.addEventListener('click', () => select('files'));
animPicker.addEventListener('change', () => openAnim(animPicker.value));
play.addEventListener('click', () => setPlaying(!playing));
slider.addEventListener('input', () => {
  if (!motion) return;
  setPlaying(false);
  motion.frame = Number(slider.value);
  applyFrame();
});
const canvas = document.getElementById('canvas');
let hovering = 0;
canvas.addEventListener('pointermove', (event) => {
  if (!event.ctrlKey || event.buttons || !model || hovering) return;
  const { clientX, clientY } = event;
  hovering = requestAnimationFrame(() => {
    hovering = 0;
    viewer.setHighlight(viewer.pick(clientX, clientY) ?? picked);
  });
});
canvas.addEventListener('pointerdown', (event) => {
  if (event.ctrlKey && event.button === 0 && model) pickMesh(viewer.pick(event.clientX, event.clientY));
});
canvas.addEventListener('pointerleave', () => viewer?.setHighlight(picked));
addEventListener('keyup', (event) => event.key === 'Control' && viewer?.setHighlight(picked));
document.getElementById('show-bones').addEventListener('change', (event) => viewer?.setBonesVisible(event.target.checked));
document.getElementById('close').addEventListener('click', () => inspect(null));
document.getElementById('rename').addEventListener('click', () => selected && renameSelected().catch(failed));
document.getElementById('duplicate').addEventListener('click', () => selected && duplicateSelected());
document.getElementById('delete').addEventListener('click', () => selected && deleteSelected());
document.getElementById('reset').addEventListener('click', () => {
  if (viewer && box) viewer.fit(box);
});
tessera.on('files.selected', ({ path: selected }) => {
  if (selected && MODEL.test(selected) && selected !== path) open(selected);
  if (selected && ANIM.test(selected) && model?.skel && selected !== motion?.path) openAnim(selected);
});
tessera.on('files.dropped', ({ paths }) => {
  if (MODEL.test(paths[0])) open(paths[0]);
  else if (ANIM.test(paths[0]) && model?.skel) openAnim(paths[0]);
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
