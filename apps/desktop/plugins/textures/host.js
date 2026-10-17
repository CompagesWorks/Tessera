const options = (pairs) => pairs.map(([value, label]) => ({ value, label }));

async function convert(path) {
  const input = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const values = await tessera.ui.form({
    title: t('form.title'),
    icon: 'arrow-repeat',
    message: path,
    confirmText: t('convert'),
    fields: [
      { type: 'select', id: 'output', label: t('column.output'), options: options(OUTPUTS.filter((type) => type !== input).map((type) => [type, `.${type}`])), value: input === 'nutexb' ? 'png' : 'nutexb' },
      { type: 'select', id: 'format', label: t('form.format'), options: options([['', t('auto')], ...FORMATS.map((format) => [format, format])]), value: '' },
      { type: 'select', id: 'mipmaps', label: t('column.mipmaps'), options: options(MIPMAPS.map(([value, key]) => [value, t(key)])), value: 'GeneratedAutomatic' },
      { type: 'select', id: 'quality', label: t('quality'), options: options([['Fast', t('quality.fast')], ['Normal', t('quality.normal')], ['Slow', t('quality.slow')]]), value: 'Normal' },
    ],
  });
  if (!values) return;
  const to = path.replace(/\.[^./]+$/, `.${values.output}`);
  tessera.ui.toast('info', t('converting', { name: path.slice(path.lastIndexOf('/') + 1) }));
  await tessera.textures.convert(path, to, { format: values.format || undefined, mipmaps: values.mipmaps, quality: values.quality });
  tessera.ui.toast('success', t('created', { name: to.slice(to.lastIndexOf('/') + 1) }));
}

tessera.on('fileAction', ({ id, paths }) => {
  if (id !== 'convert') return;
  convert(paths[0]).catch((error) => tessera.ui.toast('error', String(error.message ?? error)));
});
