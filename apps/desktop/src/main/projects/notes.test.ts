import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNote, deleteNote, listNotes, readNote, writeNote } from './notes';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tessera-notes-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('notes', () => {
  it('stores each note as a readable markdown file', async () => {
    const name = await createNote(dir, 'Idées', '# Titre\n\n- normal map');
    expect(name).toBe('Idées');
    expect(await readFile(join(dir, '.tessera', 'notes', 'Idées.md'), 'utf8')).toBe('# Titre\n\n- normal map');
    expect(await readNote(dir, 'Idées')).toContain('normal map');
  });

  it('never overwrites an existing note on create', async () => {
    await createNote(dir, 'Todo');
    expect(await createNote(dir, 'todo')).toBe('todo 2');
    expect((await listNotes(dir)).map((n) => n.name)).toEqual(['Todo', 'todo 2']);
  });

  it('updates, deletes and lists in order', async () => {
    await writeNote(dir, 'b', 'x');
    await writeNote(dir, 'a', 'yy');
    expect((await listNotes(dir)).map((n) => [n.name, n.size])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    await deleteNote(dir, 'a');
    expect((await listNotes(dir)).map((n) => n.name)).toEqual(['b']);
  });

  it('refuses names that could leave the notes folder', async () => {
    await expect(writeNote(dir, '../escape', 'x')).rejects.toThrow('invalid note name');
    await expect(writeNote(dir, '..', 'x')).rejects.toThrow('invalid note name');
    await expect(readNote(dir, 'a/b')).rejects.toThrow('invalid note name');
  });

  it('returns an empty list when there are no notes', async () => {
    expect(await listNotes(dir)).toEqual([]);
  });
});
