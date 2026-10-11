import logoUrl from '../assets/logo.svg';
import type { Page } from '../pages/types';
import mainHtml from './main.html?raw';
import statusbarHtml from './statusbar.html?raw';
import titlebarHtml from './titlebar.html?raw';
import './shell.css';

export interface Shell {
  sidebar: HTMLElement;
  stage: HTMLElement;
  statusbar: HTMLElement;
  panels: Map<string, HTMLElement>;
}

function fragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

export function logoImage(className: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = logoUrl;
  img.alt = '';
  img.className = className;
  return img;
}

export function mountShell(pages: Page[]): Shell {
  document.body.prepend(fragment(titlebarHtml), fragment(mainHtml), fragment(statusbarHtml));
  document.querySelector('[data-logo]')?.replaceWith(logoImage('atrium-titlebar-logo'));

  const sidebar = document.querySelector<HTMLElement>('[data-sidebar]')!;
  const stage = document.querySelector<HTMLElement>('[data-stage]')!;
  const statusbar = document.querySelector<HTMLElement>('.atrium-statusbar')!;
  const panels = new Map<string, HTMLElement>();

  for (const page of pages) {
    const button = document.createElement('button');
    button.className = 'atrium-sidebar-btn';
    button.dataset['atriumTab'] = page.id;
    button.dataset['i18nTooltip'] = page.label;
    button.innerHTML = `<i class="bi bi-${page.icon}"></i>`;
    sidebar.append(button);

    const panel = document.createElement('section');
    panel.className = 'tessera-page';
    panel.dataset['atriumPanel'] = page.id;
    panel.append(fragment(page.template));
    stage.append(panel);
    panels.set(page.id, panel);
  }

  return { sidebar, stage, statusbar, panels };
}
