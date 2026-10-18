const ACTIONS = { extract: quickExtract, repack };

tessera.on('fileAction', ({ id, paths }) => {
  ACTIONS[id]?.(paths[0]).catch(failed);
});
