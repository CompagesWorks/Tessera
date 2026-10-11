import type { Language } from '@tessera/protocol';
import { en } from './en';
import { fr } from './fr';

export type MessageKey = keyof typeof fr;
type Params = Record<string, string | number>;

const dictionaries: Record<Language, Record<MessageKey, string>> = { fr, en };
let language: Language = 'fr';

export function setLanguage(next: Language) {
  language = next;
  document.documentElement.lang = next;
  applyTranslations();
}

export function getLanguage(): Language {
  return language;
}

export function isMessageKey(key: string): key is MessageKey {
  return key in fr;
}

export function t(key: MessageKey, params: Params = {}): string {
  let text = dictionaries[language][key] ?? fr[key];
  for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{{${name}}}`, String(value));
  return text;
}

export function applyTranslations(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset['i18n'];
    if (key && isMessageKey(key)) el.textContent = t(key);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.dataset['i18nPlaceholder'];
    if (key && isMessageKey(key)) el.placeholder = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-label]').forEach((el) => {
    const key = el.dataset['i18nLabel'];
    if (key && isMessageKey(key)) el.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-tooltip]').forEach((el) => {
    const key = el.dataset['i18nTooltip'];
    if (key && isMessageKey(key)) {
      el.dataset['atriumTooltip'] = t(key);
      el.dataset['atriumTooltipPosition'] = 'right';
    }
  });
}
