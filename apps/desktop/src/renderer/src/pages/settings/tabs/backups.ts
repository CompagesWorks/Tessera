import { t } from '../../../i18n';
import { button, group, pathBox, row, section, segmented, select } from '../controls';
import type { SettingsTab } from './types';

const KEEP = [5, 10, 20, 50, 100, 0];

export const backupsTab: SettingsTab = {
  id: 'backups',
  icon: 'clock-history',
  label: 'settings.tab.backups',
  render({ ui, settings, update }) {
    const backups = settings.backups;
    const pickFolder = async () => {
      const folder = await window.tessera.invoke('projects:pick-location');
      if (folder) await update({ backups: { ...backups, folder } });
    };
    return [
      group('clock-history', t('settings.tab.backups')),
      section(
        row(
          t('settings.autoBackup'),
          t('settings.autoBackupHint'),
          segmented(
            ui,
            backups.auto,
            [
              { value: 'off', label: t('settings.off') },
              { value: '15', label: t('settings.minutes', { n: 15 }) },
              { value: '60', label: t('settings.hour') },
            ],
            (value) => void update({ backups: { ...backups, auto: value === '15' ? '15' : value === '60' ? '60' : 'off' } }),
          ),
        ),
        row(
          t('settings.keepBackups'),
          t('settings.keepBackupsHint'),
          select(
            ui,
            String(backups.keep),
            KEEP.map((n) => ({ value: String(n), label: n === 0 ? t('settings.keepAll') : t('settings.keepLast', { n }) })),
            (value) => void update({ backups: { ...backups, keep: Number(value) } }),
          ),
        ),
        row(
          t('settings.backupFolder'),
          t('settings.backupFolderHint'),
          pathBox(backups.folder ?? '.tessera/backups', !backups.folder),
          button(t('settings.change'), 'folder2-open', () => void pickFolder()),
          ...(backups.folder ? [button(t('settings.default'), null, () => void update({ backups: { ...backups, folder: null } }))] : []),
        ),
      ),
    ];
  },
};
