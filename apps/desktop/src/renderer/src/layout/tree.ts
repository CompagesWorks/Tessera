import type { LayoutNode, PanelNode, ProjectLayout, SplitNode, Workspace } from '@tessera/protocol';

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function emptyPanel(): PanelNode {
  return { type: 'panel', id: newId('p'), tabs: [], active: 0 };
}

export function workspaceOf(layout: ProjectLayout, id = layout.active): Workspace {
  return layout.workspaces.find((w) => w.id === id) ?? layout.workspaces[0]!;
}

function visit(node: LayoutNode, fn: (node: LayoutNode, parent: SplitNode | null) => void, parent: SplitNode | null = null) {
  fn(node, parent);
  if (node.type === 'split') node.children.forEach((child) => visit(child, fn, node));
}

export function findPanel(root: LayoutNode, id: string): PanelNode | null {
  let found: PanelNode | null = null;
  visit(root, (node) => {
    if (node.type === 'panel' && node.id === id) found = node;
  });
  return found;
}

export function panelsOf(root: LayoutNode): PanelNode[] {
  const panels: PanelNode[] = [];
  visit(root, (node) => {
    if (node.type === 'panel') panels.push(node);
  });
  return panels;
}

function replaceNode(root: LayoutNode, id: string, next: LayoutNode): LayoutNode {
  if (root.id === id) return next;
  if (root.type === 'panel') return root;
  return { ...root, children: root.children.map((child) => replaceNode(child, id, next)) };
}

function prune(node: LayoutNode, isRoot: boolean): LayoutNode | null {
  if (node.type === 'panel') return node.tabs.length > 0 || isRoot ? node : null;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const kept = prune(child, false);
    if (kept) {
      children.push(kept);
      sizes.push(node.sizes[index] ?? 1);
    }
  });
  if (children.length === 0) return isRoot ? emptyPanel() : null;
  if (children.length === 1) return children[0]!;
  return { ...node, children, sizes };
}

function update(layout: ProjectLayout, workspaceId: string, change: (root: LayoutNode) => LayoutNode): ProjectLayout {
  return {
    ...layout,
    workspaces: layout.workspaces.map((w) => (w.id === workspaceId ? { ...w, root: prune(change(structuredClone(w.root)), true)! } : w)),
  };
}

function insertTab(root: LayoutNode, panelId: string, zone: DropZone, widgetId: string): LayoutNode {
  const panel = findPanel(root, panelId);
  if (!panel) return root;
  if (zone === 'center' || panel.tabs.length === 0) {
    panel.tabs.push(widgetId);
    panel.active = panel.tabs.length - 1;
    return root;
  }
  const fresh: PanelNode = { type: 'panel', id: newId('p'), tabs: [widgetId], active: 0 };
  const first = zone === 'left' || zone === 'top';
  const split: SplitNode = {
    type: 'split',
    id: newId('s'),
    dir: zone === 'left' || zone === 'right' ? 'row' : 'col',
    sizes: [50, 50],
    children: first ? [fresh, panel] : [panel, fresh],
  };
  return replaceNode(root, panel.id, split);
}

export function addWidget(layout: ProjectLayout, workspaceId: string, panelId: string, zone: DropZone, type: string) {
  const widgetId = newId('w');
  const next = update(layout, workspaceId, (root) => insertTab(root, panelId, zone, widgetId));
  return { layout: { ...next, widgets: { ...next.widgets, [widgetId]: { type, state: {} } } }, widgetId };
}

export function moveTab(layout: ProjectLayout, workspaceId: string, widgetId: string, panelId: string, zone: DropZone): ProjectLayout {
  const workspace = workspaceOf(layout, workspaceId);
  const source = panelsOf(workspace.root).find((p) => p.tabs.includes(widgetId));
  if (!source) return layout;
  if (source.id === panelId && (zone === 'center' || source.tabs.length === 1)) return layout;
  return update(layout, workspaceId, (root) => {
    const from = findPanel(root, source.id)!;
    from.tabs = from.tabs.filter((tab) => tab !== widgetId);
    from.active = Math.min(from.active, Math.max(from.tabs.length - 1, 0));
    const target = findPanel(root, panelId);
    if (!target) return root;
    if (target.id === from.id && from.tabs.length === 0) {
      from.tabs.push(widgetId);
      return root;
    }
    return insertTab(root, panelId, zone, widgetId);
  });
}

