import type { HomeData, Tag } from '@tessera/protocol';
import type { MenuEntry } from 'atrium-ui';
import type { AppContext } from '../../app/context';
import { required } from '../../components/dom';
import { projectCard } from '../../components/project-card/project-card';
import { applyTranslations, t } from '../../i18n';
import type { Page } from '../types';
import { createProjectActions, type ProjectActions } from './actions';
import { renderChips } from './chips';
import { applyQuery, type Query, type SortMode } from './filters';
import './projects.css';
import template from './projects.html?raw';

const PREFS_KEY = 'tessera.home';

function loadPrefs(): { layout: 'grid' | 'list'; sort: SortMode } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return {
      layout: saved.layout === 'list' ? 'list' : 'grid',
      sort: ['recent', 'updated', 'name'].includes(saved.sort) ? saved.sort : 'recent',
    };
  } catch {
    return { layout: 'grid', sort: 'recent' };
  }
}

function savePrefs(prefs: { layout: string; sort: string }) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

let projectActions: ProjectActions | null = null;
let relabel: (() => void) | null = null;

export function homeActions(): ProjectActions | null {
  return projectActions;
}

export const projectsPage: Page = {
  id: 'projects',
  icon: 'collection',
  label: 'nav.projects',
  template,
  mount(root, ctx: AppContext) {
    const { ui, store, navigation } = ctx;
    applyTranslations(root);
    const actions = createProjectActions(ctx);
    projectActions = actions;

    const grid = required<HTMLElement>(root, '[data-grid]');
    const chips = required<HTMLElement>(root, '[data-chips]');
    const empty = required<HTMLElement>(root, '[data-empty]');
    const search = required<HTMLInputElement>(root, '[data-search]');
    const prefs = loadPrefs();
    const query: Query = { search: '', filter: { type: 'all' }, sort: prefs.sort };
    let layout = prefs.layout;

    const bindMenu = (element: HTMLElement, entries: MenuEntry[] | (() => MenuEntry[])) => {
      element.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        ui.atrium.menu.open(event, typeof entries === 'function' ? entries() : entries);
      });
    };

    const newCard = () => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tessera-new-card';
      button.innerHTML = '<span><i class="bi bi-plus-circle"></i></span>';
      button.firstElementChild!.append(t('projects.newCard'));
      button.addEventListener('click', () => void actions.newProject());
      return button;
    };

    const render = (data: HomeData) => {
      if (query.filter.type === 'tag' && !store.tag((query.filter as { id: string }).id)) query.filter = { type: 'all' };
      if (query.filter.type === 'collection' && !store.collection((query.filter as { id: string }).id)) query.filter = { type: 'all' };

      renderChips(chips, {
        data,
        active: query.filter,
        actions,
        onSelect: (filter) => {
          query.filter = filter;
          render(store.current);
        },
        bindMenu,
      });

      const tags = new Map<string, Tag>(data.tags.map((tag) => [tag.id, tag]));
      const visible = applyQuery(data.projects, query);
      const cards = visible.map((project) => {
        const card = projectCard(project, tags, layout);
        card.addEventListener('click', () => {
          if (project.missing) ui.atrium.menu.openAt(card, actions.projectMenu(project));
          else void navigation.openProject(project.id);
        });
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !project.missing) void navigation.openProject(project.id);
        });
        bindMenu(card, () => actions.projectMenu(store.project(project.id) ?? project));
        return card;
      });

      const filtering = query.search.trim() !== '' || query.filter.type !== 'all';
      grid.classList.toggle('is-list', layout === 'list');
      grid.replaceChildren(...cards, ...(filtering ? [] : [newCard()]));

      const showEmpty = visible.length === 0 && filtering;
      empty.hidden = !showEmpty;
      grid.hidden = showEmpty;
      required<HTMLElement>(empty, '[data-empty-title]').textContent = t('projects.noMatchTitle');
      required<HTMLElement>(empty, '[data-empty-text]').textContent = t('projects.noMatchText');
    };

    ui.atrium.segmented(required(root, '[data-view]'), {
      value: layout,
      options: [
        { value: 'grid', icon: 'grid' },
        { value: 'list', icon: 'list-ul' },
      ],
      label: t('projects.view.grid'),
      onChange: (value) => {
        layout = value === 'list' ? 'list' : 'grid';
        savePrefs({ layout, sort: query.sort });
        render(store.current);
      },
    }).element.classList.add('is-icons');

    const sort = required<HTMLSelectElement>(root, '[data-sort]');
    sort.value = query.sort;
    const sortSelect = ui.atrium.select(sort, {
      onChange: (value) => {
        query.sort = value as SortMode;
        savePrefs({ layout, sort: query.sort });
        render(store.current);
      },
    });

    search.addEventListener('input', () => {
      query.search = search.value;
      render(store.current);
    });
    required(root, '[data-new]').addEventListener('click', () => void actions.newProject());
    required(root, '[data-import]').addEventListener('click', () => void actions.importProject());

    relabel = () => {
      applyTranslations(root);
      sortSelect.refresh();
      render(store.current);
    };

    store.subscribe(render);
    void store.refresh();
  },
  onLanguageChange() {
    relabel?.();
  },
};
