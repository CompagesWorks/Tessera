import type { LayoutNode, PanelNode } from '@tessera/protocol';
import { describe, expect, it } from 'vitest';
import { renderDock, type DockActions } from './dock';

const actions: DockActions = { activate() {}, close() {}, resize() {}, drop() {}, requestEdit() {} };

describe('renderDock', () => {
  it('never re-inserts widget elements across tab switches and moves', () => {
    const elements = new Map(['a', 'b'].map((id) => [id, Object.assign(document.createElement('iframe'), { id })]));
    const widgets = { element: (id: string) => elements.get(id)!, label: () => ({ title: '', icon: 'x' }) };
    const container = document.body.appendChild(document.createElement('div'));
    const panel = (id: string, tabs: string[], active = 0): PanelNode => ({ type: 'panel', id, tabs, active });
    const a = elements.get('a')!;
    const b = elements.get('b')!;

    renderDock(container, panel('p', ['a', 'b'], 0), widgets, actions, false);
    const layer = container.querySelector('.tessera-dock-layer')!;
    const inserts = new MutationObserver(() => {});
    inserts.observe(layer, { childList: true });
    expect([a.parentElement, b.parentElement]).toEqual([layer, null]);

    renderDock(container, panel('p', ['a', 'b'], 1), widgets, actions, false);
    expect([a.style.display, b.style.display]).toEqual(['none', '']);

    const split: LayoutNode = { type: 'split', id: 's', dir: 'row', sizes: [50, 50], children: [panel('p', ['a']), panel('q', ['b'])] };
    renderDock(container, split, widgets, actions, false);
    expect([a.style.display, b.style.display]).toEqual(['', '']);
    expect(inserts.takeRecords().flatMap((r) => [...r.addedNodes, ...r.removedNodes])).toEqual([b]);
    expect(container.querySelector('.tessera-dock-layer')).toBe(layer);
  });
});
