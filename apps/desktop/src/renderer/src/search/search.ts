import type { SearchResult } from '@tessera/protocol';
import type { AppContext } from '../app/context';
import { fromTemplate, required } from '../components/dom';
import { t } from '../i18n';
import { errorMessage } from '../i18n/format';
import './search.css';
import template from './search.html?raw';

const DELAY = 180;
const MAX_PREVIEW_LINES = 1500;
const ICONS = { file: 'file-earmark-text', dir: 'folder2', note: 'journal-text' } as const;

function tokensOf(query: string) {
  return query.trim().split(/\s+/).filter(Boolean);
}

function highlight(target: HTMLElement, text: string, query: string) {
  const tokens = [query.trim(), ...tokensOf(query)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!tokens.length) {
    target.textContent = text;
    return;
  }
  const pattern = new RegExp(`(${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const nodes: Array<Node | string> = [];
  text.split(pattern).forEach((part, index) => {
    if (index % 2 === 1) {
      const mark = document.createElement('mark');
      mark.textContent = part;
      nodes.push(mark);
    } else if (part) nodes.push(part);
  });
  target.replaceChildren(...nodes);
}

export function openProjectSearch(ctx: AppContext, initialQuery = '') {
  const project = ctx.navigation.current;
  if (!project) return;
  const { ui } = ctx;
  const root = fromTemplate(template);
  const input = required<HTMLInputElement>(root, '[data-input]');
  const content = required<HTMLInputElement>(root, '[data-content]');
  const list = required<HTMLElement>(root, '[data-results]');
  const preview = required<HTMLElement>(root, '[data-preview]');
  const status = required<HTMLElement>(root, '[data-status]');

  let results: SearchResult[] = [];
  let active = -1;
  let ticket = 0;
  let timer = 0;

  const empty = (target: HTMLElement, text: string) => {
    const p = document.createElement('p');
    p.className = 'tessera-search-empty';
    p.textContent = text;
    target.replaceChildren(p);
  };
  empty(list, t('search.hint'));
  empty(preview, t('search.pickResult'));

  const current = () => (active >= 0 ? results[active] : undefined);

  async function showPreview() {
    const result = current();
    if (!result) return empty(preview, t('search.pickResult'));
    if (result.kind === 'dir') return empty(preview, t('search.folder'));
    const mine = ticket;
    let text: string;
    try {
      text =
        result.kind === 'note'
          ? await window.tessera.invoke('notes:read', { id: project!.id, name: result.name })
          : await window.tessera.invoke('files:read-text', { id: project!.id, path: result.path });
    } catch {
      if (mine === ticket && current() === result) empty(preview, t('search.noPreview'));
      return;
    }
    if (current() !== result) return;
    const query = input.value;
    const hits = new Set(result.matches.map((m) => m.line));
    const head = document.createElement('div');
    head.className = 'tessera-search-preview-head';
    head.textContent = result.path;
    const lines = text.split(/\r?\n/).slice(0, MAX_PREVIEW_LINES);
    const rows = lines.map((line, index) => {
      const row = document.createElement('div');
      row.className = `tessera-search-line${hits.has(index + 1) ? ' is-hit' : ''}`;
      const number = document.createElement('i');
      number.textContent = String(index + 1);
      const body = document.createElement('span');
      highlight(body, line || ' ', query);
      row.append(number, body);
      return row;
    });
    preview.replaceChildren(head, ...rows);
    const first = result.matches[0]?.line;
    if (first) rows[first - 1]?.scrollIntoView({ block: 'center' });
  }

  function select(index: number) {
    active = Math.max(-1, Math.min(index, results.length - 1));
    list.querySelectorAll('.tessera-search-item').forEach((item, i) => {
      item.classList.toggle('is-on', i === active);
      if (i === active) item.scrollIntoView({ block: 'nearest' });
    });
    void showPreview();
  }

  function renderResults() {
    if (!results.length) return empty(list, t('search.noResults'));
    const query = input.value;
    list.replaceChildren(
      ...results.map((result, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'tessera-search-item';
        item.setAttribute('role', 'option');
        item.innerHTML = `<i class="bi bi-${ICONS[result.kind]}"></i>`;
        const name = document.createElement('b');
        highlight(name, result.name, query);
        const path = document.createElement('small');
        path.textContent = result.path;
        item.append(name, path);
        const match = result.matches[0];
        if (match) {
          const snippet = document.createElement('span');
          highlight(snippet, `${match.line}: ${match.text}`, query);
          item.append(snippet);
        }
        item.addEventListener('click', () => select(index));
        item.addEventListener('dblclick', () => void reveal());
        return item;
      }),
    );
  }

  async function run() {
    const query = input.value.trim();
    const mine = ++ticket;
    if (!query) {
      results = [];
      active = -1;
      empty(list, t('search.hint'));
      empty(preview, t('search.pickResult'));
      status.textContent = '';
      return;
    }
    status.textContent = t('search.searching');
    try {
      const response = await window.tessera.invoke('search:project', { id: project!.id, query, content: content.checked, limit: 120 });
      if (mine !== ticket) return;
      results = response.results;
      renderResults();
      select(results.length ? 0 : -1);
      status.textContent = t(response.truncated ? 'search.statusMore' : 'search.status', { n: results.length, scanned: response.scanned });
    } catch (error) {
      if (mine === ticket) status.textContent = errorMessage(error);
    }
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void run(), DELAY);
  };

  async function reveal() {
    const result = current();
    if (result) await window.tessera.invoke('files:reveal', { id: project!.id, path: result.path }).catch((error) => ui.toast('error', errorMessage(error)));
  }

  async function copyPath() {
    const result = current();
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.path);
      ui.toast('success', t('search.copied'));
    } catch {
      ui.toast('error', t('error.unknown'));
    }
  }

  input.addEventListener('input', schedule);
  content.addEventListener('change', schedule);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      select(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      select(active - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void reveal();
    }
  });

  ui.atrium.modal.open({
    title: t('search.title', { name: project.name }),
    icon: 'search',
    body: root,
    size: 'large',
    className: 'tessera-search-modal',
    closeButton: true,
    buttons: [
      { text: t('search.copyPath'), variant: 'secondary', closeOnClick: false, onClick: () => void copyPath() },
      { text: t('search.reveal'), variant: 'primary', closeOnClick: false, onClick: () => void reveal() },
    ],
    onClose: () => {
      clearTimeout(timer);
      ticket++;
    },
  });
  if (initialQuery) {
    input.value = initialQuery;
    void run();
  }
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 50);
}
