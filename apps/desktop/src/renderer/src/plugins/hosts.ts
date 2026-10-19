import type { PluginFileAction, PluginSettingValue, ProjectSummary } from '@tessera/protocol';
import { iconElement, pluginIcon } from '../components/icon';
import { pluginUrl } from '../bridge/schemes';
import { attachFrame } from './bridge';
import { activePlugins, onPluginsLoaded } from './loader';

interface Host {
  pluginId: string;
  pluginName: string;
  iframe: HTMLIFrameElement;
  fileActions: PluginFileAction[];
  settings: Record<string, PluginSettingValue>;
}

export interface FileActionEntry {
  pluginName: string;
  title: string;
  icon: string;
  default: boolean;
  run(): void;
}

let hosts: Host[] = [];

const send = (host: Host, event: string, payload: unknown) => host.iframe.contentWindow?.postMessage({ tessera: 1, event, payload }, '*');

export function pluginFileActions(path: string, except?: string): FileActionEntry[] {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return hosts.filter((host) => host.pluginId !== except).flatMap((host) =>
    host.fileActions
      .filter((action) => action.extensions.includes(extension) || action.extensions.includes('*'))
      .map((action) => ({
        pluginName: host.pluginName,
        title: action.title.replace(/\{\{([a-zA-Z][\w.-]*)\}\}/g, (_, key: string) => String(host.settings[key] ?? '').trim() || 'Editor'),
        icon: pluginIcon(host.pluginId, action.icon),
        default: action.default,
        run: () => send(host, 'fileAction', { id: action.id, paths: [path] }),
      })),
  );
}

export function startPluginHosts(actions: HTMLElement, onProjectChange: (listener: (project: ProjectSummary | null) => void) => void) {
  const container = document.createElement('div');
  container.hidden = true;
  document.body.append(container);
  let project: ProjectSummary | null = null;
  let cleanup: (() => void)[] = [];

  function render() {
    cleanup.forEach((dispose) => dispose());
    cleanup = [];
    hosts = [];
    if (!project) return;
    for (const { manifest, granted } of activePlugins()) {
      const { host: entry, titlebar } = manifest.contributes;
      const fileActions = granted.includes('ui.menus') ? manifest.contributes.fileActions : [];
      if (!entry || (!titlebar.length && !fileActions.length)) continue;
      const iframe = document.createElement('iframe');
      iframe.sandbox.add('allow-scripts');
      iframe.referrerPolicy = 'no-referrer';
      iframe.allow = '';
      iframe.title = manifest.name;
      iframe.src = pluginUrl(manifest.id, entry);
      container.append(iframe);
      const detach = attachFrame({ iframe, pluginId: manifest.id, widgetId: `host:${manifest.id}`, project, onResponsive: () => {}, getState: () => ({}), setState: () => {} });
      const settings = Object.fromEntries(manifest.contributes.settings.map((setting) => [setting.id, setting.default]));
      const host: Host = { pluginId: manifest.id, pluginName: manifest.name, iframe, fileActions, settings };
      hosts.push(host);
      if (fileActions.some((action) => action.title.includes('{{'))) {
        void window.tessera.invoke('plugins:settings-get', { id: manifest.id }).then((values) => {
          if (hosts.includes(host)) host.settings = { ...settings, ...values };
        }).catch(() => {});
      }
      const buttons = titlebar.map((button) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'tessera-title-btn';
        const label = document.createElement('span');
        label.textContent = button.title;
        element.append(iconElement(pluginIcon(manifest.id, button.icon)), label);
        element.addEventListener('click', () => send(host, 'titlebar', { id: button.id }));
        return element;
      });
      actions.prepend(...buttons);
      cleanup.push(() => {
        detach();
        iframe.remove();
        buttons.forEach((button) => button.remove());
      });
    }
  }

  onProjectChange((next) => {
    project = next;
    render();
  });
  onPluginsLoaded(render);
  window.tessera.on('plugins:settings-changed', ({ id, values }) => {
    for (const host of hosts) if (host.pluginId === id) host.settings = values;
  });
}
