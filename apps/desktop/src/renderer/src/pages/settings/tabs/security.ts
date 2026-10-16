import { t } from '../../../i18n';
import { button, group, row, section, segmented } from '../controls';
import type { SettingsTab } from './types';

export const securityTab: SettingsTab = {
  id: 'security',
  icon: 'shield-lock',
  label: 'settings.tab.security',
  render(ctx) {
    const { ui, info, settings, update } = ctx;
    return [
      group('terminal', t('settings.group.programs')),
      section(
        row(
          t('settings.execPolicy'),
          t('settings.execPolicyHint'),
          segmented(
            ui,
            settings.execPolicy,
            [
              { value: 'ask', label: t('settings.execAsk') },
              { value: 'session', label: t('settings.execSession') },
            ],
            (value) => void update({ execPolicy: value === 'ask' ? 'ask' : 'session' }),
          ),
        ),
      ),
      group('journal-text', t('settings.group.journal')),
      section(
        row(t('settings.journal'), t('settings.journalHint'), button(t('settings.view'), 'eye', () => ctx.openTab('journal'))),
        row(
          t('settings.safeMode'),
          info.safeMode ? t('settings.safeModeOn') : t('settings.safeModeHint'),
          button(t('settings.safeModeRestart'), 'shield-exclamation', () => void window.tessera.invoke('app:restart', { safeMode: true, reason: 'flag' })),
        ),
      ),
    ];
  },
};
