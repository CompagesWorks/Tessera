import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import { formatSize, PACKAGE_EXTENSION, PACKAGE_INDEX, readBytes, sha256 } from '../files';
import { log } from '../log';
import { check } from './check';

const STORED = /\.(png|jpe?g|webp|gif|zip|wasm|woff2?)$/i;
const FIXED_TIME = new Date('2026-01-01T00:00:00Z');

export function pack(dir?: string, out?: string) {
  const { project, manifest, files } = check(dir);
  const entries: Zippable = {};
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const data = readBytes(project.plugin, file.path);
    hashes[file.path] = sha256(data);
    entries[file.path] = [data, { level: STORED.test(file.path) ? 0 : 9, mtime: FIXED_TIME }];
  }
  const index = { formatVersion: 1, id: manifest.id, version: manifest.version, files: hashes };
  entries[PACKAGE_INDEX] = [new TextEncoder().encode(`${JSON.stringify(index, null, 2)}\n`), { level: 9, mtime: FIXED_TIME }];
  const archive = zipSync(entries);
  const target = resolve(out ?? join(process.cwd(), `${manifest.id}-${manifest.version}.${PACKAGE_EXTENSION}`));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, archive);
  log.ok(`${target} ${log.dim(`(${formatSize(archive.length)})`)}`);
  return target;
}
