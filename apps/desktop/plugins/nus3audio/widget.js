const NUS3 = /\.nus3audio$/i;
const SOURCE = /\.(lopus|idsp|wav|mp3|ogg|flac|m4a)$/i;
const RAW = /\.(lopus|idsp)$/i;
const MAX_BYTES = 64 * 1024 * 1024;
const RATE = 48000;
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);

const picker = document.getElementById('file');
const create = document.getElementById('create');
const add = document.getElementById('add');
const save = document.getElementById('save');
const list = document.getElementById('list');
const empty = document.getElementById('empty');
let current = null;
let path = '';
let changed = false;
let selected = null;
onPlayingChange = () => render();

async function walk(dir, test, found) {
  for (const entry of await tessera.files.list(dir)) {
    if (entry.kind === 'dir') await walk(entry.path, test, found);
    else if (test.test(entry.name)) found.push(entry.path);
  }
  return found;
}

function dirty(value) {
  changed = value;
  save.disabled = !changed;
  add.disabled = !current;
}

async function toWav(file) {
  const raw = `track.${nus3Format(file.data)}`;
  const to = `${dirOf(path)}${file.name}.wav`;
  await tessera.files.private.writeBytes(raw, file.data);
  await run('vgmstream', ['-o', to, PRIVATE + raw]);
  tessera.ui.toast('success', t('created', { name: nameOf(to) }));
}

async function extract(file) {
  const to = `${dirOf(path)}${file.name}.${nus3Format(file.data)}`;
  await tessera.files.writeBytes(to, file.data);
  tessera.ui.toast('success', t('created', { name: nameOf(to) }));
}

async function encode(source, name, format) {
  const values = await tessera.ui.form({
    title: t('encode.title'),
    icon: 'music-note-beamed',
    message: name.slice(0, 300),
    confirmText: t('ok'),
    fields: [
      { type: 'select', id: 'format', label: t('format'), options: ['lopus', 'idsp'].map((value) => ({ value, label: `.${value}` })), value: format },
      { type: 'text', id: 'loop', label: t('loop'), placeholder: '0-1234567' },
    ],
  });
  if (!values) throw new Error('cancelled');
  const loop = values.loop.trim();
  if (loop && !/^\d+-\d+$/.test(loop)) throw new Error('bad-loop');
  const bytes = typeof source === 'string' ? new Uint8Array(await tessera.files.readBytes(source)) : new Uint8Array(await source.arrayBuffer());
  const audio = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes.buffer).catch(() => {
    throw new Error('bad-audio');
  });
  const wav = pcm16Wav(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)), RATE);
  if (wav.length > MAX_BYTES) throw new Error('too-big');
  await tessera.files.private.writeBytes('import.wav', wav);
  const out = `import.${values.format}`;
  await tessera.files.private.writeBytes(out, new Uint8Array(0));
  const output = await run('vgaudio', ['-c', '-i', `${PRIVATE}import.wav`, '-o', PRIVATE + out, ...(loop ? ['-l', loop] : [])]);
  const data = new Uint8Array(await tessera.files.private.readBytes(out));
  if (!data.length) throw new Error(t('failed', { program: 'VGAudioCli', error: output.slice(0, 200) }));
  return data;
}

async function audioFrom(source, format = 'lopus') {
  const name = typeof source === 'string' ? nameOf(source) : source.name;
  if (!SOURCE.test(name)) throw new Error('bad-source');
  const data = RAW.test(name)
    ? new Uint8Array(typeof source === 'string' ? await tessera.files.readBytes(source) : await source.arrayBuffer())
    : await encode(source, name, format);
  return { name: name.replace(/\.[^.]+$/, ''), data };
}

async function replaceWith(file, source) {
  if (playing?.file === file) stop();
  file.data = (await busy(t('importing', { name: file.name }), () => audioFrom(source, nus3Format(file.data) === 'idsp' ? 'idsp' : 'lopus'))).data;
  render();
  dirty(true);
}

async function addFrom(source) {
  if (!current) return;
  const { name, data } = await busy(t('importing', { name: typeof source === 'string' ? nameOf(source) : source.name }), () => audioFrom(source));
  const id = current.files.reduce((max, file) => Math.max(max, file.id + 1), 0);
  current.files.push({ id, name, data });
  render();
  dirty(true);
}

const chooser = document.createElement('input');
chooser.type = 'file';
chooser.accept = '.wav,.mp3,.ogg,.flac,.m4a,.lopus,.idsp';
chooser.hidden = true;
document.body.append(chooser);
let chosen = null;
chooser.addEventListener('change', () => {
  const file = chooser.files[0];
  chooser.value = '';
  if (file) chosen(file).catch(report);
});

