import type { Workspace } from '@tessera/protocol';
import '../../../components/dialogs/dialogs.css';
import { fromTemplate, required } from '../../../components/dom';
import { t } from '../../../i18n';
import type { UiProvider } from '../../../ui/provider';
import './workspace-dialog.css';
import template from './workspace-dialog.html?raw';

export const WORKSPACE_ICONS = [
  'grid-1x2', 'palette2', 'brush', 'music-note-beamed', 'film', 'map', 'window', 'stars',
  'box', 'person-bounding-box', 'controller', 'joystick', 'image', 'translate', 'code-slash', 'bug',
  'rocket-takeoff', 'people', 'lightning', 'camera-reels', 'sliders', 'tools', 'heart', 'flag',
];

export interface WorkspaceDialogResult {
  name: string;
  icon: string;
  copy: boolean;
}

export function workspaceDialog(ui: UiProvider, existing?: Workspace): Promise<WorkspaceDialogResult | null> {
  return new Promise((resolve) => {
    const body = fromTemplate(template);
    const input = required<HTMLInputElement>(body, '[data-name]');
    const error = required<HTMLElement>(body, '[data-error]');
    const icons = required<HTMLElement>(body, '[data-icons]');
    const start = required<HTMLElement>(body, '[data-start]');
    let icon = existing?.icon ?? 'palette2';
    let copy = false;
    let settled = false;
    input.value = existing?.name ?? '';
    input.placeholder = t('workspace.namePlaceholder');

    for (const name of WORKSPACE_ICONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `<i class="bi bi-${name}"></i>`;
      button.classList.toggle('is-active', name === icon);
      button.addEventListener('click', () => {
        icon = name;
        icons.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === button));
      });
      icons.append(button);
    }

    if (existing) {
      required(body, '[data-start-field]').remove();
    } else {
      for (const [value, label, iconName] of [
        [false, t('workspace.startEmpty'), 'square'],
        [true, t('workspace.startCopy'), 'copy'],
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'atrium-chip-btn';
        button.classList.toggle('is-active', value === copy);
        button.innerHTML = `<i class="bi bi-${iconName}"></i>`;
        button.append(label);
        button.addEventListener('click', () => {
          copy = value;
          start.querySelectorAll('.atrium-chip-btn').forEach((b) => b.classList.toggle('is-active', b === button));
        });
        start.append(button);
      }
    }

    ui.atrium.modal.open({
      title: existing ? t('workspace.editTitle') : t('workspace.newTitle'),
      icon: existing ? 'pencil' : 'window-plus',
      body,
      onClose: () => {
        if (!settled) resolve(null);
      },
      buttons: [
        { text: t('dialog.cancel'), variant: 'cancel' },
        {
          text: existing ? t('dialog.save') : t('dialog.create'),
          variant: 'primary',
          onClick: (_event, modal) => {
            const name = input.value.trim();
            if (!name) {
              error.textContent = t('error.required');
              modal.shake();
              return false;
            }
            settled = true;
            resolve({ name, icon, copy });
            return true;
          },
        },
      ],
    });
    requestAnimationFrame(() => input.focus());
  });
}
