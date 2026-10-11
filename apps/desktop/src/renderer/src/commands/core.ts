import type { SettingsPatch } from '@tessera/protocol';
import type { Tabs } from 'atrium-ui';
import { showAbout } from '../about/about';
import type { AppContext } from '../app/context';
import { getLanguage, t } from '../i18n';
import { homeActions } from '../pages/projects';

const updateSettings = (patch: SettingsPatch) => window.tessera.invoke('settings:update', patch);

export function registerCoreCommands(ctx: AppContext, tabs: Tabs) {
  const { ui, info, navigation } = ctx;
  const { atrium } = ui;
  const goTo = t('commands.section.goTo');
  const app = t('commands.section.app');
  const project = t('commands.section.project');
  const layoutSection = t('commands.section.layout');
  const inProject = () => navigation.current !== null;
  const goHome = (page: string) => {
    navigation.closeProject();
    tabs.show(page);
  };

  ui.registerCommands([
    { id: 'go.projects', title: t('commands.projects'), icon: 'collection', section: goTo, run: () => goHome('projects') },
    { id: 'go.settings', title: t('commands.settings'), icon: 'gear', section: goTo, shortcut: 'Mod+,', run: () => goHome('settings') },
    {
      id: 'project.new',
      title: t('commands.newProject'),
      icon: 'plus-circle',
      section: project,
      shortcut: 'Mod+N',
      run: () => {
        goHome('projects');
        void homeActions()?.newProject();
      },
    },
    {
      id: 'project.import',
      title: t('commands.importProject'),
      icon: 'folder-plus',
      section: project,
      run: () => {
        goHome('projects');
        void homeActions()?.importProject();
      },
    },
    {
      id: 'project.reveal',
      title: t('commands.revealProject'),
      icon: 'folder2-open',
      section: project,
      when: inProject,
      run: () => {
        if (navigation.current) void window.tessera.invoke('projects:reveal', { id: navigation.current.id });
      },
    },
    { id: 'layout.edit', title: t('commands.editLayout'), icon: 'pencil-square', section: layoutSection, shortcut: 'Mod+L', when: inProject, run: () => navigation.workspace.toggleEditing() },
    { id: 'layout.newWorkspace', title: t('commands.newWorkspace'), icon: 'window-plus', section: layoutSection, when: inProject, run: () => navigation.workspace.newWorkspace() },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `layout.workspace${i + 1}`,
      title: t('commands.workspaceN', { n: i + 1 }),
      icon: 'window',
      section: layoutSection,
      shortcut: `Alt+${i + 1}`,
      when: () => inProject() && navigation.workspace.workspaces().length > i,
      run: () => {
        const target = navigation.workspace.workspaces()[i];
        if (target) navigation.workspace.switchTo(target.id);
      },
    })),
    { id: 'project.close', title: t('commands.closeProject'), icon: 'x-square', section: project, shortcut: 'Mod+W', when: inProject, run: () => navigation.closeProject() },
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
