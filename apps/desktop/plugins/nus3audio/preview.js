const list = document.getElementById('list');
let files = [];

function render() {
  list.replaceChildren(
    ...files.map((file) => {
      const name = document.createElement('td');
      name.textContent = file.name;
      const info = document.createElement('td');
      info.className = 'info';
      info.textContent = `.${nus3Format(file.data)} · ${(file.data.length / 1024).toFixed(0)} KB`;
      const actions = document.createElement('td');
      actions.className = 'actions';
      if (file.data.length) {
        actions.append(listenButton(file));
      }
      const tr = document.createElement('tr');
      tr.append(name, info, actions);
      return tr;
    }),
  );
}

onPlayingChange = render;

tessera.ready
  .then(async () => {
    const { path } = (await tessera.widget.getState()) ?? {};
    if (!path) return;
    const name = path.slice(path.lastIndexOf('/') + 1);
    const data = await busy(t('opening', { name }), async () => new Uint8Array(await tessera.files.readBytes(path)));
    files = /\.nus3audio$/i.test(path) ? parseNus3audio(data).files : [{ name, data }];
    render();
  })
  .catch(failed);
