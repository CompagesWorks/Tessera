import 'bootstrap-icons/font/bootstrap-icons.css';
import 'atrium-ui/style.css';

import { registerCoreCommands } from './commands/core';
import { applyTranslations, getLanguage, isMessageKey, setLanguage, t } from './i18n';
import { translateAtrium } from './i18n/atrium';
import { pages } from './pages';
import { mountShell } from './shell/shell';
import { createAtriumProvider } from './ui/provider';

async function boot() {
  const [settings, info] = await Promise.all([window.tessera.invoke('settings:get'), window.tessera.invoke('app:info')]);
  setLanguage(settings.language);

  const ui = createAtriumProvider({
    theme: settings.theme,
    motion: settings.motion,
    t: (key) => (isMessageKey(key) ? t(key) : translateAtrium(key, getLanguage())),
  });
  const { atrium } = ui;

  const shell = mountShell(pages);
  atrium.windowControls();

  const status = atrium.statusbar(shell.statusbar);
  const readyText = () => (info.safeMode ? t('status.safeMode') : t('status.ready'));
  status.set(readyText(), info.safeMode ? 'warning' : 'default');
  status.setRight(`v${info.version}`);

  const tabs = atrium.tabs({ root: shell.stage, nav: shell.sidebar, transition: 'slide', initial: pages[0]!.id });

  for (const page of pages) page.mount?.(shell.panels.get(page.id)!, { ui, info });

  registerCoreCommands({ ui, atrium, tabs, info });
  applyTranslations();

  window.tessera.on('settings:changed', (next) => {
    ui.setTheme(next.theme);
    ui.setMotion(next.motion);
    if (next.language === getLanguage()) return;
    setLanguage(next.language);
    registerCoreCommands({ ui, atrium, tabs, info });
    status.set(readyText());
    ui.toast('info', t('toast.language'));
  });
}

void boot();
