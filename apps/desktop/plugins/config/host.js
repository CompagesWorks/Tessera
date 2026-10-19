const t = (key, params) => tessera.i18n.t(key, params);
const MOD_ROOT = 'sources/';
const CONFIG_PATH = `${MOD_ROOT}config.json`;
const ERRORS = ['no-dir', 'invalid-config', 'outside'];

async function addFile(path) {
  if (!path.startsWith(MOD_ROOT) || path === CONFIG_PATH) throw new Error('outside');
  const entries = await tessera.files.list(MOD_ROOT.slice(0, -1));
  const exists = entries.some((entry) => entry.path === CONFIG_PATH && entry.kind === 'file');
  const text = exists ? await tessera.files.readText(CONFIG_PATH) : '';
  const file = path.slice(MOD_ROOT.length);
  const result = addToConfig(text, file);
  if (!result.added) return tessera.ui.toast('info', t('already', { file }));
  await tessera.files.writeText(CONFIG_PATH, result.text);
  tessera.ui.toast('success', t('added', { file, dir: result.dir }));
}

tessera.on('fileAction', ({ id, paths }) => {
  if (id !== 'add') return;
  addFile(paths[0]).catch((error) => {
    const message = String(error.message ?? error);
    tessera.ui.toast('error', ERRORS.includes(message) ? t(`error.${message}`) : message);
  });
});
