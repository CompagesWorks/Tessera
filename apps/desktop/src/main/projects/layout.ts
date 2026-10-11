import { join } from 'node:path';
import { defaultLayout, ProjectLayoutSchema, type LayoutNode, type ProjectLayout } from '@tessera/protocol';
import { readJson, writeJson } from '../fs/json';
import { TESSERA_DIR } from './files';

export const layoutFile = (root: string) => join(root, TESSERA_DIR, 'layout.json');

export function normalizeLayout(layout: ProjectLayout): ProjectLayout {
  const seen = new Set<string>();
  const used = new Set<string>();

  const fix = (node: LayoutNode): LayoutNode | null => {
    if (seen.has(node.id)) return null;
    seen.add(node.id);
    if (node.type === 'panel') {
      const tabs = [...new Set(node.tabs)].filter((tab) => layout.widgets[tab] && !used.has(tab));
      tabs.forEach((tab) => used.add(tab));
      return { ...node, tabs, active: Math.min(node.active, Math.max(tabs.length - 1, 0)) };
    }
    const children: LayoutNode[] = [];
    const sizes: number[] = [];
    node.children.forEach((child, index) => {
      const fixed = fix(child);
      if (fixed) {
        children.push(fixed);
        sizes.push(node.sizes[index] ?? 1);
      }
    });
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    return { ...node, children, sizes };
  };

  const workspaces = layout.workspaces.flatMap((workspace) => {
    if (seen.has(workspace.id)) return [];
    seen.add(workspace.id);
    const root = fix(workspace.root) ?? { type: 'panel' as const, id: `p-${workspace.id}`, tabs: [], active: 0 };
    return [{ ...workspace, root }];
  });
  if (workspaces.length === 0) return defaultLayout();

  const widgets = Object.fromEntries(Object.entries(layout.widgets).filter(([id]) => used.has(id)));
  const active = workspaces.some((w) => w.id === layout.active) ? layout.active : workspaces[0]!.id;
  return { formatVersion: 1, active, workspaces, widgets };
}

export async function readLayout(root: string): Promise<ProjectLayout> {
  const layout = await readJson(layoutFile(root), ProjectLayoutSchema);
  return layout ? normalizeLayout(layout) : defaultLayout();
}

export async function writeLayout(root: string, layout: ProjectLayout) {
  await writeJson(layoutFile(root), normalizeLayout(layout));
}