export function closeTab(layout: ProjectLayout, workspaceId: string, widgetId: string): ProjectLayout {
  const next = update(layout, workspaceId, (root) => {
    for (const panel of panelsOf(root)) {
      if (!panel.tabs.includes(widgetId)) continue;
      panel.tabs = panel.tabs.filter((tab) => tab !== widgetId);
      panel.active = Math.min(panel.active, Math.max(panel.tabs.length - 1, 0));
    }
    return root;
  });
  const { [widgetId]: _removed, ...widgets } = next.widgets;
  return { ...next, widgets };
}

export function setActiveTab(layout: ProjectLayout, workspaceId: string, panelId: string, index: number): ProjectLayout {
  return update(layout, workspaceId, (root) => {
    const panel = findPanel(root, panelId);
    if (panel) panel.active = Math.max(0, Math.min(index, panel.tabs.length - 1));
    return root;
  });
}

export function resize(layout: ProjectLayout, workspaceId: string, splitId: string, sizes: number[]): ProjectLayout {
  return update(layout, workspaceId, (root) => {
    visit(root, (node) => {
      if (node.type === 'split' && node.id === splitId && sizes.length === node.children.length) node.sizes = sizes;
    });
    return root;
  });
}

export function setWidgetState(layout: ProjectLayout, widgetId: string, state: Record<string, unknown>): ProjectLayout {
  const widget = layout.widgets[widgetId];
  if (!widget) return layout;
  return { ...layout, widgets: { ...layout.widgets, [widgetId]: { ...widget, state } } };
}

function cloneTree(root: LayoutNode, widgets: ProjectLayout['widgets']) {
  const copies: ProjectLayout['widgets'] = {};
  const copy = (node: LayoutNode): LayoutNode => {
    if (node.type === 'split') return { ...node, id: newId('s'), children: node.children.map(copy) };
    const tabs = node.tabs.flatMap((tab) => {
      const widget = widgets[tab];
      if (!widget) return [];
      const id = newId('w');
      copies[id] = structuredClone(widget);
      return [id];
    });
    return { ...node, id: newId('p'), tabs };
  };
  return { root: copy(root), widgets: copies };
}

export function addWorkspace(layout: ProjectLayout, options: { name: string; icon: string; copyOf?: string }): ProjectLayout {
  const id = newId('ws');
  const source = options.copyOf ? workspaceOf(layout, options.copyOf) : null;
  const { root, widgets } = source ? cloneTree(source.root, layout.widgets) : { root: emptyPanel(), widgets: {} };
  return {
    ...layout,
    active: id,
    workspaces: [...layout.workspaces, { id, name: options.name, icon: options.icon, root }],
    widgets: { ...layout.widgets, ...widgets },
  };
}

export function editWorkspace(layout: ProjectLayout, id: string, patch: { name: string; icon: string }): ProjectLayout {
  return { ...layout, workspaces: layout.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)) };
}

export function removeWorkspace(layout: ProjectLayout, id: string): ProjectLayout {
  if (layout.workspaces.length <= 1) return layout;
  const workspace = workspaceOf(layout, id);
  const dropped = new Set(panelsOf(workspace.root).flatMap((p) => p.tabs));
  const workspaces = layout.workspaces.filter((w) => w.id !== id);
  return {
    ...layout,
    active: layout.active === id ? workspaces[0]!.id : layout.active,
    workspaces,
    widgets: Object.fromEntries(Object.entries(layout.widgets).filter(([key]) => !dropped.has(key))),
  };
}

export function moveWorkspace(layout: ProjectLayout, id: string, toIndex: number): ProjectLayout {
  const workspaces = [...layout.workspaces];
  const from = workspaces.findIndex((w) => w.id === id);
  if (from === -1) return layout;
  const [moved] = workspaces.splice(from, 1);
  workspaces.splice(Math.max(0, Math.min(toIndex, workspaces.length)), 0, moved!);
  return { ...layout, workspaces };
}
