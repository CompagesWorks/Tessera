import { defaultLayout, type ProjectLayout } from '@tessera/protocol';
import { describe, expect, it } from 'vitest';
import { addWidget, addWorkspace, closeTab, moveTab, moveWorkspace, panelsOf, removeWorkspace, resize, workspaceOf } from './tree';

const WS = 'ws-main';

function withTwoPanels(): { layout: ProjectLayout; a: string; b: string } {
  let layout = defaultLayout();
  const first = addWidget(layout, WS, 'p-main', 'center', 'core/notes');
  layout = first.layout;
  const second = addWidget(layout, WS, 'p-main', 'right', 'core/explorer');
  return { layout: second.layout, a: first.widgetId, b: second.widgetId };
}

describe('layout tree', () => {
  it('fills an empty panel, then splits on an edge', () => {
    const { layout, a, b } = withTwoPanels();
    const root = workspaceOf(layout).root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.dir).toBe('row');
    expect(panelsOf(root).map((p) => p.tabs)).toEqual([[a], [b]]);
    expect(Object.keys(layout.widgets).sort()).toEqual([a, b].sort());
  });

  it('puts the new panel first for left and top', () => {
    let layout = defaultLayout();
    const first = addWidget(layout, WS, 'p-main', 'center', 'core/notes');
    const second = addWidget(first.layout, WS, 'p-main', 'top', 'core/explorer');
    const root = workspaceOf(second.layout).root;
    expect(root.type === 'split' && root.dir).toBe('col');
    expect(panelsOf(root)[0]!.tabs).toEqual([second.widgetId]);
  });

  it('closing the last tab of a panel collapses the split', () => {
    const { layout, a, b } = withTwoPanels();
    const next = closeTab(layout, WS, b);
    const root = workspaceOf(next).root;
    expect(root).toMatchObject({ type: 'panel', tabs: [a] });
    expect(next.widgets[b]).toBeUndefined();
  });

  it('keeps an empty root panel when everything is closed', () => {
    const { layout, a, b } = withTwoPanels();
    const next = closeTab(closeTab(layout, WS, a), WS, b);
    expect(workspaceOf(next).root).toMatchObject({ type: 'panel', tabs: [] });
    expect(next.widgets).toEqual({});
  });

  it('moves a tab into another panel and drops the empty source', () => {
    const { layout, a, b } = withTwoPanels();
    const target = panelsOf(workspaceOf(layout).root).find((p) => p.tabs.includes(b))!;
    const next = moveTab(layout, WS, a, target.id, 'center');
    expect(workspaceOf(next).root).toMatchObject({ type: 'panel', tabs: [b, a] });
  });

  it('resizes a split', () => {
    const { layout } = withTwoPanels();
    const root = workspaceOf(layout).root;
    const next = resize(layout, WS, root.id, [30, 70]);
    expect(workspaceOf(next).root).toMatchObject({ sizes: [30, 70] });
  });

  it('copies a workspace with fresh widget instances and removes it cleanly', () => {
    const { layout } = withTwoPanels();
    const copied = addWorkspace(layout, { name: 'Copie', icon: 'copy', copyOf: WS });
    expect(copied.workspaces).toHaveLength(2);
    expect(Object.keys(copied.widgets)).toHaveLength(4);
    expect(copied.active).toBe(copied.workspaces[1]!.id);

    const removed = removeWorkspace(copied, copied.active);
    expect(removed.workspaces).toHaveLength(1);
    expect(Object.keys(removed.widgets)).toHaveLength(2);
    expect(removed.active).toBe(WS);
    expect(removeWorkspace(removed, WS)).toBe(removed);
  });

  it('reorders workspaces', () => {
    const layout = addWorkspace(addWorkspace(defaultLayout(), { name: 'B', icon: 'b' }), { name: 'C', icon: 'c' });
    const [, b, c] = layout.workspaces;
    const next = moveWorkspace(layout, c!.id, 0);
    expect(next.workspaces.map((w) => w.id)).toEqual([c!.id, WS, b!.id]);
  });
});
