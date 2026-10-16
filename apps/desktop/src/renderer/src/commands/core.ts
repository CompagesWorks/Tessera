import type { SettingsPatch } from '@tessera/protocol';
import type { Command, Tabs } from 'atrium-ui';
import { resolveTheme } from '../app/appearance';
import { exportProject } from '../app/export';
import type { AppContext } from '../app/context';
import { openHistory, redoLast, undoLast } from '../app/history';
import { checkUpdates, updateSummary } from '../app/updates';
import { getLanguage, t } from '../i18n';
import { errorMessage } from '../i18n/format';
import { homeActions } from '../pages/projects';
import { openSettingsTab } from '../pages/settings';
import { labEnabled } from '../plugins/bridge';
import { openPluginLab } from '../plugins/lab/lab';
import { loadPlugins } from '../plugins/loader';
import { openProjectSearch } from '../search/search';

const updateSettings = (patch: SettingsPatch) => window.tessera.invoke('settings:update', patch);

export interface CommandInfo {
  id: string;
  title: string;
  icon: string;
  section: string;
  shortcut: string | undefined;
}

let catalog: CommandInfo[] = [];

export function commandCatalog(): CommandInfo[] {
  return catalog;
}

export function registerCoreCommands(ctx: AppContext, tabs: Tabs, shortcuts: Record<string, string | null>) {
  const { ui, navigation } = ctx;
  const goTo = t('commands.section.goTo');
  const app = t('commands.section.app');
  const project = t('commands.section.project');
  const layoutSection = t('commands.section.layout');
  const inProject = () => navigation.current !== null;
  const goHome = (page: string) => {
    navigation.closeProject();
    tabs.show(page);
  };

  const commands: Command[] = [
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
      run: async () => {
        const current = await window.tessera.invoke('settings:get');
        await updateSettings({ theme: resolveTheme(current.theme) === 'dark' ? 'light' : 'dark' });
      },
    },
    {
      id: 'app.language',
      title: t('commands.language'),
      icon: 'translate',
      section: app,
      keywords: ['langue', 'language'],
      run: () => void updateSettings({ language: getLanguage() === 'fr' ? 'en' : 'fr' }),
    },
    {
      id: 'project.backup',
      title: t('commands.backup'),
      icon: 'archive',
      section: project,
      shortcut: 'Mod+Shift+S',
      when: inProject,
      run: async () => {
        const current = navigation.current;
        if (!current) return;
        try {
          const backup = await window.tessera.invoke('backups:create', { id: current.id, reason: 'manual' });
          if (backup) ui.toast('success', t('backups.created', { n: backup.number }));
        } catch (error) {
          ui.toast('error', errorMessage(error));
        }
      },
    },
    { id: 'project.export', title: t('commands.export'), icon: 'box-arrow-up', section: project, shortcut: 'Mod+E', when: inProject, run: () => void exportProject(ctx) },
    {
      id: 'project.search',
      title: t('commands.search'),
      icon: 'search',
      section: project,
      shortcut: 'Mod+Shift+F',
      keywords: ['find', 'chercher', 'recherche', 'fichier', 'file'],
      when: inProject,
      run: () => openProjectSearch(ctx),
    },
    {
      id: 'edit.undo',
      title: t('commands.undo'),
      icon: 'arrow-counterclockwise',
      section: project,
      shortcut: 'Mod+Alt+Z',
      keywords: ['annuler', 'undo'],
      when: inProject,
      run: () => (navigation.current ? undoLast(ui, navigation.current.id) : undefined),
    },
    {
      id: 'edit.redo',
      title: t('commands.redo'),
      icon: 'arrow-clockwise',
      section: project,
      shortcut: 'Mod+Alt+Y',
      keywords: ['refaire', 'redo'],
      when: inProject,
      run: () => (navigation.current ? redoLast(ui, navigation.current.id) : undefined),
    },
    {
      id: 'edit.history',
      title: t('commands.history'),
      icon: 'clock-history',
      section: project,
      keywords: ['historique', 'history', 'undo'],
      when: inProject,
      run: () => (navigation.current ? openHistory(ui, navigation.current.id) : undefined),
    },
    {
      id: 'app.pluginLab',
      title: t('commands.pluginLab'),
      icon: 'bug',
      section: app,
      keywords: ['developer', 'dev', 'console', 'test'],
      when: labEnabled,
      run: () => openPluginLab(ui),
    },
    {
      id: 'app.checkUpdates',
      title: t('commands.checkUpdates'),
      icon: 'arrow-repeat',
      section: app,
      keywords: ['update', 'mise à jour', 'version'],
      run: async () => {
        try {
          const info = await checkUpdates();
          ui.toast(info.error ? 'warning' : info.available ? 'info' : 'success', updateSummary(info));
        } catch (error) {
          ui.toast('error', errorMessage(error));
        }
      },
    },
    {
      id: 'app.reloadPlugins',
      title: t('commands.reloadPlugins'),
      icon: 'arrow-clockwise',
      section: app,
      run: async () => {
        await loadPlugins();
        ui.toast('success', t('commands.pluginsReloaded'));
      },
    },
    {
      id: 'app.safeMode',
      title: t('commands.safeMode'),
      icon: 'shield-exclamation',
      section: app,
      keywords: ['safe', 'sans échec', 'crash'],
      run: () => void window.tessera.invoke('app:restart', { safeMode: true, reason: 'flag' }),
    },
    {
      id: 'app.about',
      title: t('commands.about'),
      icon: 'info-circle',
      section: app,
      keywords: ['atrium', 'credits'],
      run: () => {
        goHome('settings');
        openSettingsTab('about');
      },
    },
  ];

  catalog = commands.map(({ id, title, icon, section, shortcut }) => ({ id, title, icon: icon ?? 'command', section: section ?? '', shortcut }));
  ui.registerCommands(
    commands.map((command) => {
      if (!(command.id in shortcuts)) return command;
      const shortcut = shortcuts[command.id];
      return { ...command, shortcut: shortcut ?? undefined };
    }),
  );
}
