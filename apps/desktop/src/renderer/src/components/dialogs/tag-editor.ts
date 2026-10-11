import type { Tag } from '@tessera/protocol';
import { t } from '../../i18n';
import type { UiProvider } from '../../ui/provider';
import { fromTemplate, required } from '../dom';
import './dialogs.css';
import template from './tag-editor.html?raw';

export const TAG_COLORS = ['#ff6b6b', '#ffb84d', '#ffd166', '#4ade80', '#2dd4bf', '#7a9bff', '#c77dff', '#ff6b9a', '#9ca3af'];

export function editTag(ui: UiProvider, tag?: Tag): Promise<{ name: string; color: string } | null> {
  return new Promise((resolve) => {
    const body = fromTemplate(template);
    const input = required<HTMLInputElement>(body, '[data-name]');
    const error = required<HTMLElement>(body, '[data-error]');
    const swatches = required<HTMLElement>(body, '[data-swatches]');
    let color = tag?.color ?? TAG_COLORS[0]!;
    let settled = false;
    input.value = tag?.name ?? '';

    for (const value of TAG_COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'tessera-swatch';
      swatch.style.background = value;
      swatch.classList.toggle('is-active', value === color);
      swatch.addEventListener('click', () => {
        color = value;
        swatches.querySelectorAll('.tessera-swatch').forEach((s) => s.classList.toggle('is-active', s === swatch));
      });
      swatches.append(swatch);
    }

    ui.atrium.modal.open({
      title: tag ? t('tagEditor.editTitle') : t('tagEditor.newTitle'),
      icon: 'tag',
      size: 'small',
      body,
      onClose: () => {
        if (!settled) resolve(null);
      },
      buttons: [
        { text: t('dialog.cancel'), variant: 'cancel' },
        {
          text: tag ? t('dialog.save') : t('dialog.create'),
          variant: 'primary',
          onClick: (_event, modal) => {
            const name = input.value.trim();
            if (!name || name.length > 32) {
              error.textContent = t('error.required');
              modal.shake();
              return false;
            }
            settled = true;
            resolve({ name, color });
            return true;
          },
        },
      ],
    });
    requestAnimationFrame(() => input.focus());
  });
}
