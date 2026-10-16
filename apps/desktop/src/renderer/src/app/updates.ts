import type { UpdateInfo } from '@tessera/protocol';
import { t } from '../i18n';
import type { UiProvider } from '../ui/provider';

export function updateSummary(info: UpdateInfo): string {
  if (info.error) return t(`updates.error.${info.error}`);
  if (info.available && info.latest) return t('updates.available', { version: info.latest });
  if (!info.latest) return t('updates.none');
  return t('updates.upToDate', { version: info.current });
}

export async function checkUpdates(): Promise<UpdateInfo> {
  return window.tessera.invoke('updates:check');
}

export async function checkUpdatesQuietly(ui: UiProvider) {
  const info = await checkUpdates().catch(() => null);
  if (info?.available && info.latest) ui.toast('info', t('updates.toast', { version: info.latest }));
}

export function openRelease(info: UpdateInfo) {
  if (info.url) void window.tessera.invoke('app:open-external', { url: info.url });
}
