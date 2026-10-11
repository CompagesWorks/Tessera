import type { AppInfo, SettingsPatch } from '@tessera/protocol';
import type { Atrium, Tabs } from 'atrium-ui';
import { showAbout } from '../about/about';
import { getLanguage, t } from '../i18n';
import type { UiProvider } from '../ui/provider';

interface CoreCommandsContext {
  ui: UiProvider;
  atrium: Atrium;
  tabs: Tabs;
  info: AppInfo;
}

const updateSettings = (patch: SettingsPatch) => window.tessera.invoke('settings:update', patch);

export function registerCoreCommands({ ui, atrium, tabs, info }: CoreCommandsContext) {
  const goTo = t('commands.section.goTo');
  const app = t('commands.section.app');

  ui.registerCommands([
    { id: 'go.projects', title: t('commands.projects'), icon: 'collection', section: goTo, run: () => tabs.show('projects') },
    { id: 'go.settings', title: t('commands.settings'), icon: 'gear', section: goTo, shortcut: 'Mod+,', run: () => tabs.show('settings') },
    {
      id: 'app.theme',
      title: t('commands.toggleTheme'),
      icon: 'circle-half',
      section: app,
      keywords: ['dark', 'light', 'theme'],
      run: () => void updateSettings({ theme: atrium.theme === 'dark' ? 'light' : 'dark' }),
    },
    {
      id: 'app.language',
      title: t('commands.language'),
      icon: 'translate',
      section: app,
      keywords: ['langue', 'language'],
      run: () => void updateSettings({ language: getLanguage() === 'fr' ? 'en' : 'fr' }),
    },
    { id: 'app.about', title: t('commands.about'), icon: 'info-circle', section: app, keywords: ['atrium', 'credits'], run: () => showAbout(ui, info) },
  ]);
}
