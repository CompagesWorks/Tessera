import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginService, readManifest } from './service';

let dir: string;
let pluginDir: string;

const manifest = (overrides: Record<string, unknown> = {}) => ({
  id: 'test.plugin',
  name: 'Test',
  version: '1.0.0',
  author: 'Me',
  engines: { tessera: '^0.1.0' },
  permissions: ['fs.project.read'],
  contributes: { widgets: [{ id: 'main', title: 'Main', entry: 'widget.html' }] },
  ...overrides,
});

async function writePlugin(data: unknown) {
  await writeFile(join(pluginDir, 'manifest.json'), JSON.stringify(data));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tessera-plugins-'));
  pluginDir = join(dir, 'plugin');
  await mkdir(pluginDir);
  await writeFile(join(pluginDir, 'widget.html'), '<p>hi</p>');
  await writeFile(join(dir, 'secret.txt'), 'secret');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readManifest', () => {
  it('accepts a valid manifest and fills defaults', async () => {
    await writePlugin(manifest());
    const result = await readManifest(pluginDir);
    expect(result.contributes.widgets[0]).toMatchObject({ category: 'other', icon: 'puzzle' });
  });

  it('refuses reserved ids, unknown permissions and escaping entries', async () => {
    await writePlugin(manifest({ id: 'core.evil' }));
    await expect(readManifest(pluginDir)).rejects.toMatchObject({ code: 'invalid-manifest' });

    await writePlugin(manifest({ permissions: ['exec'] }));
    await expect(readManifest(pluginDir)).rejects.toMatchObject({ code: 'invalid-manifest' });

    await writePlugin(manifest({ contributes: { widgets: [{ id: 'main', title: 'Main', entry: '../secret.txt' }] } }));
    await expect(readManifest(pluginDir)).rejects.toMatchObject({ code: 'invalid-manifest' });

    await writePlugin(manifest({ contributes: { widgets: [{ id: 'main', title: 'Main', entry: 'missing.html' }] } }));
    await expect(readManifest(pluginDir)).rejects.toMatchObject({ code: 'missing-entry' });
  });

  it('refuses broken JSON', async () => {
    await writeFile(join(pluginDir, 'manifest.json'), '{ nope');
    await expect(readManifest(pluginDir)).rejects.toMatchObject({ code: 'invalid-manifest' });
  });
});

describe('PluginService', () => {
  it('installs, grants only declared permissions and persists', async () => {
    await writePlugin(manifest());
    const service = new PluginService(join(dir, 'plugins.json'));
    await service.load();
    const plugin = await service.installLocal(pluginDir, ['fs.project.read']);
    expect(plugin.granted).toEqual(['fs.project.read']);

    const reloaded = new PluginService(join(dir, 'plugins.json'));
    await reloaded.load();
    expect(reloaded.list().map((p) => p.manifest.id)).toEqual(['test.plugin']);
  });

  it('serves files inside the plugin only, and nothing when disabled', async () => {
    await writePlugin(manifest());
    const service = new PluginService(join(dir, 'plugins.json'));
    await service.installLocal(pluginDir, []);

    expect(await service.resolveFile('test.plugin', 'widget.html')).toBe(join(pluginDir, 'widget.html'));
    expect(await service.resolveFile('test.plugin', '../secret.txt')).toBeNull();
    expect(await service.resolveFile('test.plugin', '..%2Fsecret.txt')).toBeNull();
    expect(await service.resolveFile('other.plugin', 'widget.html')).toBeNull();

    await service.setEnabled('test.plugin', false);
    expect(await service.resolveFile('test.plugin', 'widget.html')).toBeNull();
  });

  it('revokes permissions and removes plugins', async () => {
    await writePlugin(manifest());
    const service = new PluginService(join(dir, 'plugins.json'));
    await service.installLocal(pluginDir, ['fs.project.read']);
    expect((await service.setGrants('test.plugin', [])).granted).toEqual([]);
    await service.remove('test.plugin');
    expect(service.list()).toEqual([]);
  });
});
