import type { HistoryItem } from '@tessera/protocol';
import { t, type MessageKey } from '../i18n';
import { errorMessage, relativeTime } from '../i18n/format';
import type { UiProvider } from '../ui/provider';
import './history.css';

export const HISTORY_APPLIED = 'tessera:history-applied';

export function historyLabel(item: HistoryItem): string {
  const text = t(`history.kind.${item.kind}` as MessageKey, { target: item.target });
  return item.source ? `${text} · ${item.source}` : text;
}

async function apply(ui: UiProvider, projectId: string, direction: 'undo' | 'redo') {
  try {
    const item = await window.tessera.invoke(direction === 'undo' ? 'history:undo' : 'history:redo', { id: projectId });
    if (!item) {
      ui.toast('info', t(direction === 'undo' ? 'history.nothingToUndo' : 'history.nothingToRedo'));
      return;
    }
    window.dispatchEvent(new CustomEvent(HISTORY_APPLIED, { detail: projectId }));
    ui.toast('success', t(direction === 'undo' ? 'history.undone' : 'history.redone', { label: historyLabel(item) }));
  } catch (error) {
    ui.toast('warning', errorMessage(error));
  }
}

export const undoLast = (ui: UiProvider, projectId: string) => apply(ui, projectId, 'undo');
export const redoLast = (ui: UiProvider, projectId: string) => apply(ui, projectId, 'redo');

function list(items: HistoryItem[], empty: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'tessera-history-list';
  if (!items.length) {
    const none = document.createElement('p');
    none.className = 'tessera-history-empty';
    none.textContent = empty;
    box.append(none);
    return box;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'tessera-history-row';
    const label = document.createElement('span');
    label.textContent = historyLabel(item);
    const time = document.createElement('small');
    time.textContent = relativeTime(item.time);
    row.append(label, time);
    box.append(row);
  }
  return box;
}

export async function openHistory(ui: UiProvider, projectId: string) {
  const state = await window.tessera.invoke('history:state', { id: projectId });
  const body = document.createElement('div');
  body.className = 'tessera-history';
  const head = (key: MessageKey) => {
    const h = document.createElement('h4');
    h.textContent = t(key);
    return h;
  };
  const note = document.createElement('p');
  note.className = 'tessera-history-note';
  note.textContent = t('history.note');
  body.append(head('history.undoList'), list(state.undo, t('history.empty')), head('history.redoList'), list(state.redo, t('history.empty')), note);
  const modal = ui.atrium.modal.open({
    title: t('history.title'),
    icon: 'arrow-counterclockwise',
    body,
    buttons: [
      {
        text: t('history.undo'),
        variant: 'secondary',
        closeOnClick: false,
        onClick: async () => {
          await undoLast(ui, projectId);
          await modal.close();
        },
      },
      {
        text: t('history.redo'),
        variant: 'secondary',
        closeOnClick: false,
        onClick: async () => {
          await redoLast(ui, projectId);
          await modal.close();
        },
      },
      { text: t('about.close'), variant: 'primary' },
    ],
  });
}
