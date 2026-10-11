import { WIDGET_CATEGORIES, type ProjectLayout, type ProjectSummary, type WidgetCategory } from '@tessera/protocol';
import { endWidgetDrag, renderDock, startWidgetDrag, WIDGET_MIME, type DockActions } from '../../../components/dock/dock';
import { fromTemplate, required } from '../../../components/dom';
import { t } from '../../../i18n';
import {
  addWidget,
  addWorkspace,
  closeTab,
  editWorkspace,
  moveTab,
  moveWorkspace,
  panelsOf,
  removeWorkspace,
  resize,
  setActiveTab,
  setWidgetState,
  workspaceOf,
} from '../../../layout/tree';
import type { UiProvider } from '../../../ui/provider';
import { CATEGORY_ICONS, categoryLabel, searchWidgets } from '../../../widgets/categories';
import { allWidgets, onWidgetsChange } from '../../../widgets/registry';
import type { WidgetDefinition } from '../../../widgets/types';
import { workspaceDialog } from '../workspace-dialog/workspace-dialog';
import { createWidgetHost } from './widget-host';
import './workspace.css';
import template from './workspace.html?raw';

const SAVE_DELAY = 400;
const WORKSPACE_MIME = 'application/x-tessera-workspace';

interface Options {
  host: HTMLElement;
  sidebar: HTMLElement;
  ui: UiProvider;
  onEditingChange(editing: boolean): void;
}

