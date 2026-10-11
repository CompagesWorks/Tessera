import { join } from 'node:path';
import { BrowserWindow } from 'electron';

const preload = join(import.meta.dirname, '../preload/index.cjs');

export function createMainWindow(rendererUrl: string | undefined): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#1a1a1a',
    title: 'Tessera',
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));

  return win;
}
