import { t } from '../../../i18n';
import { parseH264 } from './h264-stream';
import { createPlayer, type Engine } from './player';

const FRAME_SECONDS = 1001 / 30000;
const AHEAD = 6;

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export function h264Player(url: string): { node: HTMLElement; info: Promise<string> } {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const holder = document.createElement('div');
  holder.className = 'tessera-player-loading';

  const info = (async () => {
    if (!('VideoDecoder' in window)) throw new Error(t('widget.preview.unsupported'));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}`);
    const { codec, units } = parseH264(new Uint8Array(await response.arrayBuffer()));
    if (!codec || units.length === 0 || !(await VideoDecoder.isConfigSupported({ codec })).supported) throw new Error(t('widget.preview.unsupported'));

    const frames: VideoFrame[] = [];
    let next = 0;
    let drop = 0;
    let shown = 0;
    let flushed = false;
    let paused = false;
    let loop = true;
    let redraw = true;
    let timer = 0;
    let sized: (size: string) => void = () => {};
    const size = new Promise<string>((resolve) => (sized = resolve));
    const decoder = new VideoDecoder({
      output: (frame) => {
        sized(`${frame.displayWidth} × ${frame.displayHeight}`);
        if (drop > 0) {
          drop -= 1;
          frame.close();
        } else frames.push(frame);
      },
      error: () => engine.dispose(),
    });

    const restartAt = (target: number) => {
      let key = target;
      while (key > 0 && !units[key]!.key) key -= 1;
      frames.splice(0).forEach((frame) => frame.close());
      decoder.reset();
      decoder.configure({ codec, optimizeForLatency: true });
      next = key;
      drop = target - key;
      shown = target;
      flushed = false;
      redraw = true;
    };
    const feed = () => {
      while (next < units.length && frames.length + decoder.decodeQueueSize < AHEAD) {
        const unit = units[next]!;
        decoder.decode(new EncodedVideoChunk({ type: unit.key ? 'key' : 'delta', timestamp: Math.round(next * FRAME_SECONDS * 1e6), data: unit.data }));
        next += 1;
      }
      if (next >= units.length && !flushed) {
        flushed = true;
        void decoder.flush().catch(() => {});
      }
    };
    const draw = (frame: VideoFrame) => {
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
      context.drawImage(frame, 0, 0);
      frame.close();
    };
    const tick = () => {
      if (decoder.state === 'closed') return;
      feed();
      if (paused && !redraw) return;
      const frame = frames.shift();
      if (frame) {
        draw(frame);
        if (!redraw) shown = Math.min(shown + 1, units.length - 1);
        redraw = false;
      } else if (flushed && decoder.decodeQueueSize === 0 && drop === 0) {
        if (loop) restartAt(0);
        else paused = true;
      }
    };

    const engine: Engine = {
      get duration() {
        return units.length * FRAME_SECONDS;
      },
      get time() {
        return shown * FRAME_SECONDS;
      },
      get paused() {
        return paused;
      },
      get loop() {
        return loop;
      },
      set loop(value) {
        loop = value;
      },
      play: () => {
        if (shown >= units.length - 1) restartAt(0);
        paused = false;
      },
      pause: () => {
        paused = true;
      },
      seek: (seconds) => restartAt(Math.max(0, Math.min(units.length - 1, Math.round(seconds / FRAME_SECONDS)))),
      dispose: () => {
        clearInterval(timer);
        frames.splice(0).forEach((frame) => frame.close());
        if (decoder.state !== 'closed') decoder.close();
      },
    };

    restartAt(0);
    timer = window.setInterval(tick, FRAME_SECONDS * 1000);
    holder.replaceWith(createPlayer(canvas, engine));
    return [await size, t('widget.preview.frames', { count: units.length }), clock(units.length * FRAME_SECONDS), '29.97 fps'].join(' · ');
  })();
  return { node: holder, info };
}
