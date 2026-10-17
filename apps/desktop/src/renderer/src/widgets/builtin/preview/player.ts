import { t } from '../../../i18n';

export interface Engine {
  readonly duration: number;
  readonly time: number;
  readonly paused: boolean;
  loop: boolean;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  volume?: { level: number; muted: boolean };
  dispose(): void;
}

const SKIP_SECONDS = 5;

const clock = (seconds: number) =>
  Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '–:––';

function iconButton(icon: string, label: string, onClick: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tessera-player-btn';
  button.addEventListener('click', onClick);
  const set = (nextIcon: string, nextLabel: string) => {
    button.innerHTML = `<i class="bi bi-${nextIcon}" aria-hidden="true"></i>`;
    button.setAttribute('aria-label', nextLabel);
    button.title = nextLabel;
  };
  set(icon, label);
  return { button, set };
}

export function createPlayer(surface: HTMLElement | null, engine: Engine): HTMLElement {
  const root = document.createElement('div');
  root.className = `tessera-player${surface ? '' : ' is-audio'}`;
  root.tabIndex = 0;
  const stage = document.createElement('div');
  stage.className = 'tessera-player-stage';
  if (surface) stage.append(surface);
  else stage.innerHTML = '<i class="bi bi-music-note-beamed" aria-hidden="true"></i>';
  const bar = document.createElement('div');
  bar.className = 'tessera-player-bar';

  const toggle = () => (engine.paused ? engine.play() : engine.pause());
  const play = iconButton('play-fill', t('widget.preview.play'), () => {
    toggle();
    sync();
  });
  const seek = document.createElement('input');
  seek.type = 'range';
  seek.className = 'tessera-player-seek';
  seek.min = '0';
  seek.step = 'any';
  seek.setAttribute('aria-label', t('widget.preview.seek'));
  let dragging = false;
  seek.addEventListener('input', () => {
    dragging = true;
    time.textContent = `${clock(Number(seek.value))} / ${clock(engine.duration)}`;
  });
  seek.addEventListener('change', () => {
    dragging = false;
    engine.seek(Number(seek.value));
    sync();
  });
  const time = document.createElement('span');
  time.className = 'tessera-player-time';
  const loop = iconButton('repeat', t('widget.preview.loop'), () => {
    engine.loop = !engine.loop;
    sync();
  });
  const controls: HTMLElement[] = [play.button, seek, time, loop.button];

  let mute: ReturnType<typeof iconButton> | null = null;
  let volume: HTMLInputElement | null = null;
  if (engine.volume) {
    const state = engine.volume;
    mute = iconButton('volume-up-fill', t('widget.preview.mute'), () => {
      state.muted = !state.muted;
      sync();
    });
    volume = document.createElement('input');
    volume.type = 'range';
    volume.className = 'tessera-player-volume';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.05';
    volume.setAttribute('aria-label', t('widget.preview.volume'));
    volume.addEventListener('input', () => {
      state.level = Number(volume!.value);
      state.muted = state.level === 0;
      sync();
    });
    controls.push(mute.button, volume);
  }
  if (surface) {
    const full = iconButton('fullscreen', t('widget.preview.fullscreen'), () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void root.requestFullscreen().catch(() => {});
    });
    controls.push(full.button);
  }
  bar.append(...controls);
  root.append(stage, bar);

  function sync() {
    const playing = !engine.paused;
    play.set(playing ? 'pause-fill' : 'play-fill', t(playing ? 'widget.preview.pause' : 'widget.preview.play'));
    root.classList.toggle('is-playing', playing);
    loop.button.classList.toggle('is-on', engine.loop);
    loop.button.setAttribute('aria-pressed', String(engine.loop));
    if (Number.isFinite(engine.duration)) seek.max = String(engine.duration);
    if (!dragging) {
      seek.value = String(engine.time);
      time.textContent = `${clock(engine.time)} / ${clock(engine.duration)}`;
    }
    seek.style.setProperty('--_progress', `${engine.duration ? (Number(seek.value) / engine.duration) * 100 : 0}%`);
    if (engine.volume && mute && volume) {
      const silent = engine.volume.muted || engine.volume.level === 0;
      mute.set(silent ? 'volume-mute-fill' : 'volume-up-fill', t(silent ? 'widget.preview.unmute' : 'widget.preview.mute'));
      if (document.activeElement !== volume) volume.value = String(engine.volume.muted ? 0 : engine.volume.level);
    }
  }

  stage.addEventListener('click', () => {
    toggle();
    sync();
  });
  root.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === ' ' || event.key === 'k') toggle();
    else if (event.key === 'ArrowRight') engine.seek(Math.min(engine.time + SKIP_SECONDS, engine.duration || 0));
    else if (event.key === 'ArrowLeft') engine.seek(Math.max(engine.time - SKIP_SECONDS, 0));
    else if (event.key === 'l') engine.loop = !engine.loop;
    else return;
    event.preventDefault();
    event.stopPropagation();
    sync();
  });

  const timer = window.setInterval(() => {
    if (!root.isConnected) {
      clearInterval(timer);
      engine.dispose();
      return;
    }
    sync();
  }, 200);
  sync();
  return root;
}

export function mediaEngine(element: HTMLMediaElement): Engine {
  element.controls = false;
  return {
    get duration() {
      return element.duration;
    },
    get time() {
      return element.currentTime;
    },
    get paused() {
      return element.paused;
    },
    get loop() {
      return element.loop;
    },
    set loop(value) {
      element.loop = value;
    },
    play: () => void element.play().catch(() => {}),
    pause: () => element.pause(),
    seek: (seconds) => {
      element.currentTime = seconds;
    },
    volume: {
      get level() {
        return element.volume;
      },
      set level(value) {
        element.volume = value;
      },
      get muted() {
        return element.muted;
      },
      set muted(value) {
        element.muted = value;
      },
    },
    dispose: () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
    },
  };
}
