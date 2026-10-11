import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NoteNameSchema, type NoteInfo } from '@tessera/protocol';
import { TESSERA_DIR } from './files';

const EXT = '.md';

export const notesDir = (root: string) => join(root, TESSERA_DIR, 'notes');

function noteFile(root: string, name: string) {
  const parsed = NoteNameSchema.safeParse(name);
  if (!parsed.success) throw new Error('invalid note name');
  return join(notesDir(root), `${parsed.data}${EXT}`);
}

export async function listNotes(root: string): Promise<NoteInfo[]> {
  const entries = await readdir(notesDir(root), { withFileTypes: true }).catch(() => []);
  const notes: NoteInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(EXT)) continue;
    const name = entry.name.slice(0, -EXT.length);
    if (!NoteNameSchema.safeParse(name).success) continue;
    const info = await stat(join(notesDir(root), entry.name));
    notes.push({ name, updatedAt: info.mtime.toISOString(), size: info.size });
  }
  return notes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function readNote(root: string, name: string): Promise<string> {
  return readFile(noteFile(root, name), 'utf8').catch(() => '');
}

export async function writeNote(root: string, name: string, content: string) {
  const file = noteFile(root, name);
  await mkdir(notesDir(root), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

export async function createNote(root: string, name: string, content = ''): Promise<string> {
  const existing = new Set((await listNotes(root)).map((n) => n.name.toLowerCase()));
  let candidate = name.trim();
  for (let i = 2; existing.has(candidate.toLowerCase()); i++) candidate = `${name.trim()} ${i}`;
  await writeNote(root, candidate, content);
  return candidate;
}

export async function deleteNote(root: string, name: string) {
  await rm(noteFile(root, name), { force: true });
}
