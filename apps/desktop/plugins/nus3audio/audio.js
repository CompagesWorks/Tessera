const t = (key, params) => tessera.i18n.t(key, params);
const PRIVATE = '.tessera/plugins/compagesworks.nus3audio/';
const TEN_MINUTES = 10 * 60 * 1000;

function failed(error) {
  const key = `error.${error.message}`;
  tessera.ui.toast('error', t(key) === key ? String(error.message ?? error) : t(key));
}

const report = (error) => error.message !== 'cancelled' && failed(error);

async function run(program, args) {
  if (!(await tessera.exec.systemInfo())[program]) {
    const progress = await tessera.ui.progress(t('installing', { program }));
    const onProgress = (done, total) => {
      const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
      progress.update(total ? `${mb(done)} / ${mb(total)} MB` : `${mb(done)} MB`, total ? (done / total) * 100 : undefined).catch(() => {});
    };
    const installed = await tessera.exec
      .installSystem(program, { onProgress })
      .catch((error) => {
        if (error.message === 'refused by user') throw new Error('cancelled');
        if (error.message !== 'no download for this system') failed(error);
        return false;
      })
      .finally(() => progress.close());
    if (!installed) {
      tessera.ui.toast('info', t(`pick.${program}`));
      if (!(await tessera.exec.pickSystem(program))) throw new Error('cancelled');
    }
  }
  const result = await tessera.exec.runSystem(program, args, { timeout: TEN_MINUTES });
  if (!result) throw new Error('cancelled');
  const first = `${result.stderr}\n${result.stdout}`.trim().split('\n')[0];
  if (result.code !== 0) throw new Error(t('failed', { program, error: first.slice(0, 200) }));
  return first;
}

const decoded = new WeakMap();
let playing = null;
let onPlayingChange = () => {};

function stop() {
  if (!playing) return;
  playing.context.close().catch(() => {});
  playing = null;
  onPlayingChange();
}

async function play(file) {
  if (playing?.file === file) return stop();
  stop();
  const context = new AudioContext();
  playing = { file, context, loading: true };
  onPlayingChange();
  try {
    let buffer = decoded.get(file.data);
    if (!buffer) {
      const raw = `play.${nus3Format(file.data)}`;
      await tessera.files.private.writeBytes(raw, file.data);
      await tessera.files.private.writeBytes('play.wav', new Uint8Array(0));
      const output = await run('vgmstream', ['-o', `${PRIVATE}play.wav`, PRIVATE + raw]);
      const wav = new Uint8Array(await tessera.files.private.readBytes('play.wav'));
      if (!wav.length) throw new Error(t('failed', { program: 'vgmstream', error: output.slice(0, 200) }));
      buffer = await context.decodeAudioData(wav.buffer);
      decoded.set(file.data, buffer);
    }
    if (playing?.context !== context) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.addEventListener('ended', () => playing?.context === context && stop());
    await context.resume();
    source.start();
    if (playing?.context === context) {
      playing.loading = false;
      onPlayingChange();
    }
  } catch (error) {
    if (playing?.context === context) stop();
    throw error;
  }
}

function iconButton(icon, label, action) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'atrium-icon-btn-sm';
  node.title = label;
  node.setAttribute('aria-label', label);
  const glyph = document.createElement('i');
  glyph.className = `bi bi-${icon}`;
  node.append(glyph);
  node.addEventListener('click', () => action().catch(report));
  return node;
}

function listenButton(file) {
  const active = playing?.file === file;
  const loading = active && playing.loading;
  const icon = loading ? 'hourglass-split' : active ? 'stop-fill' : 'play-fill';
  const node = iconButton(icon, loading ? t('decoding') : active ? t('stop') : t('play'), () => play(file));
  node.setAttribute('aria-busy', String(loading));
  node.classList.toggle('is-playing', active);
  node.setAttribute('aria-pressed', String(active));
  return node;
}

async function busy(text, work) {
  const status = document.getElementById('status');
  status.textContent = text;
  status.hidden = false;
  try {
    return await work();
  } finally {
    status.hidden = true;
  }
}
