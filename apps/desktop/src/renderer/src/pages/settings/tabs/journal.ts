import type { AuditEntry } from '@tessera/protocol';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import { installedPlugins } from '../../../plugins/loader';
import { button, note, select, segmented } from '../controls';
import type { SettingsTab, TabContext } from './types';

type Result = 'all' | 'allowed' | 'denied';

const filter: { plugin: string; result: Result; text: string } = { plugin: '', result: 'all', text: '' };
let current: { box: HTMLElement; count: HTMLElement } | null = null;
let timer = 0;
let listening = false;

async function refresh() {
  if (!current?.box.isConnected) return;
  const { box, count } = current;
  const { entries, total } = await window.tessera
    .invoke('audit:list', {
      ...(filter.plugin ? { pluginId: filter.plugin } : {}),
      ...(filter.result !== 'all' ? { allowed: filter.result === 'allowed' } : {}),
      ...(filter.text.trim() ? { text: filter.text.trim() } : {}),
      limit: 300,
    })
    .catch(() => ({ entries: [] as AuditEntry[], total: 0 }));
  if (!box.isConnected) return;
  const names = new Map(installedPlugins().map((p) => [p.manifest.id, p.manifest.name]));
  count.textContent = t('journal.count', { shown: entries.length, total });
  if (!entries.length) {
    const none = document.createElement('div');
    none.className = 'atrium-empty is-boxed';
    none.textContent = t('journal.empty');
    box.replaceChildren(none);
    return;
  }
  box.replaceChildren(
    ...entries.map((entry) => {
      const line = document.createElement('div');
      line.className = `tessera-set-journal-row${entry.allowed ? '' : ' is-denied'}`;
      line.innerHTML = `<i class="bi bi-${entry.allowed ? 'check-circle' : 'x-octagon'}"></i>`;
      const who = document.createElement('b');
      who.textContent = names.get(entry.pluginId) ?? entry.pluginId;
      const action = document.createElement('code');
      action.textContent = entry.action;
      const target = document.createElement('span');
      target.textContent = entry.target;
      target.title = entry.target;
      const time = document.createElement('small');
      time.textContent = new Date(entry.time).toLocaleString();
      line.append(who, action, target, time);
      return line;
    }),
  );
}

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(() => void refresh(), 150);
}

function listen() {
  if (listening) return;
  listening = true;
  window.tessera.on('audit:changed', schedule);
}

async function exportJournal(ctx: TabContext, format: 'json' | 'csv') {
  try {
    const file = await window.tessera.invoke('audit:export', { format });
    if (file) ctx.ui.toast('success', t('journal.exported', { file }));
  } catch (error) {
    ctx.ui.toast('error', errorMessage(error));
  }
}

async function clearJournal(ctx: TabContext) {
  const ok = await ctx.ui.atrium.modal.confirm({
    title: t('journal.clearTitle'),
    message: t('journal.clearMessage'),
    confirmText: t('journal.clear'),
    cancelText: t('dialog.cancel'),
    danger: true,
  });
  if (!ok) return;
  await window.tessera.invoke('audit:clear');
  await refresh();
}

export const journalTab: SettingsTab = {
  id: 'journal',
  icon: 'journal-text',
  label: 'settings.tab.journal',
  render(ctx) {
    listen();
    const bar = document.createElement('div');
    bar.className = 'tessera-set-journal-bar';

    const plugins = installedPlugins();
    const known = new Set(plugins.map((p) => p.manifest.id));
    const options = [{ value: '', label: t('journal.allPlugins') }, ...plugins.map((p) => ({ value: p.manifest.id, label: p.manifest.name }))];
    if (filter.plugin && !known.has(filter.plugin)) filter.plugin = '';

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'atrium-input';
    search.placeholder = t('journal.search');
    search.value = filter.text;
    search.addEventListener('input', () => {
      filter.text = search.value;
      schedule();
    });

    const count = document.createElement('small');
    count.className = 'tessera-set-journal-count';
    const box = document.createElement('div');
    box.className = 'tessera-set-journal is-page';
    current = { box, count };

    bar.append(
      select(ctx.ui, filter.plugin, options, (value) => {
        filter.plugin = value;
        void refresh();
      }),
      segmented(
        ctx.ui,
        filter.result,
        [
          { value: 'all', label: t('journal.all') },
          { value: 'allowed', label: t('journal.allowed') },
          { value: 'denied', label: t('journal.denied') },
        ],
        (value) => {
          filter.result = value === 'allowed' || value === 'denied' ? value : 'all';
          void refresh();
        },
      ),
      search,
    );

    const actions = document.createElement('div');
    actions.className = 'tessera-set-journal-actions';
    actions.append(
      button('JSON', 'filetype-json', () => void exportJournal(ctx, 'json')),
      button('CSV', 'filetype-csv', () => void exportJournal(ctx, 'csv')),
      button(t('journal.clear'), 'trash3', () => void clearJournal(ctx), 'danger'),
    );

    window.setTimeout(() => void refresh(), 0);
    return [note(t('journal.intro')), bar, count, box, actions];
  },
};
