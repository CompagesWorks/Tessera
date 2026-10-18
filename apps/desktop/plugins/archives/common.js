const t = (key, params) => tessera.i18n.t(key, params);
const ARCHIVE = /\.(arc|sarc|szs|pack)$/i;
const UNSAFE = /(^|[\\/])\.\.([\\/]|$)|^[\\/]|:/;

const base = (path) => path.slice(path.lastIndexOf('/') + 1);
const folderOf = (path) => path.replace(/\.([^./]+)$/, '_$1');

function failed(error) {
  const key = `error.${error.message}`;
  tessera.ui.toast('error', t(key) === key ? String(error.message ?? error) : t(key));
}

async function walk(dir, found, match) {
  for (const entry of await tessera.files.list(dir)) {
    if (entry.kind === 'dir') await walk(entry.path, found, match);
    else if (!match || match.test(entry.name)) found.push(entry.path);
  }
  return found;
}

async function exists(path) {
  const entries = await tessera.files.list(path.slice(0, path.lastIndexOf('/') + 1)).catch(() => []);
  return entries.some((entry) => entry.path === path);
}

async function ask(title, message, folder, confirmText) {
  const values = await tessera.ui.form({ title, icon: 'archive', message: message.slice(0, 300), confirmText, fields: [{ type: 'text', id: 'folder', label: t('folder'), value: folder }] });
  return values ? String(values.folder).trim().replace(/\/+$/, '') : null;
}

async function extract(path) {
  const suggested = folderOf(path);
  const folder = await ask(t('extract.title'), (await exists(suggested)) ? t('extract.overwrite', { name: base(path) }) : base(path), suggested, t('extract'));
  if (!folder) return;
  await extractTo(path, folder);
}

async function extractTo(path, folder, keep = new Set()) {
  const archive = readArchive(await tessera.files.readBytes(path));
  if (archive.files.some((file) => UNSAFE.test(file.name))) throw new Error('unsafe-name');
  const missing = archive.files.filter((file) => !keep.has(`${folder}/${file.name}`));
  if (missing.length === 0) return tessera.ui.toast('info', t('alreadyExtracted', { folder }));
  for (const file of missing) await tessera.files.writeBytes(`${folder}/${file.name}`, file.data);
  tessera.ui.toast('success', t('extracted', { count: missing.length, folder }));
}

async function quickExtract(path) {
  const folder = folderOf(path);
  await extractTo(path, folder, new Set(await walk(folder, []).catch(() => [])));
}

async function repack(path) {
  const folder = await ask(t('repack.title'), t('repack.replace', { name: base(path) }), folderOf(path), t('repack'));
  if (!folder) return;
  const original = readArchive(await tessera.files.readBytes(path));
  const aligns = new Map(original.files.map((file) => [file.name, file.align]));
  const paths = await walk(folder, []).catch(() => []);
  if (paths.length === 0) throw new Error('empty-folder');
  const files = [];
  for (const file of paths) {
    const name = file.slice(folder.length + 1);
    files.push({ name, data: await tessera.files.readBytes(file), align: aligns.get(name) ?? (/\.bntx$/i.test(name) ? 0x1000 : 8) });
  }
  await tessera.files.writeBytes(path, writeArchive({ ...original, files }));
  tessera.ui.toast('success', t('repacked', { count: files.length, name: base(path) }));
}
