const t = (key, params) => tessera.i18n.t(key, params);
const TEN_MINUTES = 10 * 60 * 1000;
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function progressReader(progress, from, to) {
  let duration = 0;
  const report = {};
  return (line, kind) => {
    if (kind === 'stderr') {
      const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
      if (match && !duration) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      return;
    }
    const [key, value] = line.split('=');
    report[key] = value?.trim();
    if (key !== 'progress') return;
    const done = Number(report.out_time_us ?? report.out_time_ms ?? 0) / 1e6;
    const percent = duration ? Math.min(100, (done / duration) * 100) : undefined;
    const parts = [duration ? `${clock(done)} / ${clock(duration)}` : clock(done)];
    if (report.fps && report.fps !== '0.00') parts.push(`${report.fps} fps`);
    if (report.speed && report.speed !== 'N/A') parts.push(report.speed);
    progress.update(`${t('progress', { from: nameOf(from), to: nameOf(to) })}
${parts.join(' · ')}`, value === 'end' ? 100 : percent).catch(() => {});
  };
}

async function ffmpegReady() {
  const { ffmpeg } = await tessera.exec.systemInfo();
  if (ffmpeg) return true;
  tessera.ui.toast('info', t('pickFfmpeg'));
  return tessera.exec.pickSystem('ffmpeg');
}

function ffmpegArgs(from, to, { size, fps, bitrate }) {
  const args = ['-y', '-nostats', '-progress', 'pipe:1', '-i', from];
  if (fps) args.push('-r', fps);
  if (size) args.push('-vf', `scale=${size}:flags=bicubic`);
  args.push('-b:v', `${bitrate}k`, to);
  return args;
}

async function convert(path) {
  const values = await tessera.ui.form({
    title: t('form.title'),
    icon: 'film',
    message: path,
    confirmText: t('convert'),
    fields: [
      {
        type: 'select',
        id: 'size',
        label: t('size'),
        options: [
          { value: '1280x720', label: '1280 × 720' },
          { value: '1920x1080', label: '1920 × 1080' },
          { value: '', label: t('keep') },
        ],
        value: '1280x720',
      },
      {
        type: 'select',
        id: 'fps',
        label: t('fps'),
        options: [
          { value: '30000/1001', label: '29.97' },
          { value: '60000/1001', label: '59.94' },
          { value: '', label: t('keep') },
        ],
        value: '30000/1001',
      },
      { type: 'text', id: 'bitrate', label: t('bitrate'), value: '6000' },
    ],
  });
  if (!values) return;
  const bitrate = Number.parseInt(values.bitrate, 10);
  if (!(bitrate >= 100 && bitrate <= 100000)) return tessera.ui.toast('error', t('badBitrate'));
  if (!(await ffmpegReady())) return;
  const to = /\.h264$/i.test(path) ? path.replace(/\.h264$/i, '.converted.h264') : path.replace(/\.[^./]+$/, '.h264');
  const progress = await tessera.ui.progress(t('form.title'), t('progress', { from: nameOf(path), to: nameOf(to) }));
  const result = await tessera.exec
    .runSystem('ffmpeg', ffmpegArgs(path, to, { size: values.size, fps: values.fps, bitrate }), { timeout: TEN_MINUTES, onOutput: progressReader(progress, path, to) })
    .finally(() => progress.close());
  if (result.code !== 0) {
    const lines = result.stderr.trim().split('\n');
    return tessera.ui.toast('error', t('failed', { error: lines[lines.length - 1].slice(0, 200) }));
  }
  tessera.ui.toast('success', t('created', { name: nameOf(to) }));
}

tessera.on('fileAction', ({ id, paths }) => {
  if (id !== 'h264') return;
  convert(paths[0]).catch((error) => tessera.ui.toast('error', String(error.message ?? error)));
});
