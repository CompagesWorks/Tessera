import type { ProjectSummary } from '@tessera/protocol';
import { iconElement, pluginIcon } from '../components/icon';
import { pluginUrl } from '../bridge/schemes';
import { attachFrame } from './bridge';
import { activePlugins, onPluginsLoaded } from './loader';

export function startPluginTitlebar(actions: HTMLElement, onProjectChange: (listener: (project: ProjectSummary | null) => void) => void) {
  const hosts = document.createElement('div');
  hosts.hidden = true;
  document.body.append(hosts);
  let project: ProjectSummary | null = null;
  let cleanup: (() => void)[] = [];

  function render() {
    cleanup.forEach((dispose) => dispose());
    cleanup = [];
    if (!project) return;
    for (const { manifest } of activePlugins()) {
      const host = manifest.contributes.host;
      if (!host || !manifest.contributes.titlebar.length) continue;
      const iframe = document.createElement('iframe');
      iframe.sandbox.add('allow-scripts');
      iframe.referrerPolicy = 'no-referrer';
      iframe.allow = '';
      iframe.title = manifest.name;
      iframe.src = pluginUrl(manifest.id, host);
      hosts.append(iframe);
      const detach = attachFrame({ iframe, pluginId: manifest.id, widgetId: `host:${manifest.id}`, project, onResponsive: () => {}, getState: () => ({}), setState: () => {} });
      const buttons = manifest.contributes.titlebar.map((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tessera-title-btn';
        const label = document.createElement('span');
        label.textContent = entry.title;
        button.append(iconElement(pluginIcon(manifest.id, entry.icon)), label);
        button.addEventListener('click', () => iframe.contentWindow?.postMessage({ tessera: 1, event: 'titlebar', payload: { id: entry.id } }, '*'));
        return button;
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
}
