import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import type { UiProvider } from '../../../ui/provider';
import type { WidgetDefinition } from '../../types';
import { toBase64 } from '../explorer/actions';
import { createCodeEditor, languageName, type CodeEditor } from './editor';
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

function headButton(icon: string, label: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'atrium-icon-btn-sm';
  button.dataset['atriumTooltip'] = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<i class="bi bi-${icon}"></i>`;
  return button;
}

export function createPreview(projectId: string, ui: UiProvider, onClose?: () => void) {
  const element = document.createElement('div');
  element.className = 'tessera-preview';
  element.hidden = true;
  const head = document.createElement('div');
  head.className = 'tessera-preview-head';
  const name = document.createElement('span');
  name.className = 'tessera-preview-name';
  const save = headButton('floppy', t('widget.preview.save'));
  save.hidden = true;
  const toggle = headButton('code-slash', t('widget.preview.edit'));
  toggle.hidden = true;
  head.append(name, save, toggle);
  if (onClose) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'atrium-icon-btn-sm';
    close.setAttribute('aria-label', t('widget.explorer.closePreview'));
    close.innerHTML = '<i class="bi bi-x-lg"></i>';
    close.addEventListener('click', onClose);
    head.append(close);
  }
  const contentBox = document.createElement('div');
  contentBox.className = 'tessera-preview-content';
  const info = document.createElement('div');
  info.className = 'tessera-preview-info';
  element.append(head, contentBox, info);
  let ticket = 0;
  let shown: string | null = null;
  let editor: CodeEditor | null = null;
  let dirty = false;
  let cursor = '';

  const status = () => {
    if (!editor || !shown) return;
    info.textContent = [cursor, languageName(shown), dirty ? t('widget.preview.unsaved') : null].filter(Boolean).join(' · ');
    save.disabled = !dirty;
    element.classList.toggle('is-dirty', dirty);
  };

  async function keep() {
    if (!editor || !dirty) return true;
    return ui.atrium.modal.confirm({
      title: t('widget.preview.discardTitle'),
      message: t('widget.preview.discardMessage', { name: name.textContent ?? '' }),
      confirmText: t('widget.preview.discard'),
      cancelText: t('dialog.cancel'),
      danger: true,
    });
  }

  function closeEditor() {
    editor?.destroy();
    editor = null;
    dirty = false;
    element.classList.remove('is-editing', 'is-dirty');
    save.hidden = true;
    toggle.innerHTML = '<i class="bi bi-code-slash"></i>';
    toggle.dataset['atriumTooltip'] = t('widget.preview.edit');
    toggle.setAttribute('aria-label', t('widget.preview.edit'));
  }

  async function writeFile() {
    if (!editor || !shown || !dirty) return;
    const path = shown;
    const text = editor.value();
    try {
      await window.tessera.invoke('files:write-bytes', { id: projectId, path, data: await toBase64(new File([text], name.textContent ?? 'file')) });
      if (editor && shown === path && editor.value() === text) dirty = false;
      status();
      ui.toast('success', t('widget.preview.saved', { name: name.textContent ?? '' }));
    } catch (error) {
      ui.toast('error', errorMessage(error));
    }
  }

  async function openEditor() {
    if (!shown) return;
    const path = shown;
    try {
      const content = await window.tessera.invoke('files:read-text', { id: projectId, path });
      if (shown !== path) return;
      if (content.includes('\uFFFD')) return ui.toast('warning', t('widget.preview.notText'));
      editor = createCodeEditor(path, content, {
        change: () => {
          dirty = true;
          status();
        },
        cursor: (line, col) => {
          cursor = t('widget.preview.cursor', { line, col });
          status();
        },
        save: () => void writeFile(),
      });
      dirty = false;
      cursor = t('widget.preview.cursor', { line: 1, col: 1 });
      element.classList.add('is-editing');
      contentBox.replaceChildren(editor.element);
      save.hidden = false;
      toggle.innerHTML = '<i class="bi bi-eye"></i>';
      toggle.dataset['atriumTooltip'] = t('widget.preview.view');
      toggle.setAttribute('aria-label', t('widget.preview.view'));
      status();
      editor.focus();
    } catch (error) {
      ui.toast('error', errorMessage(error));
    }
  }

  save.addEventListener('click', () => void writeFile());
  toggle.addEventListener('click', async () => {
    if (!editor) return openEditor();
    if (!(await keep())) return;
    const path = shown;
    closeEditor();
    shown = null;
    await show(path);
  });

  async function show(path: string | null) {
    if (editor) {
      if (path === shown) return;
      if (!(await keep())) return;
      closeEditor();
    }
    const kind = path === null ? null : previewKind(path);
    element.hidden = kind === null;
    if (path === null || kind === null) {
      shown = null;
      contentBox.replaceChildren();
      return;
    }
    if (path === shown && (kind === 'video' || kind === 'h264' || kind === 'audio')) return;
    const mine = ++ticket;
    shown = path;
    name.textContent = path.slice(path.lastIndexOf('/') + 1);
    info.textContent = t('widget.explorer.loading');
    element.dataset['kind'] = kind;
    element.classList.add('is-loading');
    toggle.hidden = kind !== 'text' && kind !== 'markdown';
    const rendered = renderPreview(kind, projectId, path, name.textContent);
    contentBox.replaceChildren(rendered.node);
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
  create({ project, ui }) {
    const element = document.createElement('div');
    element.style.height = '100%';
    const pane = createPreview(project.id, ui);
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
