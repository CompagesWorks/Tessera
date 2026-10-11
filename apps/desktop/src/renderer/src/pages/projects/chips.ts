import type { HomeData } from '@tessera/protocol';
import type { MenuEntry } from 'atrium-ui';
import { t } from '../../i18n';
import type { ProjectActions } from './actions';
import { sameFilter, type Filter } from './filters';

interface ChipOptions {
  data: HomeData;
  active: Filter;
  actions: ProjectActions;
  onSelect(filter: Filter): void;
  bindMenu(element: HTMLElement, entries: MenuEntry[]): void;
}

function chip(label: string, filter: Filter, options: ChipOptions, extra?: { icon?: string; color?: string; count?: number }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'atrium-chip-btn';
  button.classList.toggle('is-active', sameFilter(filter, options.active));
  if (extra?.color) {
    const dot = document.createElement('span');
    dot.className = 'tessera-dot';
    dot.style.background = extra.color;
    button.append(dot);
  } else if (extra?.icon) {
    const icon = document.createElement('i');
    icon.className = `bi bi-${extra.icon}`;
    button.append(icon);
  }
  button.append(label);
  if (extra?.count !== undefined) {
    const count = document.createElement('span');
    count.className = 'tessera-chip-count';
    count.textContent = String(extra.count);
    button.append(count);
  }
  button.addEventListener('click', () => options.onSelect(filter));
  return button;
}

function addButton(label: string, onClick: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'atrium-chip-btn tessera-chip-add';
  button.innerHTML = '<i class="bi bi-plus-lg"></i>';
  button.append(label);
  button.addEventListener('click', onClick);
  return button;
}

const separator = () => {
  const sep = document.createElement('span');
  sep.className = 'tessera-chip-sep';
  return sep;
};

export function renderChips(container: HTMLElement, options: ChipOptions) {
  const { data, actions } = options;
  const count = (predicate: (p: HomeData['projects'][number]) => boolean) => data.projects.filter(predicate).length;
  const items: HTMLElement[] = [
    chip(t('projects.filter.all'), { type: 'all' }, options, { count: data.projects.length }),
    chip(t('projects.filter.favorites'), { type: 'favorites' }, options, { icon: 'star-fill', count: count((p) => p.favorite) }),
    separator(),
  ];

  for (const collection of data.collections) {
    const button = chip(collection.name, { type: 'collection', id: collection.id }, options, {
      icon: 'folder2',
      count: count((p) => p.collection === collection.id),
    });
    options.bindMenu(button, actions.collectionMenu(collection));
    items.push(button);
  }
  items.push(addButton(t('projects.filter.newCollection'), () => void actions.createCollection()), separator());

  for (const tag of data.tags) {
    const button = chip(tag.name, { type: 'tag', id: tag.id }, options, { color: tag.color, count: count((p) => p.tags.includes(tag.id)) });
    options.bindMenu(button, actions.tagMenu(tag));
    items.push(button);
  }
  items.push(addButton(t('projects.filter.newTag'), () => void actions.createTag()));

  container.replaceChildren(...items);
}
