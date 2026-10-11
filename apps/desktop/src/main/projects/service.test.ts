import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderName } from './folder-name';
import { ProjectService } from './service';

let dir: string;
let service: ProjectService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tessera-test-'));
  service = new ProjectService(join(dir, 'projects.json'), join(dir, 'Projects'));
  await service.load();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('folderName', () => {
  it('makes a safe folder name', () => {
    expect(folderName('Mario Classic')).toBe('mario-classic');
    expect(folderName('Évolution: <test>')).toBe('evolution-test');
    expect(folderName('CON')).toBe('projet');
    expect(folderName('...')).toBe('projet');
  });
});

describe('ProjectService', () => {
  it('creates a project in the default location', async () => {
    const project = await service.create({ name: 'Mario Classic', kind: 'skin', location: join(dir, 'Projects') });

    expect(project.name).toBe('Mario Classic');
    expect(project.path).toBe(join(dir, 'Projects', 'mario-classic'));
    expect(project.status).toBe('draft');
    expect(project.missing).toBe(false);
    const file = JSON.parse(await readFile(join(project.path, '.tessera', 'project.json'), 'utf8'));
    expect(file.id).toBe(project.id);
  });

  it('never overwrites an existing folder', async () => {
    const location = join(dir, 'Projects');
    const a = await service.create({ name: 'Same', kind: 'skin', location });
    const b = await service.create({ name: 'Same', kind: 'skin', location });
    expect(b.path).not.toBe(a.path);
  });

  it('refuses a location that does not exist', async () => {
    await expect(service.create({ name: 'X', kind: 'skin', location: join(dir, 'nope') })).rejects.toMatchObject({ code: 'invalid-location' });
  });

  it('persists the registry', async () => {
    const created = await service.create({ name: 'Persist', kind: 'stage', location: join(dir, 'Projects') });
    const reloaded = new ProjectService(join(dir, 'projects.json'), join(dir, 'Projects'));
    await reloaded.load();
    const home = await reloaded.home();
    expect(home.projects.map((p) => p.id)).toEqual([created.id]);
  });

  it('keeps only known tags and collections', async () => {
    const project = await service.create({ name: 'Tags', kind: 'skin', location: join(dir, 'Projects') });
    const tag = await service.upsertTag({ name: 'WIP', color: '#FF6B6B' });
    const collection = await service.upsertCollection({ name: 'Skins' });

    const updated = await service.update(project.id, {
      tags: [tag.id, tag.id, '00000000-0000-4000-8000-000000000000'],
      collection: collection.id,
      favorite: true,
    });
    expect(updated.tags).toEqual([tag.id]);
    expect(updated.collection).toBe(collection.id);
    expect(updated.favorite).toBe(true);
    expect(tag.color).toBe('#ff6b6b');

    await service.deleteTag(tag.id);
    await service.deleteCollection(collection.id);
    const [after] = (await service.home()).projects;
    expect(after?.tags).toEqual([]);
    expect(after?.collection).toBeNull();
  });

  it('marks a deleted folder as missing and refuses to open it', async () => {
    const project = await service.create({ name: 'Gone', kind: 'skin', location: join(dir, 'Projects') });
    await rm(project.path, { recursive: true });

    const [summary] = (await service.home()).projects;
    expect(summary?.missing).toBe(true);
    await expect(service.open(project.id)).rejects.toMatchObject({ code: 'missing' });
  });

  it('imports a plain folder and gives copies a new id', async () => {
    const original = await service.create({ name: 'Original', kind: 'skin', location: join(dir, 'Projects') });
    const copy = join(dir, 'copy');
    await cp(original.path, copy, { recursive: true });

    const imported = await service.importFolder(copy);
    expect(imported.id).not.toBe(original.id);
    expect(imported.name).toBe('Original');

    const again = await service.importFolder(copy);
    expect(again.id).toBe(imported.id);
    expect((await service.home()).projects).toHaveLength(2);
  });

  it('sets and removes a cover, refusing other file types', async () => {
    const project = await service.create({ name: 'Cover', kind: 'skin', location: join(dir, 'Projects') });
    const png = join(dir, 'cover.png');
    const txt = join(dir, 'cover.txt');
    await writeFile(png, 'fake');
    await writeFile(txt, 'fake');

    await expect(service.setCover(project.id, txt)).rejects.toMatchObject({ code: 'invalid-cover' });
    const withCover = await service.setCover(project.id, png);
    expect(withCover.cover).toMatch(new RegExp(`^tessera-cover://${project.id}/cover\\?v=\\d+$`));
    expect(await service.coverPath(project.id)).toBe(join(project.path, '.tessera', 'cover.png'));

    const without = await service.removeCover(project.id);
    expect(without.cover).toBeNull();
  });

  it('forgets a project without deleting its files', async () => {
    const project = await service.create({ name: 'Keep', kind: 'skin', location: join(dir, 'Projects') });
    await service.forget(project.id);
    expect((await service.home()).projects).toHaveLength(0);
    await expect(readFile(join(project.path, '.tessera', 'project.json'), 'utf8')).resolves.toContain(project.id);
  });
});
