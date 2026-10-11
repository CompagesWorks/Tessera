import type { AppInfo } from '@tessera/protocol';
import { t } from '../i18n';
import { logoImage } from '../shell/shell';
import type { UiProvider } from '../ui/provider';
import './about.css';
import template from './about.html?raw';

const ATRIUM_URL = 'https://github.com/CompagesWorks/Atrium-UI';

export function showAbout(ui: UiProvider, info: AppInfo) {
  const holder = document.createElement('template');
  holder.innerHTML = template.trim();
  const body = holder.content.firstElementChild as HTMLElement;

  body.querySelector('[data-logo]')?.replaceWith(logoImage('tessera-about-logo'));
  body.querySelector('[data-version]')!.textContent = t('about.version', { version: info.version, electron: info.electron });

  const link = body.querySelector<HTMLButtonElement>('[data-atrium-link]')!;
  link.textContent = `${t('about.credit')} — github.com/CompagesWorks/Atrium-UI`;
  link.addEventListener('click', () => void window.tessera.invoke('app:open-external', { url: ATRIUM_URL }));

  ui.modal({ title: t('about.title'), icon: 'info-circle', body, closeText: t('about.close') });
}
