import type { LayoutNode, PanelNode, SplitNode } from '@tessera/protocol';
import { t } from '../../i18n';
import type { DropZone } from '../../layout/tree';
import './dock.css';

export const WIDGET_MIME = 'application/x-tessera-widget';
export const TAB_MIME = 'application/x-tessera-tab';

export interface DockWidgets {
  element(widgetId: string): HTMLElement;
  label(widgetId: string): { title: string; icon: string };
}

export type DockDrop = { kind: 'widget'; type: string } | { kind: 'tab'; widgetId: string };

export interface DockActions {
  activate(panelId: string, index: number): void;
  close(widgetId: string): void;
  resize(splitId: string, sizes: number[]): void;
  drop(panelId: string, zone: DropZone, payload: DockDrop): void;
  requestEdit(): void;
}

const ZONES: DropZone[] = ['left', 'right', 'top', 'bottom', 'center'];

let preview: HTMLElement | null = null;

function previewBox(panel: HTMLElement, zone: DropZone) {
  preview ??= Object.assign(document.createElement('div'), { className: 'tessera-dock-preview' });
  if (!preview.isConnected) document.body.append(preview);
  const r = panel.getBoundingClientRect();
  const box = {
    left: [r.left, r.top, r.width / 2, r.height],
    right: [r.left + r.width / 2, r.top, r.width / 2, r.height],
    top: [r.left, r.top, r.width, r.height / 2],
    bottom: [r.left, r.top + r.height / 2, r.width, r.height / 2],
    center: [r.left, r.top, r.width, r.height],
  }[zone];
  Object.assign(preview.style, { display: 'block', left: `${box[0]}px`, top: `${box[1]}px`, width: `${box[2]}px`, height: `${box[3]}px` });
}

export function hidePreview() {
  if (preview) preview.style.display = 'none';
}

export function startWidgetDrag() {
  document.body.classList.add('is-dragging-widget');
}

export function endWidgetDrag() {
  document.body.classList.remove('is-dragging-widget');
  hidePreview();
}

function readDrop(event: DragEvent): DockDrop | null {
  const type = event.dataTransfer?.getData(WIDGET_MIME);
  if (type) return { kind: 'widget', type };
  const widgetId = event.dataTransfer?.getData(TAB_MIME);
  if (widgetId) return { kind: 'tab', widgetId };
  return null;
}

function renderPanel(node: PanelNode, widgets: DockWidgets, actions: DockActions, editing: boolean): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'tessera-dock-panel';
  panel.dataset['panel'] = node.id;

  const tabs = document.createElement('div');
  tabs.className = 'tessera-dock-tabs';
  node.tabs.forEach((widgetId, index) => {
    const { title, icon } = widgets.label(widgetId);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tessera-dock-tab';
    tab.classList.toggle('is-active', index === node.active);
    tab.innerHTML = `<i class="bi bi-${icon}"></i>`;
    tab.append(title);
    const close = document.createElement('i');
    close.className = 'bi bi-x tessera-dock-tab-close';
    close.dataset['atriumTooltip'] = t('dock.closeWidget');
    tab.append(close);
    tab.addEventListener('click', (event) => {
      if (event.target === close) actions.close(widgetId);
      else actions.activate(node.id, index);
    });
    tab.draggable = editing;
    tab.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData(TAB_MIME, widgetId);
      startWidgetDrag();
    });
    tab.addEventListener('dragend', endWidgetDrag);
    tabs.append(tab);
  });

  const body = document.createElement('div');
  body.className = 'tessera-dock-body';
  const activeId = node.tabs[node.active];
  if (activeId) {
    body.append(widgets.element(activeId));
  } else {
    const empty = document.createElement('div');
    empty.className = 'tessera-dock-empty';
    empty.innerHTML = '<i class="bi bi-grid-1x2"></i>';
    const title = document.createElement('b');
    title.textContent = t('dock.emptyTitle');
    const text = document.createElement('span');
    text.textContent = editing ? t('dock.emptyEditing') : t('dock.emptyText');
    empty.append(title, text);
    if (!editing) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'atrium-btn atrium-btn-secondary';
      add.textContent = t('dock.addWidget');
      add.addEventListener('click', () => actions.requestEdit());
      empty.append(add);
    }
    body.append(empty);
  }

  const drop = document.createElement('div');
  drop.className = 'tessera-dock-drop';
  for (const zone of ZONES) {
    const area = document.createElement('div');
    area.className = 'tessera-dock-zone';
    area.dataset['zone'] = zone;
    area.addEventListener('dragover', (event) => {
      event.preventDefault();
      previewBox(panel, zone);
    });
    area.addEventListener('dragleave', hidePreview);
    area.addEventListener('drop', (event) => {
      event.preventDefault();
      const payload = readDrop(event);
      endWidgetDrag();
      if (payload) actions.drop(node.id, zone, payload);
    });
    drop.append(area);
  }

  panel.append(tabs, body, drop);
  return panel;
}

function renderGutter(split: SplitNode, index: number, container: HTMLElement, actions: DockActions): HTMLElement {
  const gutter = document.createElement('div');
  gutter.className = 'tessera-dock-gutter';
  gutter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    gutter.setPointerCapture(event.pointerId);
    gutter.classList.add('is-dragging');
    const horizontal = split.dir === 'row';
    const items = [...container.children].filter((el) => !el.classList.contains('tessera-dock-gutter')) as HTMLElement[];
    const a = items[index]!;
    const b = items[index + 1]!;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const start = horizontal ? ra.left : ra.top;
    const span = horizontal ? rb.right - ra.left : rb.bottom - ra.top;
    const sizes = [...split.sizes];
    const total = sizes[index]! + sizes[index + 1]!;

    const move = (ev: PointerEvent) => {
      const ratio = Math.min(Math.max(((horizontal ? ev.clientX : ev.clientY) - start) / span, 0.1), 0.9);
      sizes[index] = ratio * total;
      sizes[index + 1] = total - ratio * total;
      a.style.flexGrow = String(sizes[index]);
      b.style.flexGrow = String(sizes[index + 1]);
    };
    const up = () => {
      gutter.classList.remove('is-dragging');
      gutter.removeEventListener('pointermove', move);
      gutter.removeEventListener('pointerup', up);
      actions.resize(split.id, sizes.map((s) => Math.round(s * 100) / 100));
    };
    gutter.addEventListener('pointermove', move);
    gutter.addEventListener('pointerup', up);
  });
  return gutter;
}

function renderNode(node: LayoutNode, widgets: DockWidgets, actions: DockActions, editing: boolean): HTMLElement {
  if (node.type === 'panel') return renderPanel(node, widgets, actions, editing);
  const split = document.createElement('div');
  split.className = 'tessera-dock-split';
  split.classList.toggle('is-col', node.dir === 'col');
  node.children.forEach((child, index) => {
    if (index > 0) split.append(renderGutter(node, index - 1, split, actions));
    const element = renderNode(child, widgets, actions, editing);
    element.style.flexGrow = String(node.sizes[index] ?? 1);
    split.append(element);
  });
  return split;
}

export function renderDock(container: HTMLElement, root: LayoutNode, widgets: DockWidgets, actions: DockActions, editing: boolean) {
  container.classList.add('tessera-dock');
  container.classList.toggle('is-editing', editing);
  container.replaceChildren(renderNode(root, widgets, actions, editing));
}