function choose(handler) {
  chosen = handler;
  chooser.click();
}

function row(file) {
  const id = document.createElement('td');
  id.className = 'id';
  id.textContent = String(file.id);
  const input = document.createElement('input');
  input.className = 'atrium-input';
  input.value = file.name;
  input.setAttribute('aria-label', t('column.name'));
  input.addEventListener('change', () => {
    file.name = input.value.trim() || file.name;
    input.value = file.name;
    dirty(true);
  });
  const name = document.createElement('td');
  name.append(input);
  const info = document.createElement('td');
  info.className = 'info';
  info.textContent = `.${nus3Format(file.data)} · ${(file.data.length / 1024).toFixed(0)} KB`;
  const actions = document.createElement('td');
  actions.className = 'actions';
  if (file.data.length) {
    actions.append(listenButton(file), iconButton('file-earmark-music', t('wav'), () => toWav(file)), iconButton('box-arrow-up', t('extract'), () => extract(file)));
  }
  actions.append(
    iconButton('arrow-repeat', t('replace'), async () => choose((source) => replaceWith(file, source))),
    iconButton('trash', t('remove'), async () => {
      if (playing?.file === file) stop();
      current.files.splice(current.files.indexOf(file), 1);
      render();
      dirty(true);
    }),
  );
  const tr = document.createElement('tr');
  tr.append(id, name, info, actions);
  return tr;
}

function render() {
  list.replaceChildren(...(current?.files ?? []).map(row));
}

async function open(next) {
  if (changed && next !== path) {
    picker.value = path;
    return tessera.ui.toast('warning', t('saveFirst'));
  }
  stop();
  path = next;
  picker.value = path;
  current = null;
  dirty(false);
  render();
  if (!path) return;
  try {
    current = await busy(t('opening', { name: nameOf(path) }), async () => parseNus3audio(await tessera.files.readBytes(path)));
    dirty(false);
    render();
    await tessera.widget.setState({ path });
  } catch (error) {
    failed(error);
  }
}

async function refresh(wanted = path) {
  const paths = (await busy(t('scanning'), () => walk('', NUS3, []))).sort((a, b) => a.localeCompare(b));
  picker.replaceChildren(...paths.map((p) => new Option(p, p)));
  empty.hidden = paths.length > 0;
  picker.hidden = paths.length === 0;
  if (wanted !== path || !paths.includes(path)) await open(paths.includes(wanted) ? wanted : (paths[0] ?? ''));
  else picker.value = path;
}

save.addEventListener('click', async () => {
  if (!current || !changed) return;
  try {
    await tessera.files.writeBytes(path, writeNus3audio(current));
    dirty(false);
    tessera.ui.toast('success', t('saved', { name: nameOf(path) }));
  } catch (error) {
    failed(error);
  }
});

create.addEventListener('click', async () => {
  if (changed) return tessera.ui.toast('warning', t('saveFirst'));
  const values = await tessera.ui.form({
    title: t('create'),
    icon: 'file-earmark-music',
    confirmText: t('create'),
    fields: [{ type: 'text', id: 'path', label: t('create.path'), value: `${dirOf(selected ?? path)}new.nus3audio` }],
  });
  const target = values?.path.trim().replace(/^\/+/, '');
  if (!target) return;
  if (!NUS3.test(target)) return tessera.ui.toast('warning', t('notNus3audio', { name: target }));
  try {
    await tessera.files.writeBytes(target, writeNus3audio({ files: [] }));
    await refresh(target);
  } catch (error) {
    failed(error);
  }
});

add.addEventListener('click', () => choose(addFrom));
picker.addEventListener('change', () => open(picker.value));
tessera.on('files.selected', ({ path: next }) => {
  selected = next;
  if (next && NUS3.test(next) && next !== path) open(next);
});
tessera.on('files.dropped', ({ paths }) => {
  if (NUS3.test(paths[0])) open(paths[0]);
  else if (SOURCE.test(paths[0]) && current) addFrom(paths[0]).catch(report);
  else tessera.ui.toast('warning', t('notNus3audio', { name: paths[0] }));
});

document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', async (event) => {
  event.preventDefault();
  if (!current) return;
  for (const file of event.dataTransfer.files) await addFrom(file).catch(report);
});

let pending;
tessera.files.watch(() => {
  clearTimeout(pending);
  pending = setTimeout(() => refresh().catch(() => {}), 300);
});
tessera.ready
  .then(async () => refresh((await tessera.widget.getState())?.path))
  .catch(failed);
