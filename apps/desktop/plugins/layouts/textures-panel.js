const imagePicker = document.getElementById('image-picker');
const textureList = document.getElementById('texture-list');
const sideTabs = document.getElementById('side-tabs');
let timgFolder = '';
let pickTarget = null;
const ADD = Symbol('add');
const FORMATS = [
  ['BC7RgbaUnormSrgb', 'format.bc7', '^u'],
  ['BC3RgbaUnormSrgb', 'format.bc3', '^u'],
  ['BC1RgbaUnormSrgb', 'format.bc1', '^u'],
  ['BC4RUnorm', 'format.bc4', '^s'],
  ['BC5RgUnorm', 'format.bc5', '^t'],
  ['Rgba8UnormSrgb', 'format.rgba8', '^u'],
];

function showSide(which) {
  for (const button of sideTabs.querySelectorAll('[data-side]')) button.setAttribute('aria-selected', String(button.dataset.side === which));
  props.hidden = which !== 'props';
  textureList.hidden = which !== 'textures';
}

async function reloadTexture(name) {
  textures.delete(name);
  await loadTextures([name], timgFolder, () => {});
  rasters.clear();
  scheduleDraw();
  refreshTextureList();
  if (selected === name) selectTexture(name);
}

async function replaceTexture(name, file) {
  const texture = textures.get(name);
  if (!texture?.file) return tessera.ui.toast('warning', t('tex.notInArchive'));
  try {
    await tessera.textures.replace(texture.file, texture.texture, new Uint8Array(await file.arrayBuffer()));
    await reloadTexture(name);
    tessera.ui.toast('success', t('tex.replaced', { name, size: `${texture.size[0]} × ${texture.size[1]}` }));
  } catch (error) {
    failed(error);
  }
}

async function exportTexture(name) {
  const texture = textures.get(name);
  if (!texture?.file) return tessera.ui.toast('warning', t('tex.notInArchive'));
  const to = `${folderOf(timgFolder)}_textures/${name}.png`;
  try {
    await tessera.textures.export(texture.file, texture.texture, to);
    tessera.ui.toast('success', t('tex.exported', { path: to }));
  } catch (error) {
    failed(error);
  }
}

async function combinedFile() {
  const files = (await tessera.files.list(timgFolder).catch(() => [])).filter((entry) => /\.bntx$/i.test(entry.name));
  return (files.find((entry) => entry.name === '__Combined.bntx') ?? files[0])?.path;
}

async function addTexture(file) {
  const bntx = await combinedFile();
  if (!bntx) return tessera.ui.toast('warning', t('tex.noBntx'));
  const stem = file.name.replace(/\.[^.]+$/, '').replace(/[^!-~]/g, '_');
  const values = await tessera.ui.form({
    title: t('tex.add.title'),
    icon: 'image',
    message: file.name,
    confirmText: t('tex.add'),
    fields: [
      { type: 'text', id: 'name', label: t('prop.name'), value: stem },
      { type: 'select', id: 'format', label: t('tex.format'), value: FORMATS[0][0], options: FORMATS.map(([value, key]) => ({ value, label: t(key) })) },
    ],
  });
  if (!values) return;
  const format = FORMATS.find(([value]) => value === values.format) ?? FORMATS[0];
  let name = String(values.name).trim();
  if (!name) return;
  if (!name.includes('^')) name += format[2];
  try {
    await tessera.textures.add(bntx, name, format[0], new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (!/already exists/.test(String(error.message))) return failed(error);
  }
  if (!layout.textures.includes(name)) {
    layout.textures.push(name);
    changed();
    buildTree();
  }
  await reloadTexture(name);
  tessera.ui.toast('success', t('tex.added', { name }));
}

function pickImage(name) {
  pickTarget = name;
  imagePicker.value = '';
  imagePicker.click();
}

function textureActions(name) {
  const available = Boolean(textures.get(name)?.file);
  const replace = element('button', { type: 'button', className: 'atrium-btn atrium-btn-secondary', disabled: !available, title: t('tex.replace.hint') }, [t('tex.replace')]);
  replace.addEventListener('click', () => pickImage(name));
  const save = element('button', { type: 'button', className: 'atrium-btn atrium-btn-secondary', disabled: !available }, [t('tex.export')]);
  save.addEventListener('click', () => exportTexture(name));
  return pair(replace, save);
}

function refreshTextureList() {
  if (!layout) return;
  const add = element('button', { type: 'button', className: 'atrium-btn atrium-btn-primary', title: t('tex.add.hint') }, [t('tex.add.button')]);
  add.addEventListener('click', () => pickImage(ADD));
  textureList.replaceChildren(
    element('li', { className: 'texture-add' }, [add]),
    ...layout.textures.map((name) => {
      const texture = textures.get(name);
      const thumb = texture ? element('img', { src: texture.url, className: 'thumb', alt: '' }) : element('span', { className: 'thumb missing', textContent: '?' });
      const info = element('div', { className: 'texture-info' }, [
        element('strong', { textContent: name, title: name }),
        element('small', { textContent: texture ? `${texture.format ?? ''} · ${texture.size[0]} × ${texture.size[1]}` : t('tex.notInArchive') }),
      ]);
      const row = element('li', { className: 'texture-row' }, [thumb, info, textureActions(name)]);
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) replaceTexture(name, file);
      });
      row.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        selectTexture(name);
        showSide('props');
      });
      return row;
    }),
  );
}

imagePicker.addEventListener('change', () => {
  const file = imagePicker.files[0];
  if (!file || !pickTarget) return;
  if (pickTarget === ADD) addTexture(file).catch(failed);
  else replaceTexture(pickTarget, file);
});
for (const button of sideTabs.querySelectorAll('[data-side]')) button.addEventListener('click', () => showSide(button.dataset.side));
