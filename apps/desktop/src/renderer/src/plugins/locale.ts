import type { InstalledPlugin } from '@tessera/protocol';
import { getLanguage } from '../i18n';

type Messages = Record<string, string>;

const KEY = /^%([A-Za-z0-9_.-]{1,80})%$/;

export function pluginMessages(locales: InstalledPlugin['locales']): Messages {
  return { ...locales['en'], ...locales[getLanguage()] };
}

function localize<T>(value: T, messages: Messages): T {
  if (typeof value === 'string') {
    const key = KEY.exec(value)?.[1];
    return (key === undefined ? value : (messages[key] ?? key)) as T;
  }
  if (Array.isArray(value)) return value.map((item) => localize(item, messages)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item, messages)])) as T;
  return value;
}

export function pluginText(plugin: InstalledPlugin, value: string): string {
  return localize(value, pluginMessages(plugin.locales));
}

export function localizePlugin(plugin: InstalledPlugin): InstalledPlugin {
  return { ...plugin, manifest: localize(plugin.manifest, pluginMessages(plugin.locales)) };
}
