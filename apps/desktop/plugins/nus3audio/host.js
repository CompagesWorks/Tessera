tessera.on('fileAction', ({ id, paths }) => {
  if (id !== 'edit-external') return;
  (async () => {
    if (!(await tessera.exec.systemInfo()).editor && !(await tessera.exec.pickSystem('editor'))) return;
    await tessera.exec.runSystem('editor', [], { detach: true, projectFile: paths[0] });
  })().catch((error) => tessera.ui.toast('error', String(error.message ?? error)));
});
