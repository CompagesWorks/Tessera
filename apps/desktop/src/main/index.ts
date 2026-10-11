import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { registerWindowControls } from 'atrium-ui/electron';
import type { AppInfo } from '@tessera/protocol';
import { handle, send } from './ipc';
import { applySecurityPolicy } from './security';
import { SettingsStore } from './settings';
import { createMainWindow } from './window';

const rendererUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;
const rendererFile = pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href;
const safeMode = process.argv.includes('--safe-mode');

function isTrusted(url: string): boolean {
  if (rendererUrl) return new URL(url).origin === new URL(rendererUrl).origin;
  return url.split(/[?#]/)[0] === rendererFile;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function start() {
  app.setAppUserModelId('com.compagesworks.tessera');
  await app.whenReady();

  applySecurityPolicy(isTrusted);
  registerWindowControls({ ipcMain, BrowserWindow, session });

  const settings = new SettingsStore(app.getPath('userData'));
  await settings.load();

  handle(
    'app:info',
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      safeMode,
    }),
    isTrusted,
  );
  handle(
    'app:open-external',
    async ({ url }) => {
      await shell.openExternal(url);
      return true;
    },
    isTrusted,
  );
  handle('settings:get', () => settings.current, isTrusted);
  handle('settings:update', (patch) => settings.update(patch), isTrusted);

  let win = createMainWindow(rendererUrl);
  settings.on('changed', (value) => send(win.webContents, 'settings:changed', value));

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createMainWindow(rendererUrl);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
