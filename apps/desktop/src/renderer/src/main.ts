import './bridge';
import 'bootstrap-icons/font/bootstrap-icons.css';
import 'atrium-ui/style.css';

import type { Settings } from '@tessera/protocol';
import { onSystemThemeChange, resolveTheme } from './app/appearance';
import { startAutoBackups } from './app/auto-backup';
import { exportProject } from './app/export';
import { startFileCommands } from './app/file-commands';
import { checkUpdatesQuietly } from './app/updates';
import type { AppContext } from './app/context';
import { registerCoreCommands } from './commands/core';
import { applyTranslations, getLanguage, isMessageKey, setLanguage, t } from './i18n';
import { translateAtrium } from './i18n/atrium';
import { pages } from './pages';
import { initPluginBridge, setLabEnabled, whenFramesReady } from './plugins/bridge';
import { installedPlugins, loadPlugins, setThemeChoice, suspendPlugins } from './plugins/loader';
import { loadUiProvider } from './plugins/provider';
import { mountShell } from './shell/shell';
import { safeScreen } from './splash/safe-screen';
import { createSplash } from './splash/splash';
import { HomeStore } from './state/home-store';
import { createAtriumProvider } from './ui/provider';
import { createProjectView } from './views/project/project';
import { PROJECT_RESTORED } from './widgets/builtin/backups/backups';

const FRAMES_TIMEOUT = 5000;
const SHIFT_DELAY_S = 5;

async function boot() {
  const [settings, info] = await Promise.all([window.tessera.invoke('settings:get'), window.tessera.invoke('app:info')]);
  setLanguage(settings.language);
  let current: Settings = settings;
  const theme = () => resolveTheme(current.theme);

  const base = createAtriumProvider({
    theme: theme(),
    motion: settings.motion,
    t: (key) => (isMessageKey(key) ? t(key) : translateAtrium(key, getLanguage())),
  });
  const splash = createSplash(info.version, settings.showSplash || info.safeMode);
  splash.onShift(() => void window.tessera.invoke('app:restart', { safeMode: true, reason: 'shift' }));
  splash.step(t('splash.settings'), 12);

  setLabEnabled(settings.developerMode);
  if (info.safeMode) suspendPlugins();
  setThemeChoice(settings.pluginTheme, theme(), settings.accent);
  if (splash.visible && !info.safeMode && settings.splashDelay) {
    for (let n = SHIFT_DELAY_S; n > 0; n--) {
      splash.step(t('splash.waitShift', { n }), 12);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  splash.step(t('splash.plugins'), 20);
  const listed = await window.tessera.invoke('plugins:list').catch(() => []);
  for (const [i, plugin] of listed.entries()) {
    const { name, id } = plugin.manifest;
    splash.step(t('splash.plugin', { n: i + 1, total: listed.length, name }), 20 + Math.round((i / Math.max(1, listed.length)) * 45));
    const result = await window.tessera.invoke('plugins:verify', { id }).catch((error: unknown) => ({ ok: false, error: String(error) }));
    if (!result.ok) console.warn(`[plugins] ${id}: ${result.error}`);
  }
  splash.step(t('splash.pluginsReady'), 66);
  await loadPlugins().catch((error) => console.error('[plugins] load failed', error));

  splash.step(t('splash.engine'), 72);
  const provider = await loadUiProvider(base, info.safeMode ? null : settings.uiProvider, installedPlugins());
  const ui = provider.ui;
  const { atrium } = ui;
  initPluginBridge(ui, theme());

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
  shell.exportButton.addEventListener('click', () => void exportProject(ctx));
  ctx.navigation.onChange((project) => {
    shell.crumb.textContent = project?.name ?? '';
    if (!project) void store.refresh();
  });

  registerCoreCommands(ctx, tabs, settings.shortcuts);
  applyTranslations();
  startAutoBackups(ctx, () => current);
  startFileCommands(ctx);

  window.addEventListener(PROJECT_RESTORED, (event) => {
    const id = (event as CustomEvent<string>).detail;
    if (ctx.navigation.current?.id !== id) return;
    ctx.navigation.closeProject();
    void ctx.navigation.openProject(id);
  });

  const applyLook = () => {
    ui.setTheme(theme());
    setThemeChoice(current.pluginTheme, theme(), current.accent);
  };
  onSystemThemeChange(() => {
    if (current.theme === 'system') applyLook();
  });

  window.tessera.on('settings:changed', (next) => {
    const previous = current;
    current = next;
    setLabEnabled(next.developerMode);
    applyLook();
    ui.setMotion(next.motion);
    if (JSON.stringify(previous.shortcuts) !== JSON.stringify(next.shortcuts)) registerCoreCommands(ctx, tabs, next.shortcuts);
    if (next.language === getLanguage()) return;
    setLanguage(next.language);
    for (const page of pages) page.onLanguageChange?.(shell.panels.get(page.id)!);
    applyTranslations();
    ctx.navigation.workspace.relabel();
    registerCoreCommands(ctx, tabs, next.shortcuts);
    void store.refresh();
    status.set(readyText());
    ui.toast('info', t('toast.language'));
  });

  splash.step(t('splash.projects'), 80);
  await store.refresh().catch((error) => console.error('[startup] projects failed', error));

  if (info.safeMode) {
    splash.replace(safeScreen(ui, info, installedPlugins(), () => void splash.close()));
  } else {
    if (settings.reopenLastProject) {
      splash.step(t('splash.project'), 88);
      const last = store.current.projects
        .filter((p) => p.lastOpened && !p.missing)
        .sort((a, b) => b.lastOpened!.localeCompare(a.lastOpened!))[0];
      if (last) {
        await ctx.navigation.openProject(last.id).catch((error) => console.error('[startup] reopen failed', error));
        splash.step(t('splash.widgets'), 94);
        await whenFramesReady(FRAMES_TIMEOUT);
      }
    }
    splash.step(t('splash.interface'), 97);
    await document.fonts.ready;
    splash.step(t('splash.ready'), 100);
    await splash.close();
  }

  if (provider.error) ui.toast('error', t('plugins.providerFailed', { error: provider.error }));
  else if (provider.plugin) ui.toast('warning', t('plugins.providerActive', { name: provider.plugin.manifest.name }));
  if (settings.updates.auto && !info.safeMode) void checkUpdatesQuietly(ui);
  await window.tessera.invoke('app:started');
}

void boot().catch((error) => {
  document.documentElement.classList.remove('is-booting');
  console.error('[startup] failed', error);
});
