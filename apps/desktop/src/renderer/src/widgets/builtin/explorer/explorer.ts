import type { DirEntry } from '@tessera/protocol';
import { t } from '../../../i18n';
import type { WidgetDefinition } from '../../types';
import { broadcastDrag } from '../../../plugins/bridge';
import { fileActions, parentOf, PATH_TYPE } from './actions';
import { canPreview, createPreview, hasPreviewWidget, onSelection, selectFile } from '../preview/preview';
import './explorer.css';

const FILE_ICONS: Record<string, string> = {
  png: 'file-image',
  jpg: 'file-image',
  jpeg: 'file-image',
  webp: 'file-image',
  gif: 'file-image',
  bmp: 'file-image',
  tga: 'file-image',
  tif: 'file-image',
  tiff: 'file-image',
  ico: 'file-image',
  dds: 'file-image',
  nutexb: 'file-image',
  wav: 'file-music',
  mp3: 'file-music',
  ogg: 'file-music',
  nus3audio: 'file-music',
  json: 'filetype-json',
  toml: 'file-code',
  txt: 'file-text',
  md: 'file-text',
  zip: 'file-zip',
  blend: 'box',
};

function fileIcon(name: string) {
  return FILE_ICONS[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'file-earmark';
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export const explorerWidget: WidgetDefinition = {
  type: 'core/explorer',
  title: () => t('widget.explorer.title'),
  description: () => t('widget.explorer.description'),
  icon: 'folder2-open',
  category: 'files',
  source: 'Tessera',
  trust: 'builtin',
  create({ project, ui, state, setState }) {
    const element = document.createElement('div');
    element.className = 'tessera-explorer';
    const bar = document.createElement('div');
    bar.className = 'tessera-explorer-bar';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'atrium-icon-btn-sm';
    refresh.dataset['atriumTooltip'] = t('widget.explorer.refresh');
    refresh.innerHTML = '<i class="bi bi-arrow-clockwise"></i>';
    bar.append(refresh);
    const tree = document.createElement('div');
    tree.className = 'tessera-explorer-tree';
    let selected: string | null = null;
    const preview = createPreview(project.id, () => select(null));
    element.append(bar, tree, preview.element);

    const showInline = () => void preview.show(hasPreviewWidget(project.id) ? null : selected);

    function select(path: string | null) {
      selected = path;
      for (const row of tree.querySelectorAll<HTMLElement>('.tessera-explorer-row')) row.classList.toggle('is-selected', row.dataset['path'] === path);
      selectFile(project.id, path);
      showInline();
    }

    const expanded = new Set(Array.isArray(state['expanded']) ? (state['expanded'] as string[]) : ['sources']);
    let disposed = false;

    const list = (path: string) => window.tessera.invoke('files:list', { id: project.id, path });
    const rerender = () => {
      void renderLevel(tree, '', 0);
      if (selected) showInline();
    };
    const actions = fileActions(project.id, ui, rerender);

    function dropTarget(target: HTMLElement, dir: string) {
      target.addEventListener('dragover', (event) => {
        const types = event.dataTransfer?.types ?? [];
        if (!types.includes(PATH_TYPE) && !types.includes('Files')) return;
        event.preventDefault();
        event.stopPropagation();
        target.classList.add('is-drop');
      });
      target.addEventListener('dragleave', () => target.classList.remove('is-drop'));
      target.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        target.classList.remove('is-drop');
        void actions.drop(event, dir);
      });
    }

    function interactive(row: HTMLElement, entry: DirEntry) {
      row.tabIndex = 0;
      row.draggable = true;
      row.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData(PATH_TYPE, entry.path);
        event.dataTransfer?.setData('text/plain', entry.path);
        broadcastDrag(project.id, [entry.path]);
      });
      row.addEventListener('dragend', () => broadcastDrag(project.id, null));
      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.menu(event, entry);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'F2') void actions.rename(entry.path);
        else if (event.key === 'Delete') void actions.remove(entry.path);
        else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (entry.kind === 'dir' || event.key === ' ') row.click();
          else void actions.open(entry.path);
        } else return;
        event.stopPropagation();
      });
      dropTarget(row, entry.kind === 'dir' ? entry.path : parentOf(entry.path));
    }

    async function renderLevel(container: HTMLElement, path: string, depth: number) {
      let entries: DirEntry[];
      try {
        entries = await list(path);
      } catch {
        entries = [];
      }
      if (disposed) return;
      container.replaceChildren();
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tessera-explorer-empty';
        empty.style.setProperty('--_depth', String(depth));
        empty.textContent = t('widget.explorer.empty');
        container.append(empty);
        return;
      }
      for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'tessera-explorer-row';
        row.style.setProperty('--_depth', String(depth));
        row.title = entry.path;
        row.dataset['path'] = entry.path;
        row.classList.toggle('is-selected', entry.path === selected);
        if (entry.kind === 'dir') {
          const open = expanded.has(entry.path);
          row.classList.add('is-dir');
          row.classList.toggle('is-open', open);
          row.innerHTML = `<i class="bi bi-chevron-right"></i><i class="bi bi-${open ? 'folder2-open' : 'folder2'}"></i>`;
          row.append(entry.name);
          interactive(row, entry);
          const children = document.createElement('div');
          container.append(row, children);
          if (open) void renderLevel(children, entry.path, depth + 1);
          row.addEventListener('click', () => {
            if (expanded.has(entry.path)) expanded.delete(entry.path);
            else expanded.add(entry.path);
            setState({ expanded: [...expanded] });
            const nowOpen = expanded.has(entry.path);
            row.classList.toggle('is-open', nowOpen);
            row.querySelector('.bi-folder2, .bi-folder2-open')!.className = `bi bi-${nowOpen ? 'folder2-open' : 'folder2'}`;
            if (nowOpen) void renderLevel(children, entry.path, depth + 1);
            else children.replaceChildren();
          });
        } else {
          row.innerHTML = `<span class="tessera-explorer-spacer"></span><i class="bi bi-${fileIcon(entry.name)}"></i>`;
          row.append(entry.name);
          const size = document.createElement('span');
          size.className = 'tessera-explorer-size';
          size.textContent = formatSize(entry.size);
          row.append(size);
          interactive(row, entry);
          row.addEventListener('click', () => select(canPreview(entry.path) ? entry.path : null));
          row.addEventListener('dblclick', () => void actions.open(entry.path));
          container.append(row);
        }
      }
    }

    refresh.addEventListener('click', rerender);
    tree.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      actions.menu(event, null);
    });
    dropTarget(tree, '');
    let timer = 0;
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(rerender, 200);
    };
    const offHistory = window.tessera.on('history:changed', (payload) => {
      if ((payload as { projectId: string }).projectId === project.id) schedule();
    });
    const offPlugins = window.tessera.on('plugin:files-changed', schedule);
    const offSelection = onSelection((projectId) => {
      if (projectId === project.id) showInline();
    });
    window.addEventListener('focus', schedule);
    rerender();

    return {
      element,
      dispose: () => {
        disposed = true;
        clearTimeout(timer);
        offHistory();
        offPlugins();
        offSelection();
        window.removeEventListener('focus', schedule);
      },
    };
  },
};
