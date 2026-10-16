import type { PluginSetting, PluginSettingValue } from '@tessera/protocol';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import { installedPlugins } from '../../../plugins/loader';
import { button, group, note, numberField, row, section, select, textField, toggle } from '../controls';
import type { SettingsTab, TabContext } from './types';

const cache = new Map<string, Record<string, PluginSettingValue>>();
const loading = new Set<string>();
let redraw: (() => void) | null = null;
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  window.tessera.on('plugins:settings-changed', ({ id, values }) => {
    cache.set(id, values);
    redraw?.();
  });
}

function control(ctx: TabContext, pluginId: string, def: PluginSetting, value: PluginSettingValue): HTMLElement {
  const commit = async (next: PluginSettingValue) => {
    try {
      cache.set(pluginId, await window.tessera.invoke('plugins:settings-set', { id: pluginId, key: def.id, value: next }));
    } catch (error) {
      ctx.ui.toast('error', errorMessage(error));
    }
    ctx.rerender();
  };
  if (def.type === 'boolean') return toggle(value === true, (on) => void commit(on));
  if (def.type === 'string') return textField(String(value), (text) => void commit(text), { placeholder: def.placeholder, maxLength: def.maxLength, width: 220 });
  if (def.type === 'number') return numberField(Number(value), (n) => void commit(n), { min: def.min, max: def.max, step: def.step });
  return select(ctx.ui, String(value), def.options.map((option) => ({ value: option.value, label: option.label })), (next) => void commit(next));
}

export const pluginSettingsTab: SettingsTab = {
  id: 'plugin-settings',
  icon: 'puzzle',
  label: 'settings.tab.pluginSettings',
  render(ctx) {
    listen();
    redraw = ctx.rerender;
    const plugins = installedPlugins().filter((p) => p.enabled && p.manifest.contributes.settings.length);
    if (!plugins.length) return [note(t('settings.pluginSettings.none'))];

    const blocks: HTMLElement[] = [];
    for (const plugin of plugins) {
      const { id, name } = plugin.manifest;
      const defs = plugin.manifest.contributes.settings;
      const values = cache.get(id);
      if (!values && !loading.has(id)) {
        loading.add(id);
        void window.tessera
          .invoke('plugins:settings-get', { id })
          .then((loaded) => cache.set(id, loaded))
          .catch(() => cache.set(id, {}))
          .finally(() => {
            loading.delete(id);
            ctx.rerender();
          });
      }
      const current = (def: PluginSetting) => values?.[def.id] ?? def.default;
      const groups = new Map<string, PluginSetting[]>();
      for (const def of defs) groups.set(def.group ?? '', [...(groups.get(def.group ?? '') ?? []), def]);
      blocks.push(group('puzzle', name));
      for (const [label, list] of groups) {
        if (label) {
          const heading = document.createElement('div');
          heading.className = 'tessera-set-subgroup';
          heading.textContent = label;
          blocks.push(heading);
        }
        blocks.push(section(...list.map((def) => row(def.title, def.description || null, control(ctx, id, def, current(def))))));
      }
      blocks.push(
        button(t('settings.pluginSettings.reset'), 'arrow-counterclockwise', async () => {
          try {
            cache.set(id, await window.tessera.invoke('plugins:settings-reset', { id }));
            ctx.ui.toast('success', t('settings.pluginSettings.resetDone', { name }));
          } catch (error) {
            ctx.ui.toast('error', errorMessage(error));
          }
          ctx.rerender();
        }),
      );
    }
    return blocks;
  },
};
