import type { ProjectSummary } from '@tessera/protocol';
import { describe, expect, it } from 'vitest';
import { applyQuery, sameFilter } from './filters';

const base: ProjectSummary = {
  id: '',
  name: '',
  path: '',
  kind: 'skin',
  status: 'draft',
  tags: [],
  collection: null,
  favorite: false,
  cover: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpened: null,
  missing: false,
};

const projects: ProjectSummary[] = [
  { ...base, id: 'a', name: 'Évolution Mario', tags: ['t1'], updatedAt: '2026-03-01T00:00:00.000Z' },
  { ...base, id: 'b', name: 'Dark Link', favorite: true, collection: 'c1', lastOpened: '2026-05-01T00:00:00.000Z' },
  { ...base, id: 'c', name: 'Clean HUD', updatedAt: '2026-04-01T00:00:00.000Z' },
];

const ids = (list: ProjectSummary[]) => list.map((p) => p.id);

describe('applyQuery', () => {
  it('searches without accents or case', () => {
    expect(ids(applyQuery(projects, { search: 'evolution', filter: { type: 'all' }, sort: 'name' }))).toEqual(['a']);
  });

  it('filters by favorites, tag and collection', () => {
    expect(ids(applyQuery(projects, { search: '', filter: { type: 'favorites' }, sort: 'name' }))).toEqual(['b']);
    expect(ids(applyQuery(projects, { search: '', filter: { type: 'tag', id: 't1' }, sort: 'name' }))).toEqual(['a']);
    expect(ids(applyQuery(projects, { search: '', filter: { type: 'collection', id: 'c1' }, sort: 'name' }))).toEqual(['b']);
  });

  it('sorts by name, last update and last opened', () => {
    expect(ids(applyQuery(projects, { search: '', filter: { type: 'all' }, sort: 'name' }))).toEqual(['c', 'b', 'a']);
    expect(ids(applyQuery(projects, { search: '', filter: { type: 'all' }, sort: 'updated' }))).toEqual(['c', 'a', 'b']);
    expect(ids(applyQuery(projects, { search: '', filter: { type: 'all' }, sort: 'recent' }))[0]).toBe('b');
  });
});

describe('sameFilter', () => {
  it('compares filters with ids', () => {
    expect(sameFilter({ type: 'tag', id: 'x' }, { type: 'tag', id: 'x' })).toBe(true);
    expect(sameFilter({ type: 'tag', id: 'x' }, { type: 'tag', id: 'y' })).toBe(false);
    expect(sameFilter({ type: 'all' }, { type: 'favorites' })).toBe(false);
  });
});
