import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { PluginIdSchema, PermissionSchema, PluginManifestSchema, type InstalledPlugin, type Permission, type PluginManifest } from '@tessera/protocol';
import { readJson, writeJson } from '../fs/json';

const MAX_MANIFEST_BYTES = 64 * 1024;

const RegistrySchema = z.object({
  formatVersion: z.literal(1),
  plugins: z.array(
    z.object({
      id: PluginIdSchema,
      path: z.string().min(1),
      enabled: z.boolean(),
      granted: z.array(PermissionSchema),
    }),
  ),
});
type Registry = z.infer<typeof RegistrySchema>;

export class PluginError extends Error {
  constructor(
    readonly code: 'not-found' | 'invalid-manifest' | 'missing-entry',
    message: string,
  ) {
    super(message);
  }
}

function inside(root: string, target: string) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function readManifest(folder: string): Promise<PluginManifest> {
  const root = await realpath(folder).catch(() => {
    throw new PluginError('invalid-manifest', 'Folder not found');
  });
  const file = join(root, 'manifest.json');
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > MAX_MANIFEST_BYTES) throw new PluginError('invalid-manifest', 'manifest.json missing or too large');

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new PluginError('invalid-manifest', 'manifest.json is not valid JSON');
  }
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PluginError('invalid-manifest', `${issue?.path.join('.') || 'manifest'}: ${issue?.message ?? 'invalid'}`);
  }

  for (const widget of parsed.data.contributes.widgets) {
    const entry = resolve(root, widget.entry);
    const real = await realpath(entry).catch(() => null);
    if (!real || !inside(root, real) || !(await stat(real)).isFile()) {
      throw new PluginError('missing-entry', `Widget "${widget.id}": ${widget.entry} not found`);
    }
  }
  return parsed.data;
}

export class PluginService {
  private registry: Registry = { formatVersion: 1, plugins: [] };
  private readonly manifests = new Map<string, PluginManifest>();

  constructor(private readonly registryFile: string) {}

  async load() {
    this.registry = (await readJson(this.registryFile, RegistrySchema)) ?? { formatVersion: 1, plugins: [] };
    this.manifests.clear();
    for (const entry of this.registry.plugins) {
      try {
        const manifest = await readManifest(entry.path);
        if (manifest.id === entry.id) this.manifests.set(entry.id, manifest);
      } catch (error) {
        console.warn(`[plugins] ${entry.id} skipped:`, (error as Error).message);
      }
    }
  }

  list(): InstalledPlugin[] {
    return this.registry.plugins.flatMap((entry) => {
      const manifest = this.manifests.get(entry.id);
      if (!manifest) return [];
      return [{ manifest, enabled: entry.enabled, granted: entry.granted.filter((p) => manifest.permissions.includes(p)), trust: 'local' as const, path: entry.path }];
    });
  }

  async installLocal(folder: string, granted: Permission[]): Promise<InstalledPlugin> {
    const manifest = await readManifest(folder);
    const path = await realpath(folder);
    const allowed = granted.filter((p) => manifest.permissions.includes(p));
    const existing = this.registry.plugins.find((p) => p.id === manifest.id);
    if (existing) Object.assign(existing, { path, granted: allowed, enabled: true });
    else this.registry.plugins.push({ id: manifest.id, path, enabled: true, granted: allowed });
    this.manifests.set(manifest.id, manifest);
    await this.save();
    return this.get(manifest.id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<InstalledPlugin> {
    this.entry(id).enabled = enabled;
    await this.save();
    return this.get(id);
  }

  async setGrants(id: string, granted: Permission[]): Promise<InstalledPlugin> {
    const manifest = this.manifests.get(id);
    this.entry(id).granted = granted.filter((p) => manifest?.permissions.includes(p));
    await this.save();
    return this.get(id);
  }

  async remove(id: string) {
    this.entry(id);
    this.registry.plugins = this.registry.plugins.filter((p) => p.id !== id);
    this.manifests.delete(id);
    await this.save();
  }

  get(id: string): InstalledPlugin {
    const plugin = this.list().find((p) => p.manifest.id === id);
    if (!plugin) throw new PluginError('not-found', 'Unknown plugin');
    return plugin;
  }

  async resolveFile(id: string, path: string): Promise<string | null> {
    const entry = this.registry.plugins.find((p) => p.id === id);
    if (!entry?.enabled || !this.manifests.has(id)) return null;
    const root = await realpath(entry.path).catch(() => null);
    if (!root) return null;
    const target = resolve(root, path);
    if (!inside(root, target)) return null;
    const real = await realpath(target).catch(() => null);
    if (!real || !inside(root, real)) return null;
    return (await stat(real)).isFile() ? real : null;
  }

  private entry(id: string) {
    const entry = this.registry.plugins.find((p) => p.id === id);
    if (!entry) throw new PluginError('not-found', 'Unknown plugin');
    return entry;
  }

  private save() {
    return writeJson(this.registryFile, this.registry);
  }
}
