import { isMessageKey, t } from '.';

export function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const code = /(?:project|account|history|plugin-settings|profile):[a-z-]+/.exec(text)?.[0];
  const key = code ? `error.${code}` : '';
  if (isMessageKey(key)) return t(key);
  console.error(error);
  return t('error.unknown');
}

export function relativeTime(iso: string | null): string {
  if (!iso) return t('projects.never');
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hours', { n: hours });
  const days = Math.round(hours / 24);
  if (days < 30) return t('time.days', { n: days });
  return new Date(iso).toLocaleDateString();
}
