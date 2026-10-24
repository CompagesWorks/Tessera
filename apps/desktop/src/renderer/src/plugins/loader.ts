import type { InstalledPlugin } from '@tessera/protocol';
import { pluginUrl } from '../bridge/schemes';
import { pluginIcon } from '../components/icon';
import { t } from '../i18n';
import { replacePluginWidgets } from '../widgets/registry';
import type { WidgetDefinition } from '../widgets/types';
import { attachFrame, broadcastTheme, setPluginGrants } from './bridge';
import { localizePlugin, pluginText } from './locale';
import { applyThemeTokens, findTheme } from './theme';
import { accentTokens } from '../app/appearance';
import './plugin-frame.css';

let installed: InstalledPlugin[] = [];
let themeChoice: { key: string | null; mode: 'dark' | 'light'; accent: string | null } = { key: null, mode: 'dark', accent: null };
let suspended = false;
const loadedListeners = new Set<() => void>();

export function onPluginsLoaded(listener: () => void) {
  loadedListeners.add(listener);
}

export function suspendPlugins() {
  suspended = true;
}

export function activePlugins(): InstalledPlugin[] {
  return suspended ? [] : installedPlugins().filter((plugin) => plugin.enabled);
}

export function installedPlugins(): InstalledPlugin[] {
  return installed.map(localizePlugin);
}

function widgetsOf(plugin: InstalledPlugin): WidgetDefinition[] {
  const { manifest } = plugin;
  return manifest.contributes.widgets.map((widget) => ({
    type: `${manifest.id}/${widget.id}`,
    title: () => pluginText(plugin, widget.title),
    description: () => pluginText(plugin, widget.description),
    icon: pluginIcon(manifest.id, widget.icon),
    category: widget.category,
    source: pluginText(plugin, manifest.name),
    trust: 'plugin',
    create({ widgetId, project, state, setState }) {
      const element = document.createElement('div');
      element.className = 'tessera-plugin-frame';
      const iframe = document.createElement('iframe');
      iframe.sandbox.add('allow-scripts');
      iframe.referrerPolicy = 'no-referrer';
      iframe.allow = '';
      iframe.title = pluginText(plugin, widget.title);
      iframe.src = pluginUrl(manifest.id, widget.entry);
      const hung = document.createElement('div');
      hung.className = 'tessera-plugin-hung';
      hung.hidden = true;
      hung.innerHTML = '<i class="bi bi-hourglass-split"></i>';
      const message = document.createElement('b');
      message.textContent = t('plugins.unresponsive', { name: pluginText(plugin, manifest.name) });
      const reload = document.createElement('button');
      reload.type = 'button';
      reload.className = 'atrium-btn atrium-btn-secondary';
      reload.textContent = t('plugins.reload');
      reload.addEventListener('click', () => {
        hung.hidden = true;
        loading.hidden = false;
        iframe.src = iframe.src;
      });
      hung.append(message, reload);
      const loading = document.createElement('div');
      loading.className = 'tessera-plugin-loading';
      loading.setAttribute('role', 'status');
      loading.setAttribute('aria-label', t('plugins.loadingWidget'));
      loading.innerHTML = '<span class="tessera-plugin-spinner"></span>';
      iframe.addEventListener('load', () => (loading.hidden = true));
      element.append(iframe, loading, hung);

      let current = state;
      const detach = attachFrame({
        iframe,
        pluginId: manifest.id,
        widgetId,
        project,
        onResponsive: (responsive) => {
          hung.hidden = responsive;
        },
        getState: () => current,
        setState: (next) => {
          current = next;
          setState(next);
        },
      });
      return { element, dispose: detach };
    },
  }));
}

export async function loadPlugins() {
  installed = await window.tessera.invoke('plugins:list');
  for (const plugin of installed) setPluginGrants(plugin.manifest.id, plugin.enabled && !suspended ? plugin.granted : [], plugin.manifest.name, plugin.locales);
  replacePluginWidgets(suspended ? [] : installed.filter((p) => p.enabled).flatMap(widgetsOf));
  refreshPluginTheme();
  loadedListeners.forEach((listener) => listener());
}

export function setThemeChoice(key: string | null, mode: 'dark' | 'light', accent: string | null) {
  themeChoice = { key, mode, accent };
  refreshPluginTheme();
}

export function refreshPluginTheme() {
  const tokens = { ...(suspended ? {} : (findTheme(installed, themeChoice.key)?.tokens ?? {})), ...accentTokens(themeChoice.accent) };
  applyThemeTokens(tokens);
  broadcastTheme(themeChoice.mode, tokens);
}
