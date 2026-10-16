import { fromTemplate, required } from '../components/dom';
import { t } from '../i18n';
import { logoImage } from '../shell/shell';
import './splash.css';
import template from './splash.html?raw';

const FADE = 450;
const MIN_VISIBLE = 1500;
const SHIFT_EVENTS = ['keydown', 'keyup', 'pointermove', 'pointerdown'] as const;

export interface Splash {
  readonly visible: boolean;
  step(text: string, percent: number): void;
  replace(content: HTMLElement): void;
  onShift(listener: () => void): void;
  close(): Promise<void>;
}

export function createSplash(version: string, visible: boolean): Splash {
  const root = fromTemplate(template);
  const card = required<HTMLElement>(root, '[data-card]');
  const bar = required<HTMLElement>(root, '[data-bar]');
  const stepText = required<HTMLElement>(root, '[data-step]');
  required(root, '[data-logo]').replaceWith(logoImage('tessera-splash-logo'));
  required(root, '[data-version]').textContent = t('splash.version', { version });
  required(root, '[data-loading]').textContent = t('splash.loading');
  required(root, '[data-hint]').innerHTML = t('splash.hint', { key: '<kbd class="atrium-kbd">Shift</kbd>' });
  root.hidden = !visible;
  if (!visible) document.documentElement.classList.remove('is-booting');
  const shownAt = performance.now();
  document.body.append(root);

  let shiftListener: (() => void) | null = null;
  let restarting = false;
  const onInput = (event: Event) => {
    const shift = event instanceof KeyboardEvent ? event.key === 'Shift' || event.shiftKey : event instanceof MouseEvent && event.shiftKey;
    if (!shift || restarting || !shiftListener) return;
    restarting = true;
    stop();
    root.hidden = false;
    stepText.textContent = t('splash.restartingSafe');
    bar.style.width = '100%';
    shiftListener();
  };
  const stop = () => SHIFT_EVENTS.forEach((name) => window.removeEventListener(name, onInput, true));
  SHIFT_EVENTS.forEach((name) => window.addEventListener(name, onInput, true));

  return {
    get visible() {
      return !root.hidden;
    },
    step(text, percent) {
      if (restarting) return;
      stepText.textContent = text;
      bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    },
    replace(content) {
      stop();
      root.hidden = false;
      card.classList.add('is-wide');
      card.replaceChildren(content);
    },
    onShift(listener) {
      shiftListener = listener;
    },
    async close() {
      if (!root.hidden) {
        const wait = MIN_VISIBLE - (performance.now() - shownAt);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (restarting) return new Promise<void>(() => {});
      stop();
      document.documentElement.classList.remove('is-booting');
      if (root.hidden) {
        root.remove();
        return;
      }
      root.classList.add('is-leaving');
      await new Promise((resolve) => setTimeout(resolve, FADE));
      root.remove();
    },
  };
}
