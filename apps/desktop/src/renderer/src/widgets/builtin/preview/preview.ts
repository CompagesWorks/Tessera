import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import type { WidgetDefinition } from '../../types';
import './preview.css';
import { previewKind, renderPreview } from './renderers';

const selection = new Map<string, string | null>();
const mounted = new Map<string, number>();
const listeners = new Set<(projectId: string) => void>();

export const canPreview = (path: string) => previewKind(path) !== null;

export const hasPreviewWidget = (projectId: string) => (mounted.get(projectId) ?? 0) > 0;

export function selectFile(projectId: string, path: string | null) {
  selection.set(projectId, path);
  listeners.forEach((listener) => listener(projectId));
}

export function onSelection(listener: (projectId: string) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createPreview(projectId: string, onClose?: () => void) {
  const element = document.createElement('div');
  element.className = 'tessera-preview';
  element.hidden = true;
  const head = document.createElement('div');
  head.className = 'tessera-preview-head';
  const name = document.createElement('span');
  head.append(name);
  if (onClose) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'atrium-icon-btn-sm';
    close.setAttribute('aria-label', t('widget.explorer.closePreview'));
    close.innerHTML = '<i class="bi bi-x-lg"></i>';
    close.addEventListener('click', onClose);
    head.append(close);
  }
  const content = document.createElement('div');
  content.className = 'tessera-preview-content';
  const info = document.createElement('div');
  info.className = 'tessera-preview-info';
  element.append(head, content, info);
  let ticket = 0;
  let shown: string | null = null;

  async function show(path: string | null) {
    const kind = path === null ? null : previewKind(path);
    element.hidden = kind === null;
    if (path === null || kind === null) {
      shown = null;
      content.replaceChildren();
      return;
    }
    if (path === shown && (kind === 'video' || kind === 'h264' || kind === 'audio')) return;
    const mine = ++ticket;
    shown = path;
    name.textContent = path.slice(path.lastIndexOf('/') + 1);
    info.textContent = t('widget.explorer.loading');
    element.dataset['kind'] = kind;
    element.classList.add('is-loading');
    const rendered = renderPreview(kind, projectId, path, name.textContent);
    content.replaceChildren(rendered.node);
    try {
      const text = await rendered.info;
      if (mine === ticket) info.textContent = text;
    } catch (error) {
      if (mine === ticket) info.textContent = errorMessage(error);
    } finally {
      if (mine === ticket) element.classList.remove('is-loading');
    }
  }

  return { element, show };
}

export const previewWidget: WidgetDefinition = {
  type: 'core/preview',
  title: () => t('widget.preview.title'),
  description: () => t('widget.preview.description'),
  icon: 'image',
  category: 'media',
  source: 'Tessera',
  trust: 'builtin',
  create({ project }) {
    const element = document.createElement('div');
    element.style.height = '100%';
    const pane = createPreview(project.id);
    pane.element.classList.add('is-widget');
    const empty = document.createElement('div');
    empty.className = 'tessera-preview-empty';
    empty.textContent = t('widget.preview.empty');
    element.append(pane.element, empty);
    const update = (projectId: string) => {
      if (projectId !== project.id) return;
      const path = selection.get(project.id) ?? null;
      empty.hidden = path !== null && canPreview(path);
      void pane.show(path);
    };
    const refresh = (payload: unknown) => update((payload as { projectId: string }).projectId);
    const offSelection = onSelection(update);
    const offHistory = window.tessera.on('history:changed', refresh);
    mounted.set(project.id, (mounted.get(project.id) ?? 0) + 1);
    listeners.forEach((listener) => listener(project.id));
    return {
      element,
      dispose: () => {
        offSelection();
        offHistory();
        mounted.set(project.id, (mounted.get(project.id) ?? 1) - 1);
        listeners.forEach((listener) => listener(project.id));
      },
    };
  },
};
