import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MAX_TEXT_READ, type DirEntry } from '@tessera/protocol';
import { TESSERA_DIR } from './files';

const MAX_ENTRIES = 2000;

function inside(root: string, target: string) {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export async function listDir(projectRoot: string, path: string): Promise<DirEntry[]> {
  const root = await realpath(projectRoot);
  const target = resolve(root, path || '.');
  if (!inside(root, target)) throw new Error('outside project');
  const real = await realpath(target);
  if (!inside(root, real)) throw new Error('outside project');

  const entries = await readdir(real, { withFileTypes: true });
  const result: DirEntry[] = [];
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    if (entry.name === TESSERA_DIR || entry.isSymbolicLink()) continue;
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const full = join(real, entry.name);
    const size = entry.isFile() ? ((await stat(full).catch(() => null))?.size ?? 0) : 0;
    result.push({
      name: entry.name,
      path: relative(root, full).split(sep).join('/'),
      kind: entry.isDirectory() ? 'dir' : 'file',
      size,
    });
  }
  return result.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'dir' ? -1 : 1));
}

export async function readText(projectRoot: string, path: string): Promise<string> {
  const root = await realpath(projectRoot);
  const target = resolve(root, path);
  if (!inside(root, target)) throw new Error('outside project');
  const real = await realpath(target);
  if (!inside(root, real) || relative(root, real).split(sep)[0] === TESSERA_DIR) throw new Error('outside project');
  const info = await stat(real);
  if (!info.isFile() || info.size > MAX_TEXT_READ) throw new Error('file too large');
  return readFile(real, 'utf8');
}
