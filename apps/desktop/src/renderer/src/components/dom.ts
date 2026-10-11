import { applyTranslations } from '../i18n';

export function fromTemplate<T extends HTMLElement = HTMLElement>(html: string): T {
  const holder = document.createElement('template');
  holder.innerHTML = html.trim();
  const element = holder.content.firstElementChild as T;
  applyTranslations(element);
  return element;
}

export function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}
