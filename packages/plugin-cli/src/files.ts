import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CliError } from './log';

export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
export const MAX_PACKAGE_FILES = 2000;
export const PACKAGE_EXTENSION = 'tessera-plugin';
export const PACKAGE_INDEX = 'tessera-package.json';

const SKIPPED_DIRS = new Set(['node_modules', 'target', '.git', '.svn', '.idea', '.vscode']);
const SKIPPED_FILES = new Set([PACKAGE_INDEX, '.DS_Store', 'Thumbs.db', 'desktop.ini']);

export interface PackageFile {
  path: string;
  size: number;
}

export function listFiles(root: string): PackageFile[] {
  const files: PackageFile[] = [];
  let total = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full).split(sep).join('/');
      const info = lstatSync(full);
      if (info.isSymbolicLink()) throw new CliError(`links are not allowed in a plugin: ${rel}`);
      if (info.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!info.isFile() || SKIPPED_FILES.has(entry.name) || entry.name.endsWith(`.${PACKAGE_EXTENSION}`)) continue;
      total += info.size;
      files.push({ path: rel, size: info.size });
      if (files.length > MAX_PACKAGE_FILES) throw new CliError(`too many files (max ${MAX_PACKAGE_FILES})`);
      if (total > MAX_PACKAGE_BYTES) throw new CliError(`plugin too large (max ${MAX_PACKAGE_BYTES / 1024 / 1024} MB)`);
    }
  };
  walk(root);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function readBytes(root: string, path: string): Uint8Array {
  return readFileSync(join(root, ...path.split('/')));
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
