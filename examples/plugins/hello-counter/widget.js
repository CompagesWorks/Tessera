(async () => {
  const valueEl = document.getElementById('value');
  const listEl = document.getElementById('list');

  await tessera.ready;
  const state = await tessera.widget.getState();
  let count = typeof state.count === 'number' ? state.count : 0;
  valueEl.textContent = String(count);

  const project = await tessera.project.info();
  document.getElementById('project').textContent = project.name;

  const update = (delta) => {
    count += delta;
    valueEl.textContent = String(count);
    tessera.widget.setState({ count });
  };
  document.getElementById('plus').addEventListener('click', () => update(1));
  document.getElementById('minus').addEventListener('click', () => update(-1));

  document.getElementById('files').addEventListener('click', async () => {
    try {
      const entries = await tessera.files.list('sources');
      listEl.replaceChildren(
        ...entries.map((entry) => {
          const li = document.createElement('li');
          li.textContent = `${entry.kind === 'dir' ? '📁' : '📄'} ${entry.name}`;
          return li;
        }),
      );
      tessera.ui.toast('success', `${entries.length} élément(s) dans sources/`);
    } catch (error) {
      tessera.ui.toast('error', error.message);
    }
  });
})();
