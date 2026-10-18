import type { DirEntry } from '@tessera/protocol';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import { pluginFileActions } from '../../../plugins/hosts';
import type { UiProvider } from '../../../ui/provider';

export const PATH_TYPE = 'application/x-tessera-path';

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
export const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const validName = (value: string) => (value.trim() && !/[\\/:*?"<>|]/.test(value) && value.trim() !== '..' ? null : t('widget.explorer.badName'));

export function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error ?? new Error(file.name));
    reader.readAsDataURL(file);
  });
}

export function fileActions(projectId: string, ui: UiProvider, refresh: () => void) {
  const id = projectId;

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      ui.toast('error', errorMessage(error));
    }
    refresh();
  }

  async function ask(title: string, icon: string, value = '') {
    const name = await ui.atrium.modal.prompt({
      title,
      label: t('widget.explorer.name'),
      value,
      icon,
      confirmText: t('dialog.save'),
      cancelText: t('dialog.cancel'),
      validate: validName,
    });
    return name?.trim();
  }

  const actions = {
    open: (path: string) => run(() => window.tessera.invoke('files:open', { id, path })),
    reveal: (path: string) => run(() => window.tessera.invoke('files:reveal', { id, path })),
    copyPath: (path: string) => run(() => navigator.clipboard.writeText(path)),
    remove: (path: string) => run(() => window.tessera.invoke('files:remove', { id, path })),
    async rename(path: string) {
      const name = await ask(t('widget.explorer.rename'), 'pencil', nameOf(path));
      if (name && name !== nameOf(path)) await run(() => window.tessera.invoke('files:rename', { id, from: path, to: join(parentOf(path), name) }));
    },
    async newFolder(dir: string) {
      const name = await ask(t('widget.explorer.newFolder'), 'folder-plus');
      if (name) await run(() => window.tessera.invoke('files:mkdir', { id, path: join(dir, name) }));
    },
    async drop(event: DragEvent, dir: string) {
      const moved = event.dataTransfer?.getData(PATH_TYPE);
      if (moved) {
        if (parentOf(moved) !== dir && dir !== moved && !dir.startsWith(`${moved}/`)) {
          await run(() => window.tessera.invoke('files:rename', { id, from: moved, to: join(dir, nameOf(moved)) }));
        }
        return;
      }
      for (const file of event.dataTransfer?.files ?? []) {
        await run(async () => window.tessera.invoke('files:write-bytes', { id, path: join(dir, file.name), data: await toBase64(file) }));
      }
    },
    menu(event: MouseEvent, entry: DirEntry | null) {
      const dir = entry === null ? '' : entry.kind === 'dir' ? entry.path : parentOf(entry.path);
      const newFolder = { label: t('widget.explorer.newFolder'), icon: 'folder-plus', onClick: () => void actions.newFolder(dir) };
      if (entry === null) return ui.atrium.menu.open(event, [newFolder, { label: t('widget.explorer.refresh'), icon: 'arrow-clockwise', onClick: refresh }]);
      const plugins = entry.kind === 'file' ? pluginFileActions(entry.path) : [];
      ui.atrium.menu.open(event, [
        ...(entry.kind === 'file' ? [{ label: t('widget.explorer.open'), icon: 'box-arrow-up-right', onClick: () => void actions.open(entry.path) }] : []),
        ...plugins.map((action) => ({ label: action.title, icon: action.icon.includes('/') ? 'puzzle' : action.icon, hint: action.pluginName, onClick: action.run })),
        ...(plugins.length ? ['separator' as const] : []),
        { label: t('widget.explorer.reveal'), icon: 'folder2-open', onClick: () => void actions.reveal(entry.path) },
        { label: t('widget.explorer.copyPath'), icon: 'clipboard', onClick: () => void actions.copyPath(entry.path) },
        'separator',
        newFolder,
        { label: t('widget.explorer.rename'), icon: 'pencil', onClick: () => void actions.rename(entry.path) },
        'separator',
        { label: t('widget.explorer.delete'), icon: 'trash3', danger: true, onClick: () => void actions.remove(entry.path) },
      ]);
    },
  };
  return actions;
}