export function createWorkspaceController({ host, sidebar, ui, onEditingChange }: Options) {
  const area = fromTemplate(template);
  const dockEl = required<HTMLElement>(area, '[data-dock]');
  const widgetList = required<HTMLElement>(area, '[data-widgets]');
  const categoryList = required<HTMLElement>(area, '[data-categories]');
  const drawerSearch = required<HTMLInputElement>(area, '[data-search]');
  let drawerCategory: WidgetCategory | 'all' = 'all';
  drawerSearch.addEventListener('input', () => renderDrawer());
  onWidgetsChange(() => {
    widgetHost?.dispose();
    renderDrawer();
    render();
  });
  host.append(area);

  let project: ProjectSummary | null = null;
  let layout: ProjectLayout | null = null;
  let editing = false;
  let saveTimer = 0;
  let widgetHost: ReturnType<typeof createWidgetHost> | null = null;

  const save = () => {
    clearTimeout(saveTimer);
    if (!project || !layout) return Promise.resolve();
    return window.tessera.invoke('layout:save', { id: project.id, layout }).catch((error) => {
      console.error('[layout] save failed', error);
      ui.toast('error', t('error.layoutSave'));
    });
  };

  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), SAVE_DELAY);
  };

  const commit = (next: ProjectLayout) => {
    layout = next;
    scheduleSave();
    render();
  };

  const actions: DockActions = {
    activate: (panelId, index) => layout && commit(setActiveTab(layout, layout.active, panelId, index)),
    close: (widgetId) => layout && commit(closeTab(layout, layout.active, widgetId)),
    resize: (splitId, sizes) => layout && commit(resize(layout, layout.active, splitId, sizes)),
    drop: (panelId, zone, payload) => {
      if (!layout) return;
      if (payload.kind === 'widget') commit(addWidget(layout, layout.active, panelId, zone, payload.type).layout);
      else commit(moveTab(layout, layout.active, payload.widgetId, panelId, zone));
    },
    requestEdit: () => setEditing(true),
  };

  function renderSidebar() {
    sidebar.replaceChildren();
    if (!layout) return;
    layout.workspaces.forEach((workspace, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'atrium-sidebar-btn tessera-workspace-btn';
      button.classList.toggle('is-active', workspace.id === layout!.active);
      button.dataset['atriumTooltip'] = workspace.name;
      button.dataset['atriumTooltipPosition'] = 'right';
      button.innerHTML = `<i class="bi bi-${workspace.icon}"></i>`;
      button.draggable = true;
      button.addEventListener('click', () => switchTo(workspace.id));
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        ui.atrium.menu.open(event, [
          { label: t('workspace.edit'), icon: 'pencil', onClick: () => void edit(workspace.id) },
          { label: t('workspace.duplicate'), icon: 'copy', onClick: () => layout && commit(addWorkspace(layout, { name: `${workspace.name} 2`, icon: workspace.icon, copyOf: workspace.id })) },
          'separator',
          { label: t('workspace.delete'), icon: 'trash3', danger: true, disabled: layout!.workspaces.length <= 1, onClick: () => void remove(workspace.id) },
        ]);
      });
      button.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData(WORKSPACE_MIME, workspace.id);
        button.classList.add('is-dragging');
      });
      button.addEventListener('dragend', () => button.classList.remove('is-dragging'));
      button.addEventListener('dragover', (event) => {
        if (event.dataTransfer?.types.includes(WORKSPACE_MIME)) event.preventDefault();
      });
      button.addEventListener('drop', (event) => {
        const id = event.dataTransfer?.getData(WORKSPACE_MIME);
        if (id && layout) commit(moveWorkspace(layout, id, index));
      });
      sidebar.append(button);
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'atrium-sidebar-btn tessera-workspace-add';
    add.dataset['atriumTooltip'] = t('workspace.newTitle');
    add.dataset['atriumTooltipPosition'] = 'right';
    add.innerHTML = '<i class="bi bi-plus-lg"></i>';
    add.addEventListener('click', () => void create());
    sidebar.append(add);
  }

  function drawerCard(definition: WidgetDefinition) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'tessera-drawer-card';
    card.draggable = true;
    card.innerHTML = `<i class="bi bi-${definition.icon}"></i>`;
    const text = document.createElement('span');
    text.textContent = definition.title();
    const small = document.createElement('small');
    const source = document.createElement('span');
    source.className = 'tessera-drawer-source';
    source.innerHTML = definition.trust === 'plugin' ? '<i class="bi bi-puzzle"></i>' : '';
    source.append(definition.trust === 'plugin' ? definition.source : t('drawer.builtin'));
    small.append(definition.description() ? `${definition.description()} · ` : '', source);
    text.append(small);
    card.append(text);
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData(WIDGET_MIME, definition.type);
      startWidgetDrag();
    });
    card.addEventListener('dragend', endWidgetDrag);
    card.addEventListener('click', () => {
      if (!layout) return;
      const target = panelsOf(workspaceOf(layout).root).find((p) => p.tabs.length === 0) ?? panelsOf(workspaceOf(layout).root)[0]!;
      commit(addWidget(layout, layout.active, target.id, 'center', definition.type).layout);
    });
    return card;
  }

  function renderDrawer() {
    const widgets = allWidgets();
    const present = WIDGET_CATEGORIES.filter((cat) => widgets.some((w) => w.category === cat));
    if (drawerCategory !== 'all' && !present.includes(drawerCategory)) drawerCategory = 'all';

    const chip = (value: WidgetCategory | 'all', label: string, icon: string, count: number) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'atrium-chip-btn';
      button.classList.toggle('is-active', value === drawerCategory);
      button.innerHTML = `<i class="bi bi-${icon}"></i>`;
      button.append(label);
      const badge = document.createElement('span');
      badge.className = 'tessera-chip-count';
      badge.textContent = String(count);
      button.append(badge);
      button.addEventListener('click', () => {
        drawerCategory = value;
        renderDrawer();
      });
      return button;
    };
    categoryList.replaceChildren(
      chip('all', t('drawer.all'), 'grid-3x3-gap', widgets.length),
      ...present.map((cat) => chip(cat, categoryLabel(cat), CATEGORY_ICONS[cat], widgets.filter((w) => w.category === cat).length)),
    );

    const groups = searchWidgets(widgets, drawerSearch.value, drawerCategory);
    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tessera-drawer-empty';
      empty.textContent = t('drawer.noMatch');
      widgetList.replaceChildren(empty);
      return;
    }
    widgetList.replaceChildren(
      ...groups.flatMap(({ category, widgets: list }) => {
        const header = document.createElement('div');
        header.className = 'tessera-drawer-group';
        header.innerHTML = `<i class="bi bi-${CATEGORY_ICONS[category]}"></i>`;
        header.append(categoryLabel(category));
        return [header, ...list.map(drawerCard)];
      }),
    );
  }

  function render() {
    if (!layout || !widgetHost) return;
    ui.atrium.tooltip.hide();
    widgetHost.prune(new Set(Object.keys(layout.widgets)));
    renderDock(dockEl, workspaceOf(layout).root, widgetHost, actions, editing);
    area.classList.toggle('is-editing', editing);
    renderSidebar();
  }

  function switchTo(id: string) {
    if (!layout || layout.active === id) return;
    commit({ ...layout, active: id });
  }

  async function create() {
    if (!layout) return;
    const result = await workspaceDialog(ui);
    if (!result || !layout) return;
    commit(addWorkspace(layout, { name: result.name, icon: result.icon, ...(result.copy && { copyOf: layout.active }) }));
    if (!result.copy) setEditing(true);
  }

  async function edit(id: string) {
    if (!layout) return;
    const result = await workspaceDialog(ui, workspaceOf(layout, id));
    if (result && layout) commit(editWorkspace(layout, id, { name: result.name, icon: result.icon }));
  }

  async function remove(id: string) {
    if (!layout) return;
    const workspace = workspaceOf(layout, id);
    const ok = await ui.atrium.modal.confirm({
      title: t('workspace.deleteTitle', { name: workspace.name }),
      message: t('workspace.deleteMessage'),
      confirmText: t('delete.confirm'),
      cancelText: t('dialog.cancel'),
      danger: true,
    });
    if (ok && layout) commit(removeWorkspace(layout, id));
  }

  function setEditing(next: boolean) {
    if (editing === next) return;
    editing = next;
    onEditingChange(editing);
    render();
  }

  return {
    load(next: ProjectSummary, nextLayout: ProjectLayout) {
      project = next;
      layout = nextLayout;
      editing = false;
      widgetHost?.dispose();
      widgetHost = createWidgetHost({
        project: next,
        ui,
        instance: (widgetId) => layout?.widgets[widgetId],
        saveState: (widgetId, state) => {
          if (!layout) return;
          layout = setWidgetState(layout, widgetId, state);
          scheduleSave();
        },
      });
      renderDrawer();
      onEditingChange(false);
      render();
    },

    async unload() {
      ui.atrium.tooltip.hide();
      widgetHost?.dispose();
      widgetHost = null;
      await save();
      project = null;
      layout = null;
      editing = false;
      sidebar.replaceChildren();
      dockEl.replaceChildren();
      onEditingChange(false);
    },

    toggleEditing: () => setEditing(!editing),
    get editing() {
      return editing;
    },
    newWorkspace: () => void create(),
    workspaces: () => layout?.workspaces ?? [],
    switchTo,
    relabel() {
      renderDrawer();
      render();
    },
  };
}

export type WorkspaceController = ReturnType<typeof createWorkspaceController>;
