import { getCurrentWindow } from '@tauri-apps/api/window';

const INTERACTIVE = 'button, input, select, textarea, a[href], [contenteditable=""], [contenteditable="true"], [data-atrium-window]';

export interface AtriumWindowApi {
  minimize(): void;
  maximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizedChange(listener: (maximized: boolean) => void): () => void;
}

export function createWindowControls(): AtriumWindowApi {
  const win = getCurrentWindow();
  return {
    minimize: () => void win.minimize(),
    maximize: () => void win.toggleMaximize(),
    close: () => void win.close(),
    isMaximized: () => win.isMaximized(),
    onMaximizedChange(listener) {
      let stopped = false;
      let last: boolean | null = null;
      let stop: (() => void) | null = null;
      void win
        .onResized(async () => {
          const maximized = await win.isMaximized();
          if (maximized === last) return;
          last = maximized;
          listener(maximized);
        })
        .then((unlisten) => {
          if (stopped) unlisten();
          else stop = unlisten;
        });
      return () => {
        stopped = true;
        stop?.();
      };
    },
  };
}

function regionOf(element: Element): string {
  const style = getComputedStyle(element) as CSSStyleDeclaration & { webkitAppRegion?: string; appRegion?: string };
  return style.webkitAppRegion || style.appRegion || style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region') || '';
}

function isDragRegion(target: EventTarget | null): boolean {
  for (let element = target instanceof Element ? target : null; element; element = element.parentElement) {
    if (element.matches(INTERACTIVE)) return false;
    const region = regionOf(element);
    if (region === 'no-drag') return false;
    if (region === 'drag' || element.classList.contains('atrium-titlebar')) return true;
  }
  return false;
}

export function enableDragRegions() {
  const win = getCurrentWindow();
  document.addEventListener('mousedown', (event) => {
    if (event.button !== 0 || !isDragRegion(event.target)) return;
    event.preventDefault();
    if (event.detail === 2) void win.toggleMaximize();
    else void win.startDragging();
  });
}
