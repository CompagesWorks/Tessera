import type { BackupInfo } from '@tessera/protocol';
import { fromTemplate, required } from '../../../components/dom';
import { t, type MessageKey } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import type { WidgetDefinition } from '../../types';
import './backups.css';
import template from './backups.html?raw';

const REASON: Record<BackupInfo['reason'], { icon: string; label: MessageKey }> = {
  manual: { icon: 'archive', label: 'widget.backups.manual' },
  auto: { icon: 'clock', label: 'widget.backups.auto' },
  restore: { icon: 'arrow-counterclockwise', label: 'widget.backups.beforeRestore' },
  export: { icon: 'box-arrow-up', label: 'widget.backups.beforeExport' },
};

function size(bytes: number) {
  if (bytes < 1024 * 1024) return t('widget.backups.kb', { n: Math.max(1, Math.round(bytes / 1024)) });
  return t('widget.backups.mb', { n: (bytes / 1024 / 1024).toFixed(1) });
}

function when(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t('widget.backups.justNow');
  if (minutes < 60) return t('widget.backups.minutesAgo', { n: minutes });
  if (minutes < 60 * 24) return t('widget.backups.hoursAgo', { n: Math.round(minutes / 60) });
  return new Date(iso).toLocaleString();
}

export const PROJECT_RESTORED = 'tessera:project-restored';

export const backupsWidget: WidgetDefinition = {
  type: 'core/backups',
  title: () => t('widget.backups.title'),
  description: () => t('widget.backups.description'),
  icon: 'clock-history',
  category: 'project',
  source: 'Tessera',
  trust: 'builtin',
  create({ project, ui }) {
    const element = fromTemplate(template);
    const list = required<HTMLElement>(element, '[data-list]');
    const note = required<HTMLInputElement>(element, '[data-note]');
    const create = required<HTMLButtonElement>(element, '[data-create]');
    let busy = false;

    const run = async (action: () => Promise<unknown>) => {
      if (busy) return;
      busy = true;
      element.classList.add('is-busy');
      try {
        await action();
      } catch (error) {
        ui.toast('error', errorMessage(error));
      } finally {
        busy = false;
        element.classList.remove('is-busy');
      }
    };

    const restore = async (backup: BackupInfo) => {
      const ok = await ui.atrium.modal.confirm({
        title: t('widget.backups.restoreTitle', { n: backup.number }),
        message: t('widget.backups.restoreMessage'),
        confirmText: t('widget.backups.restore'),
        cancelText: t('dialog.cancel'),
        danger: true,
      });
      if (!ok) return;
      await run(async () => {
        const safety = await window.tessera.invoke('backups:restore', { id: project.id, backup: backup.id });
        ui.toast('success', t('widget.backups.restored', { n: backup.number, safety: safety.number }));
        window.dispatchEvent(new CustomEvent(PROJECT_RESTORED, { detail: project.id }));
      });
    };

    const remove = async (backup: BackupInfo) => {
      const ok = await ui.atrium.modal.confirm({
        title: t('widget.backups.deleteTitle', { n: backup.number }),
        message: t('widget.backups.deleteMessage'),
        confirmText: t('widget.backups.delete'),
        cancelText: t('dialog.cancel'),
        danger: true,
      });
      if (ok) await run(() => window.tessera.invoke('backups:delete', { id: project.id, backup: backup.id }));
    };

    function item(backup: BackupInfo) {
      const row = document.createElement('div');
      row.className = 'tessera-backups-item';
      const reason = REASON[backup.reason];
      row.innerHTML = `<i class="bi bi-${reason.icon}"></i>`;
      const text = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = `#${backup.number}${backup.note && backup.reason !== 'restore' ? ` · ${backup.note}` : ''}`;
      const meta = document.createElement('small');
      meta.textContent = `${when(backup.createdAt)} · ${t(reason.label, { n: backup.note.replace('#', '') })} · ${t('widget.backups.files', { n: backup.files })} · ${size(backup.size)}`;
      meta.title = new Date(backup.createdAt).toLocaleString();
      text.append(title, meta);
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'atrium-icon-btn-sm';
      more.innerHTML = '<i class="bi bi-three-dots"></i>';
      more.setAttribute('aria-label', t('widget.backups.actions'));
      more.addEventListener('click', (event) =>
        ui.atrium.menu.open(event, [
          { label: t('widget.backups.restore'), icon: 'arrow-counterclockwise', onClick: () => void restore(backup) },
          {
            label: t('widget.backups.extract'),
            icon: 'box-arrow-up-right',
            onClick: () => void run(() => window.tessera.invoke('backups:extract', { id: project.id, backup: backup.id })),
          },
          { label: t('widget.backups.reveal'), icon: 'folder2-open', onClick: () => void window.tessera.invoke('backups:reveal', { id: project.id, backup: backup.id }) },
          'separator',
          { label: t('widget.backups.delete'), icon: 'trash3', danger: true, onClick: () => void remove(backup) },
        ]),
      );
      row.append(text, more);
      return row;
    }

    const refresh = async () => {
      try {
        const backups = await window.tessera.invoke('backups:list', { id: project.id });
        if (backups.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'atrium-empty';
          empty.innerHTML = '<i class="bi bi-clock-history"></i>';
          const p = document.createElement('p');
          p.textContent = t('widget.backups.empty');
          empty.append(p);
          list.replaceChildren(empty);
        } else list.replaceChildren(...backups.map(item));
      } catch (error) {
        list.textContent = errorMessage(error);
      }
    };

    create.addEventListener('click', () =>
      void run(async () => {
        const backup = await window.tessera.invoke('backups:create', { id: project.id, reason: 'manual', note: note.value.trim() });
        note.value = '';
        if (backup) ui.toast('success', t('backups.created', { n: backup.number }));
      }),
    );
    note.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') create.click();
    });

    const off = window.tessera.on('backups:changed', ({ projectId }) => {
      if (projectId === project.id) void refresh();
    });
    const timer = window.setInterval(() => void refresh(), 60_000);
    void refresh();
    return {
      element,
      dispose: () => {
        off();
        clearInterval(timer);
      },
    };
  },
};
