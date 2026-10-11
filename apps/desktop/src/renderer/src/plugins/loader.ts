import { PLUGIN_SCHEME, type InstalledPlugin } from '@tessera/protocol';
import { replacePluginWidgets } from '../widgets/registry';
import type { WidgetDefinition } from '../widgets/types';
import { attachFrame, setPluginGrants } from './bridge';
import './plugin-frame.css';

let installed: InstalledPlugin[] = [];

export function installedPlugins(): InstalledPlugin[] {
  return installed;
}

function widgetsOf(plugin: InstalledPlugin): WidgetDefinition[] {
  const { manifest } = plugin;
  return manifest.contributes.widgets.map((widget) => ({
    type: `${manifest.id}/${widget.id}`,
    title: () => widget.title,
    description: () => widget.description,
    icon: widget.icon,
    category: widget.category,
    source: manifest.name,
    trust: 'plugin',
    create({ widgetId, project, state, setState }) {
      const element = document.createElement('div');
      element.className = 'tessera-plugin-frame';
      const iframe = document.createElement('iframe');
      iframe.sandbox.add('allow-scripts');
      iframe.referrerPolicy = 'no-referrer';
      iframe.allow = '';
      iframe.title = widget.title;
      iframe.src = `${PLUGIN_SCHEME}://${manifest.id}/${widget.entry}`;
      element.append(iframe);

      let current = state;
      const detach = attachFrame({
        iframe,
        pluginId: manifest.id,
        widgetId,
        project,
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
  for (const plugin of installed) setPluginGrants(plugin.manifest.id, plugin.enabled ? plugin.granted : []);
  replacePluginWidgets(installed.filter((p) => p.enabled).flatMap(widgetsOf));
}
