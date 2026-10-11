import type { UiProvider } from '../../ui/provider';
import './dialogs.css';

export interface Choice<T extends string> {
  value: T;
  label: string;
  icon?: string;
  color?: string;
}

export function choose<T extends string>(
  ui: UiProvider,
  options: { title: string; icon: string; choices: Choice<T>[]; value: T; cancelText: string },
): Promise<T | null> {
  return new Promise((resolve) => {
    const list = document.createElement('div');
    list.className = 'tessera-chip-list';
    let settled = false;

    const handle = ui.atrium.modal.open({
      title: options.title,
      icon: options.icon,
      body: list,
      buttons: [{ text: options.cancelText, variant: 'cancel' }],
      onClose: () => {
        if (!settled) resolve(null);
      },
    });

    for (const choice of options.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'atrium-chip-btn';
      button.classList.toggle('is-active', choice.value === options.value);
      if (choice.color) {
        const dot = document.createElement('span');
        dot.className = 'tessera-dot';
        dot.style.background = choice.color;
        button.append(dot);
      } else if (choice.icon) {
        const icon = document.createElement('i');
        icon.className = `bi bi-${choice.icon}`;
        button.append(icon);
      }
      button.append(choice.label);
      button.addEventListener('click', () => {
        settled = true;
        resolve(choice.value);
        void handle.close();
      });
      list.append(button);
    }
  });
}
