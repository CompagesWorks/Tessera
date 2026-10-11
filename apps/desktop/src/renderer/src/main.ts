import 'bootstrap-icons/font/bootstrap-icons.css';
import 'atrium-ui/style.css';

import type { AppContext } from './app/context';
import { registerCoreCommands } from './commands/core';
import { applyTranslations, getLanguage, isMessageKey, setLanguage, t } from './i18n';
import { translateAtrium } from './i18n/atrium';
import { pages } from './pages';
import { broadcastTheme, initPluginBridge } from './plugins/bridge';
import { loadPlugins } from './plugins/loader';
import { mountShell } from './shell/shell';
import { HomeStore } from './state/home-store';
import { createAtriumProvider } from './ui/provider';
import { createProjectView } from './views/project/project';

async function boot() {
  const [settings, info] = await Promise.all([window.tessera.invoke('settings:get'), window.tessera.invoke('app:info')]);
  setLanguage(settings.language);

  const ui = createAtriumProvider({
    theme: settings.theme,
    motion: settings.motion,
    t: (key) => (isMessageKey(key) ? t(key) : translateAtrium(key, getLanguage())),
  });
  const { atrium } = ui;

  initPluginBridge(ui, settings.theme);
  await loadPlugins().catch((error) => console.error('[plugins] load failed', error));

  const shell = mountShell(pages);
  atrium.windowControls();

  const status = atrium.statusbar(shell.statusbar);
  const readyText = () => (info.safeMode ? t('status.safeMode') : t('status.ready'));
  status.set(readyText(), info.safeMode ? 'warning' : 'default');
  status.setRight(`v${info.version}`);

  const store = new HomeStore();
  const ctx: AppContext = {
    ui,
    info,
    store,
    status,
    navigation: createProjectView({
      host: shell.stage,
      workspaces: shell.workspaces,
      editButton: shell.editButton,
      ui,
      getContext: () => ctx,
    }),
  };

  const tabs = atrium.tabs({ root: shell.stage, nav: shell.sidebar, transition: 'slide', initial: pages[0]!.id });
  for (const page of pages) page.mount?.(shell.panels.get(page.id)!, ctx);

  shell.homeButton.addEventListener('click', () => ctx.navigation.closeProject());
  ctx.navigation.onChange((project) => {
    shell.crumb.textContent = project?.name ?? '';
    if (!project) void store.refresh();
  });

  registerCoreCommands(ctx, tabs);
  applyTranslations();

  window.tessera.on('settings:changed', (next) => {
    ui.setTheme(next.theme);
    broadcastTheme(next.theme);
    ui.setMotion(next.motion);
    if (next.language === getLanguage()) return;
    setLanguage(next.language);
    for (const page of pages) page.onLanguageChange?.(shell.panels.get(page.id)!);
    applyTranslations();
    ctx.navigation.workspace.relabel();
    registerCoreCommands(ctx, tabs);
    void store.refresh();
    status.set(readyText());
    ui.toast('info', t('toast.language'));
  });
}

void boot();
