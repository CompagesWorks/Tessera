import { ProjectKindSchema, ProjectNameSchema, type ProjectKind, type ProjectSummary } from '@tessera/protocol';
import '../../../components/dialogs/dialogs.css';
import { fromTemplate, required } from '../../../components/dom';
import { KIND_ICONS } from '../../../components/project-card/project-card';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import type { UiProvider } from '../../../ui/provider';
import template from './new-project.html?raw';

function previewFolder(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || '…'
  );
}

export function newProjectDialog(ui: UiProvider, defaultLocation: string): Promise<ProjectSummary | null> {
  return new Promise((resolve) => {
    const body = fromTemplate(template);
    const input = required<HTMLInputElement>(body, '[data-name]');
    const error = required<HTMLElement>(body, '[data-error]');
    const kinds = required<HTMLElement>(body, '[data-kind]');
    const locationEl = required<HTMLElement>(body, '[data-location]');
    const hint = required<HTMLElement>(body, '[data-hint]');
    let kind: ProjectKind = 'skin';
    let location = defaultLocation;
    let settled = false;

    const refresh = () => {
      locationEl.textContent = location;
      locationEl.title = location;
      hint.textContent = t('newProject.folderHint', { folder: `${location}${location.includes('\\') ? '\\' : '/'}${previewFolder(input.value)}` });
    };

    for (const value of ProjectKindSchema.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'atrium-chip-btn';
      button.classList.toggle('is-active', value === kind);
      button.innerHTML = `<i class="bi bi-${KIND_ICONS[value]}"></i>`;
      button.append(t(`kind.${value}`));
      button.addEventListener('click', () => {
        kind = value;
        kinds.querySelectorAll('.atrium-chip-btn').forEach((b) => b.classList.toggle('is-active', b === button));
      });
      kinds.append(button);
    }

    input.addEventListener('input', () => {
      error.textContent = '';
      refresh();
    });
    required<HTMLButtonElement>(body, '[data-change]').addEventListener('click', async () => {
      const picked = await window.tessera.invoke('projects:pick-location');
      if (picked) {
        location = picked;
        refresh();
      }
    });
    refresh();

    ui.atrium.modal.open({
      title: t('newProject.title'),
      icon: 'plus-circle',
      body,
      onClose: () => {
        if (!settled) resolve(null);
      },
      buttons: [
        { text: t('dialog.cancel'), variant: 'cancel' },
        {
          text: t('dialog.create'),
          variant: 'primary',
          onClick: async (_event, modal) => {
            const name = ProjectNameSchema.safeParse(input.value);
            if (!name.success) {
              error.textContent = t('error.name');
              modal.shake();
              return false;
            }
            try {
              const project = await window.tessera.invoke('projects:create', { name: name.data, kind, location });
              settled = true;
              resolve(project);
              return true;
            } catch (err) {
              error.textContent = errorMessage(err);
              modal.shake();
              return false;
            }
          },
        },
      ],
    });
    requestAnimationFrame(() => input.focus());
  });
}
