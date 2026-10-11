import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import type {
  Collection,
  CreateProjectRequest,
  HomeData,
  ProjectPatch,
  ProjectSummary,
  Tag,
} from '@tessera/protocol';
import { readJson, writeJson } from '../fs/json';
import {
  COVER_EXTENSIONS,
  MAX_COVER_BYTES,
  MetaFileSchema,
  ProjectFileSchema,
  RegistrySchema,
  SOURCES_DIR,
  coverFile,
  emptyRegistry,
  metaFile,
  projectFile,
  type MetaFile,
  type ProjectFile,
  type Registry,
  type RegistryEntry,
} from './files';
import { folderName, uniqueFolder } from './folder-name';

export class ProjectError extends Error {
  constructor(
    readonly code: 'not-found' | 'missing' | 'invalid-location' | 'invalid-cover' | 'not-a-folder',
    message: string,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

export class ProjectService {
  private registry: Registry = emptyRegistry();

  constructor(
    private readonly registryFile: string,
    readonly defaultLocation: string,
  ) {}

  async load() {
    this.registry = (await readJson(this.registryFile, RegistrySchema)) ?? emptyRegistry();
  }

  async home(): Promise<HomeData> {
    const projects = await Promise.all(this.registry.projects.map((entry) => this.summary(entry)));
    return {
      projects,
      tags: this.registry.tags,
      collections: this.registry.collections,
      defaultLocation: this.defaultLocation,
    };
  }

  async create(request: CreateProjectRequest): Promise<ProjectSummary> {
    const location = resolve(request.location);
    if (!isAbsolute(request.location)) throw new ProjectError('invalid-location', 'Location must be absolute');
    if (location === resolve(this.defaultLocation)) await mkdir(location, { recursive: true });
    if (!(await isDirectory(location))) throw new ProjectError('invalid-location', 'Location is not a folder');

    const root = await uniqueFolder(location, folderName(request.name));
    const project: ProjectFile = { formatVersion: 1, id: randomUUID(), name: request.name, game: 'ssbu', createdAt: now() };
    const meta: MetaFile = { formatVersion: 1, kind: request.kind, status: 'draft', tags: [], collection: null, favorite: false, updatedAt: now() };

    await mkdir(resolve(root, SOURCES_DIR), { recursive: true });
    await writeJson(projectFile(root), project);
    await writeJson(metaFile(root), meta);

    const entry: RegistryEntry = { id: project.id, path: root, name: project.name, lastOpened: null };
    this.registry.projects.push(entry);
    await this.save();
    return this.summary(entry);
  }

  async importFolder(folder: string): Promise<ProjectSummary> {
    const root = resolve(folder);
    if (!(await isDirectory(root))) throw new ProjectError('not-a-folder', 'Not a folder');

    const known = this.registry.projects.find((p) => samePath(p.path, root));
    if (known) return this.summary(known);

    let project = await readJson(projectFile(root), ProjectFileSchema);
    if (!project || this.registry.projects.some((p) => p.id === project!.id)) {
      project = {
        formatVersion: 1,
        id: randomUUID(),
        name: project?.name ?? basename(root),
        game: 'ssbu',
        createdAt: project?.createdAt ?? now(),
      };
      await writeJson(projectFile(root), project);
    }
    if (!(await readJson(metaFile(root), MetaFileSchema))) {
      await writeJson(metaFile(root), defaultMeta());
    }
    await mkdir(resolve(root, SOURCES_DIR), { recursive: true });

    const entry: RegistryEntry = { id: project.id, path: root, name: project.name, lastOpened: null };
    this.registry.projects.push(entry);
    await this.save();
    return this.summary(entry);
  }

  async open(id: string): Promise<ProjectSummary> {
    const entry = this.entry(id);
    if (!(await readJson(projectFile(entry.path), ProjectFileSchema))) {
      throw new ProjectError('missing', 'Project folder not found');
    }
    entry.lastOpened = now();
    await this.save();
    return this.summary(entry);
  }

  async update(id: string, patch: ProjectPatch): Promise<ProjectSummary> {
    const entry = this.entry(id);
    const { project, meta } = await this.readFiles(entry);

    if (patch.name !== undefined) {
      project.name = patch.name;
      entry.name = patch.name;
      await writeJson(projectFile(entry.path), project);
    }

    const tagIds = new Set(this.registry.tags.map((t) => t.id));
    const next: MetaFile = {
      ...meta,
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.favorite !== undefined && { favorite: patch.favorite }),
      ...(patch.tags !== undefined && { tags: [...new Set(patch.tags)].filter((t) => tagIds.has(t)) }),
      ...(patch.collection !== undefined && {
        collection: patch.collection && this.registry.collections.some((c) => c.id === patch.collection) ? patch.collection : null,
      }),
      updatedAt: now(),
    };
    await writeJson(metaFile(entry.path), next);
    await this.save();
    return this.summary(entry);
  }

  async setCover(id: string, source: string): Promise<ProjectSummary> {
    const entry = this.entry(id);
    await this.readFiles(entry);

    const ext = extname(source).slice(1).toLowerCase();
    if (!(COVER_EXTENSIONS as readonly string[]).includes(ext)) throw new ProjectError('invalid-cover', 'Unsupported image type');
    const info = await stat(source).catch(() => null);
    if (!info?.isFile() || info.size > MAX_COVER_BYTES) throw new ProjectError('invalid-cover', 'Image missing or too large');

    await this.clearCover(entry.path);
    await copyFile(source, coverFile(entry.path, ext));
    return this.touch(entry);
  }

  async removeCover(id: string): Promise<ProjectSummary> {
    const entry = this.entry(id);
    await this.clearCover(entry.path);
    return this.touch(entry);
  }

  async coverPath(id: string): Promise<string | null> {
    const entry = this.registry.projects.find((p) => p.id === id);
    if (!entry) return null;
    for (const ext of COVER_EXTENSIONS) {
      const file = coverFile(entry.path, ext);
      if ((await stat(file).catch(() => null))?.isFile()) return file;
    }
    return null;
  }

  async forget(id: string) {
    this.entry(id);
    this.registry.projects = this.registry.projects.filter((p) => p.id !== id);
    await this.save();
  }

  pathOf(id: string): string {
    return this.entry(id).path;
  }

  async rootOf(id: string): Promise<string> {
    const entry = this.entry(id);
    await this.readFiles(entry);
    return entry.path;
  }

  async upsertTag(input: Omit<Tag, 'id'> & { id?: string | undefined }): Promise<Tag> {
    const tag: Tag = { id: input.id ?? randomUUID(), name: input.name, color: input.color.toLowerCase() };
    upsert(this.registry.tags, tag);
    await this.save();
    return tag;
  }

  async deleteTag(id: string) {
    this.registry.tags = this.registry.tags.filter((t) => t.id !== id);
    await this.save();
  }

  async upsertCollection(input: Omit<Collection, 'id'> & { id?: string | undefined }): Promise<Collection> {
    const collection: Collection = { id: input.id ?? randomUUID(), name: input.name };
    upsert(this.registry.collections, collection);
    await this.save();
    return collection;
  }

  async deleteCollection(id: string) {
    this.registry.collections = this.registry.collections.filter((c) => c.id !== id);
    await this.save();
  }

  private entry(id: string): RegistryEntry {
    const entry = this.registry.projects.find((p) => p.id === id);
    if (!entry) throw new ProjectError('not-found', 'Unknown project');
    return entry;
  }

  private async readFiles(entry: RegistryEntry) {
    const project = await readJson(projectFile(entry.path), ProjectFileSchema);
    if (!project) throw new ProjectError('missing', 'Project folder not found');
    const meta = (await readJson(metaFile(entry.path), MetaFileSchema)) ?? defaultMeta();
    return { project, meta };
  }

  private async touch(entry: RegistryEntry): Promise<ProjectSummary> {
    const { meta } = await this.readFiles(entry);
    await writeJson(metaFile(entry.path), { ...meta, updatedAt: now() });
    return this.summary(entry);
  }

  private async clearCover(root: string) {
    await Promise.all(COVER_EXTENSIONS.map((ext) => rm(coverFile(root, ext), { force: true })));
  }

  private async summary(entry: RegistryEntry): Promise<ProjectSummary> {
    const project = await readJson(projectFile(entry.path), ProjectFileSchema);
    const meta = project ? ((await readJson(metaFile(entry.path), MetaFileSchema)) ?? defaultMeta()) : defaultMeta();
    const tagIds = new Set(this.registry.tags.map((t) => t.id));
    const cover = project ? await this.coverPath(entry.id) : null;
    const coverVersion = cover ? (await stat(cover)).mtimeMs : 0;

    return {
      id: entry.id,
      name: project?.name ?? entry.name,
      path: entry.path,
      kind: meta.kind,
      status: meta.status,
      tags: meta.tags.filter((t) => tagIds.has(t)),
      collection: meta.collection && this.registry.collections.some((c) => c.id === meta.collection) ? meta.collection : null,
      favorite: meta.favorite,
      cover: cover ? `tessera-cover://${entry.id}/cover?v=${Math.round(coverVersion)}` : null,
      createdAt: project?.createdAt ?? meta.updatedAt,
      updatedAt: meta.updatedAt,
      lastOpened: entry.lastOpened,
      missing: !project,
    };
  }

  private save() {
    return writeJson(this.registryFile, this.registry);
  }
}

function defaultMeta(): MetaFile {
  return { formatVersion: 1, kind: 'other', status: 'draft', tags: [], collection: null, favorite: false, updatedAt: now() };
}

function upsert<T extends { id: string }>(list: T[], item: T) {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = item;
}

async function isDirectory(path: string) {
  return (await stat(path).catch(() => null))?.isDirectory() ?? false;
}

function samePath(a: string, b: string) {
  const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}
