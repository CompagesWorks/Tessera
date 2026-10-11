import { BrowserWindow, dialog, shell, type IpcMainInvokeEvent } from 'electron';
import { handle } from '../ipc';
import { COVER_EXTENSIONS } from './files';
import { listDir, readText } from './files-list';
import { readLayout, writeLayout } from './layout';
import { createNote, deleteNote, listNotes, readNote, writeNote } from './notes';
import { ProjectError, type ProjectService } from './service';

function windowOf(event: IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

async function pickFolder(event: IpcMainInvokeEvent, defaultPath: string): Promise<string | null> {
  const win = windowOf(event);
  const options = { defaultPath, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ProjectError) throw new Error(`project:${error.code}`);
    throw error;
  }
}

export function registerProjectHandlers(projects: ProjectService, isTrusted: (url: string) => boolean) {
  handle('projects:home', () => projects.home(), isTrusted);
  handle('projects:create', (request) => guard(() => projects.create(request)), isTrusted);
  handle('projects:pick-location', (_request, event) => pickFolder(event, projects.defaultLocation), isTrusted);
  handle(
    'projects:import',
    async (_request, event) => {
      const folder = await pickFolder(event, projects.defaultLocation);
      return folder ? guard(() => projects.importFolder(folder)) : null;
    },
    isTrusted,
  );
  handle('projects:open', ({ id }) => guard(() => projects.open(id)), isTrusted);
  handle('projects:update', ({ id, patch }) => guard(() => projects.update(id, patch)), isTrusted);
  handle(
    'projects:set-cover',
    async ({ id }, event) => {
      const win = windowOf(event);
      const options = {
        properties: ['openFile'] as Array<'openFile'>,
        filters: [{ name: 'Images', extensions: [...COVER_EXTENSIONS] }],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      const file = result.canceled ? null : result.filePaths[0];
      return file ? guard(() => projects.setCover(id, file)) : null;
    },
    isTrusted,
  );
  handle('projects:remove-cover', ({ id }) => guard(() => projects.removeCover(id)), isTrusted);
  handle('projects:forget', ({ id }) => guard(() => projects.forget(id)), isTrusted);
  handle('projects:reveal', ({ id }) => guard(async () => void (await shell.openPath(projects.pathOf(id)))), isTrusted);
  handle('tags:upsert', (tag) => projects.upsertTag(tag), isTrusted);
  handle('tags:delete', ({ id }) => projects.deleteTag(id), isTrusted);
  handle('collections:upsert', (collection) => projects.upsertCollection(collection), isTrusted);
  handle('collections:delete', ({ id }) => projects.deleteCollection(id), isTrusted);
  handle('layout:get', ({ id }) => guard(async () => readLayout(await projects.rootOf(id))), isTrusted);
  handle('layout:save', ({ id, layout }) => guard(async () => writeLayout(await projects.rootOf(id), layout)), isTrusted);
  handle('files:list', ({ id, path }) => guard(async () => listDir(await projects.rootOf(id), path)), isTrusted);
  handle('files:read-text', ({ id, path }) => guard(async () => readText(await projects.rootOf(id), path)), isTrusted);
  handle('notes:list', ({ id }) => guard(async () => listNotes(await projects.rootOf(id))), isTrusted);
  handle('notes:read', ({ id, name }) => guard(async () => readNote(await projects.rootOf(id), name)), isTrusted);
  handle('notes:write', ({ id, name, content }) => guard(async () => writeNote(await projects.rootOf(id), name, content)), isTrusted);
  handle('notes:create', ({ id, name, content }) => guard(async () => createNote(await projects.rootOf(id), name, content)), isTrusted);
  handle('notes:delete', ({ id, name }) => guard(async () => deleteNote(await projects.rootOf(id), name)), isTrusted);
}
