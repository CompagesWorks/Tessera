import type { ProjectSummary } from '@tessera/protocol';

export type SortMode = 'recent' | 'updated' | 'name';

export type Filter = { type: 'all' } | { type: 'favorites' } | { type: 'tag'; id: string } | { type: 'collection'; id: string };

export interface Query {
  search: string;
  filter: Filter;
  sort: SortMode;
}

const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function matchesFilter(project: ProjectSummary, filter: Filter): boolean {
  switch (filter.type) {
    case 'all':
      return true;
    case 'favorites':
      return project.favorite;
    case 'tag':
      return project.tags.includes(filter.id);
    case 'collection':
      return project.collection === filter.id;
  }
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

const comparators: Record<SortMode, (a: ProjectSummary, b: ProjectSummary) => number> = {
  recent: (a, b) => time(b.lastOpened ?? b.createdAt) - time(a.lastOpened ?? a.createdAt),
  updated: (a, b) => time(b.updatedAt) - time(a.updatedAt),
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
};

export function applyQuery(projects: ProjectSummary[], query: Query): ProjectSummary[] {
  const needle = fold(query.search.trim());
  return projects
    .filter((p) => matchesFilter(p, query.filter) && (!needle || fold(p.name).includes(needle)))
    .sort(comparators[query.sort]);
}

export function sameFilter(a: Filter, b: Filter): boolean {
  if (a.type !== b.type) return false;
  return !('id' in a) || a.id === (b as { id: string }).id;
}
