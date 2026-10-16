import type { Settings } from '@tessera/protocol';
import { t } from '../i18n';
import { errorMessage } from '../i18n/format';
import type { AppContext } from './context';

const CHECK_EVERY = 60_000;

export function startAutoBackups(ctx: AppContext, settings: () => Settings) {
  let since = Date.now();
  let running = false;
  ctx.navigation.onChange(() => (since = Date.now()));

  window.setInterval(async () => {
    const interval = settings().backups.auto;
    const project = ctx.navigation.current;
    if (interval === 'off' || !project || running || ctx.info.safeMode) return;
    if (Date.now() - since < Number(interval) * 60_000) return;
    running = true;
    since = Date.now();
    try {
      const backup = await window.tessera.invoke('backups:create', { id: project.id, reason: 'auto' });
      if (backup) ctx.status.set(t('backups.autoCreated', { n: backup.number }));
    } catch (error) {
      ctx.ui.toast('error', t('backups.autoFailed', { error: errorMessage(error) }));
    } finally {
      running = false;
    }
  }, CHECK_EVERY);
}
