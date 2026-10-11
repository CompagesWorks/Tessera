import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLayout, type ProjectLayout } from '@tessera/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listDir } from './files-list';
import { normalizeLayout, readLayout, writeLayout } from './layout';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tessera-layout-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('normalizeLayout', () => {
  it('drops missing widgets, duplicate tabs and unused widget instances', () => {
    const layout: ProjectLayout = {
      formatVersion: 1,
      active: 'nope',
      workspaces: [
        {
          id: 'ws-a',
          name: 'A',
          icon: 'grid',
          root: {
            type: 'split',
            id: 's-1',
            dir: 'row',
            sizes: [30, 70],
            children: [
              { type: 'panel', id: 'p-1', tabs: ['w-1', 'w-ghost', 'w-1'], active: 5 },
              { type: 'panel', id: 'p-2', tabs: ['w-1'], active: 0 },
            ],
          },
        },
      ],
      widgets: { 'w-1': { type: 'core/notes', state: {} }, 'w-unused': { type: 'core/notes', state: {} } },
    };

    const result = normalizeLayout(layout);
    expect(result.active).toBe('ws-a');
    expect(Object.keys(result.widgets)).toEqual(['w-1']);
    const root = result.workspaces[0]!.root;
    expect(root.type).toBe('split');
    if (root.type !== 'split') return;
    expect(root.children[0]).toMatchObject({ tabs: ['w-1'], active: 0 });
    expect(root.children[1]).toMatchObject({ tabs: [] });
  });

  it('collapses a split with one child', () => {
    const layout = defaultLayout();
    layout.workspaces[0]!.root = {
      type: 'split',
      id: 's-1',
      dir: 'row',
      sizes: [50, 50],
      children: [
        { type: 'panel', id: 'p-1', tabs: [], active: 0 },
        { type: 'panel', id: 'p-1', tabs: [], active: 0 },
      ],
    };
    expect(normalizeLayout(layout).workspaces[0]!.root).toMatchObject({ type: 'panel', id: 'p-1' });
  });
});

describe('layout file', () => {
  it('returns the default layout when missing or broken, and round-trips', async () => {
    expect(await readLayout(dir)).toEqual(defaultLayout());
    await mkdir(join(dir, '.tessera'), { recursive: true });
    await writeFile(join(dir, '.tessera', 'layout.json'), '{ broken');
    expect(await readLayout(dir)).toEqual(defaultLayout());

    const layout = defaultLayout();
    layout.widgets['w-1'] = { type: 'core/notes', state: { text: 'hi' } };
    layout.workspaces[0]!.root = { type: 'panel', id: 'p-main', tabs: ['w-1'], active: 0 };
    await writeLayout(dir, layout);
    expect(await readLayout(dir)).toEqual(layout);
  });
});

describe('listDir', () => {
  it('lists inside the project only, hiding .tessera', async () => {
    await mkdir(join(dir, '.tessera'));
    await mkdir(join(dir, 'sources'));
    await writeFile(join(dir, 'sources', 'b.png'), 'xx');
    await writeFile(join(dir, 'a.txt'), 'x');

    expect((await listDir(dir, '')).map((e) => e.name)).toEqual(['sources', 'a.txt']);
    expect(await listDir(dir, 'sources')).toEqual([{ name: 'b.png', path: 'sources/b.png', kind: 'file', size: 2 }]);
    await expect(listDir(dir, '../')).rejects.toThrow('outside project');
  });

  it('refuses to follow a link that leaves the project', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'tessera-outside-'));
    try {
      await symlink(outside, join(dir, 'escape'), 'junction');
      await expect(listDir(dir, 'escape')).rejects.toThrow('outside project');
      expect((await listDir(dir, '')).map((e) => e.name)).not.toContain('escape');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
