import { t } from '../../../i18n';
import { button, group, pathBox, row, section, segmented, toggle } from '../controls';
import type { SettingsTab } from './types';

export const generalTab: SettingsTab = {
  id: 'general',
  icon: 'sliders',
  label: 'settings.tab.general',
  render({ ui, settings, update }) {
    const pickFolder = async () => {
      const folder = await window.tessera.invoke('projects:pick-location');
      if (folder) await update({ projectsFolder: folder });
    };
    return [
      group('translate', t('settings.group.language')),
      section(
        row(
          t('settings.language'),
          t('settings.languageHint'),
          segmented(
            ui,
            settings.language,
            [
              { value: 'fr', label: 'Français' },
              { value: 'en', label: 'English' },
            ],
            (value) => void update({ language: value === 'en' ? 'en' : 'fr' }),
          ),
        ),
      ),
      group('rocket-takeoff', t('settings.group.startup')),
      section(
        row(t('settings.reopenLast'), t('settings.reopenLastHint'), toggle(settings.reopenLastProject, (on) => void update({ reopenLastProject: on }))),
        row(t('settings.showSplash'), t('settings.showSplashHint'), toggle(settings.showSplash, (on) => void update({ showSplash: on }))),
        row(t('settings.splashDelay'), t('settings.splashDelayHint'), toggle(settings.splashDelay, (on) => void update({ splashDelay: on }))),
        row(
          t('settings.projectsFolder'),
          t('settings.projectsFolderHint'),
          pathBox(settings.projectsFolder ?? t('settings.projectsFolderDefault'), !settings.projectsFolder),
          button(t('settings.change'), 'folder2-open', () => void pickFolder()),
          ...(settings.projectsFolder ? [button(t('settings.default'), null, () => void update({ projectsFolder: null }))] : []),
        ),
      ),
    ];
  },
};
