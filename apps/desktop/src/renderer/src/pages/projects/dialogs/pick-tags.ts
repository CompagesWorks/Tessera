import type { Tag } from '@tessera/protocol';
import '../../../components/dialogs/dialogs.css';
import { t } from '../../../i18n';
import type { UiProvider } from '../../../ui/provider';

export function pickTags(ui: UiProvider, tags: Tag[], selected: string[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    const chosen = new Set(selected);
    let settled = false;
    const body = document.createElement('div');

    if (tags.length === 0) {
      body.className = 'atrium-empty is-boxed';
      body.textContent = t('tags.empty');
    } else {
      body.className = 'tessera-chip-list';
      for (const tag of tags) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'atrium-chip-btn';
        button.classList.toggle('is-active', chosen.has(tag.id));
        const dot = document.createElement('span');
        dot.className = 'tessera-dot';
        dot.style.background = tag.color;
        button.append(dot, tag.name);
        button.addEventListener('click', () => {
          if (chosen.has(tag.id)) chosen.delete(tag.id);
          else chosen.add(tag.id);
          button.classList.toggle('is-active', chosen.has(tag.id));
        });
        body.append(button);
      }
    }

    ui.atrium.modal.open({
      title: t('tags.title'),
      icon: 'tags',
      body,
      onClose: () => {
        if (!settled) resolve(null);
      },
      buttons: [
        { text: t('dialog.cancel'), variant: 'cancel' },
        {
          text: t('dialog.save'),
          variant: 'primary',
          onClick: () => {
            settled = true;
            resolve(tags.filter((tag) => chosen.has(tag.id)).map((tag) => tag.id));
          },
        },
      ],
    });
  });
}
