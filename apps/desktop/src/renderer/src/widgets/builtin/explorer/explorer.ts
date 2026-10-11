import type { DirEntry } from '@tessera/protocol';
import { t } from '../../../i18n';
import type { WidgetDefinition } from '../../types';
import './explorer.css';

const FILE_ICONS: Record<string, string> = {
  png: 'file-image',
  jpg: 'file-image',
  jpeg: 'file-image',
  webp: 'file-image',
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
  create({ project, state, setState }) {
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
    element.append(bar, tree);

    const expanded = new Set(Array.isArray(state['expanded']) ? (state['expanded'] as string[]) : ['sources']);
    let disposed = false;

    const list = (path: string) => window.tessera.invoke('files:list', { id: project.id, path });

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
        if (entry.kind === 'dir') {
          const open = expanded.has(entry.path);
          row.classList.add('is-dir');
          row.classList.toggle('is-open', open);
          row.innerHTML = `<i class="bi bi-chevron-right"></i><i class="bi bi-${open ? 'folder2-open' : 'folder2'}"></i>`;
          row.append(entry.name);
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
          container.append(row);
        }
      }
    }

    refresh.addEventListener('click', () => void renderLevel(tree, '', 0));
    void renderLevel(tree, '', 0);

    return {
      element,
      dispose: () => {
        disposed = true;
      },
    };
  },
};
