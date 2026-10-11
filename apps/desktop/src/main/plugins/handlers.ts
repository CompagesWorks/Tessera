import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import { handle } from '../ipc';
import { PluginError, readManifest, type PluginService } from './service';

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PluginError) throw new Error(`plugin:${error.code}: ${error.message}`);
    throw error;
  }
}

async function pickFolder(event: IpcMainInvokeEvent): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = { properties: ['openDirectory'] as Array<'openDirectory'> };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

export function registerPluginHandlers(plugins: PluginService, isTrusted: (url: string) => boolean) {
  handle('plugins:list', () => plugins.list(), isTrusted);
  handle(
    'plugins:inspect-local',
    async (_request, event) => {
      const path = await pickFolder(event);
      if (!path) return null;
      try {
        return { path, manifest: await readManifest(path) };
      } catch (error) {
        return { path, error: (error as Error).message };
      }
    },
    isTrusted,
  );
  handle('plugins:install-local', ({ path, granted }) => guard(() => plugins.installLocal(path, granted)), isTrusted);
  handle('plugins:set-enabled', ({ id, enabled }) => guard(() => plugins.setEnabled(id, enabled)), isTrusted);
  handle('plugins:set-grants', ({ id, granted }) => guard(() => plugins.setGrants(id, granted)), isTrusted);
  handle('plugins:remove', ({ id }) => guard(() => plugins.remove(id)), isTrusted);
}
