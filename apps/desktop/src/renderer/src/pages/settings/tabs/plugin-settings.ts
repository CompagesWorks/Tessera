import type { InstalledPlugin, PluginSetting, PluginSettingValue } from '@tessera/protocol';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import { installedPlugins } from '../../../plugins/loader';
import { button, note, numberField, row, section, segmented, select, textField, toggle } from '../controls';
import type { UiProvider } from '../../../ui/provider';
import type { SettingsTab } from './types';

const cache = new Map<string, Record<string, PluginSettingValue>>();
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

function control(ui: UiProvider, pluginId: string, def: PluginSetting, value: PluginSettingValue): HTMLElement {
  const commit = async (next: PluginSettingValue) => {
    try {
      cache.set(pluginId, await window.tessera.invoke('plugins:settings-set', { id: pluginId, key: def.id, value: next }));
    } catch (error) {
      ui.toast('error', errorMessage(error));
    }
    redraw?.();
  };
  if (def.type === 'boolean') return toggle(value === true, (on) => void commit(on));
  if (def.type === 'string') {
    const field = textField(String(value), (text) => void commit(text), { placeholder: def.placeholder, maxLength: def.maxLength, width: 220 });
    const extensions = def.browse;
    if (!extensions?.length) return field;
    const wrap = document.createElement('div');
    wrap.className = 'tessera-set-browse';
    const browse = button(t('settings.pluginSettings.browse'), 'folder2-open', async () => {
      const path = await window.tessera.invoke('app:pick-file', { extensions }).catch(() => null);
      if (path && path.length <= def.maxLength) await commit(path);
      else if (path) ui.toast('error', t('settings.pluginSettings.pathTooLong'));
    });
    wrap.append(field, browse);
    return wrap;
  }
  if (def.type === 'number') return numberField(Number(value), (n) => void commit(n), { min: def.min, max: def.max, step: def.step });
  return select(ui, String(value), def.options.map((option) => ({ value: option.value, label: option.label })), (next) => void commit(next));
}

export function pluginSettingsCount({ manifest }: InstalledPlugin): number {
  return manifest.contributes.settings.length + (manifest.permissions.includes('fs.external') ? 1 : 0) + manifest.systemPrograms.length;
}

function pathText(path: string | undefined, none: string): HTMLElement {
  const el = document.createElement(path ? 'code' : 'span');
  el.textContent = path ?? none;
  return el;
}

function systemRows(ui: UiProvider, plugin: InstalledPlugin, update: (next: InstalledPlugin) => void): HTMLElement[] {
  const { id, permissions, systemPrograms } = plugin.manifest;
  const run = async (call: () => Promise<InstalledPlugin>) => {
    try {
      update(await call());
    } catch (error) {
      ui.toast('error', errorMessage(error));
    }
  };
  const rows: HTMLElement[] = [];
  if (permissions.includes('fs.external')) {
    const folder = plugin.externalFolder ?? undefined;
    const pick = button(t('plugins.externalPick'), 'folder2-open', () => void run(() => window.tessera.invoke('plugins:set-external', { id, pick: true })));
    pick.disabled = !plugin.granted.includes('fs.external');
    const forget = folder ? [button(t('plugins.externalForget'), 'x-lg', () => void run(() => window.tessera.invoke('plugins:set-external', { id, pick: false })))] : [];
    rows.push(row(t('plugins.externalFolder'), pathText(folder, t('plugins.externalNone')), pick, ...forget));
  }
  for (const name of systemPrograms) {
    const picked = plugin.systemPrograms[name]?.path;
    const pick = button(t('plugins.programPick'), 'file-earmark-binary', () => void run(() => window.tessera.invoke('plugins:pick-program', { id, name, pick: true })));
    pick.disabled = !plugin.granted.includes('exec.system');
    const forget = picked ? [button(t('plugins.externalForget'), 'x-lg', () => void run(() => window.tessera.invoke('plugins:pick-program', { id, name, pick: false })))] : [];
    rows.push(row(name, pathText(picked, t('plugins.programNone')), pick, ...forget));
  }
  return rows.length ? [section(...rows)] : [];
}

export async function openPluginSettings(ui: UiProvider, plugin: InstalledPlugin) {
  const { id, name } = plugin.manifest;
  let current = (await window.tessera.invoke('plugins:list').catch(() => [])).find((p) => p.manifest.id === id) ?? plugin;
  if (!cache.has(id)) cache.set(id, await window.tessera.invoke('plugins:settings-get', { id }).catch(() => ({})));
  const body = document.createElement('div');
  body.className = 'tessera-plugin-settings';
  let active = '';
  const draw = () => {
    const values = cache.get(id) ?? {};
    const groups = new Map<string, PluginSetting[]>();
    for (const def of current.manifest.contributes.settings) groups.set(def.group ?? '', [...(groups.get(def.group ?? '') ?? []), def]);
    const system = systemRows(ui, current, (next) => {
      current = next;
      draw();
    });
    if (system.length && !groups.has('')) groups.set('', []);
    const tabs = [...groups.keys()].sort((a, b) => Number(a !== '') - Number(b !== ''));
    if (!tabs.includes(active)) active = tabs[0] ?? '';
    const shown = tabs.length > 1 ? [active] : tabs;
    const blocks: HTMLElement[] = [];
    if (tabs.length > 1) {
      const options = tabs.map((value) => ({ value, label: value || t('settings.pluginSettings.general') }));
      const nav = segmented(ui, active, options, (next) => {
        active = next;
        draw();
      });
      nav.classList.add('tessera-set-tabs');
      blocks.push(nav);
    }
    for (const label of shown) {
      if (label === '') blocks.push(...system);
      const list = groups.get(label) ?? [];
      if (list.length) blocks.push(section(...list.map((def) => row(def.title, def.description || null, control(ui, id, def, values[def.id] ?? def.default)))));
    }
    body.replaceChildren(...blocks);
  };
  draw();
  redraw = draw;
  ui.atrium.modal.open({
    title: name,
    icon: 'sliders',
    body,
    buttons: [
      ...(current.manifest.contributes.settings.length
        ? [
            {
              text: t('settings.pluginSettings.reset'),
              variant: 'secondary' as const,
              closeOnClick: false,
              onClick: async () => {
                try {
                  cache.set(id, await window.tessera.invoke('plugins:settings-reset', { id }));
                  ui.toast('success', t('settings.pluginSettings.resetDone', { name }));
                } catch (error) {
                  ui.toast('error', errorMessage(error));
                }
                draw();
              },
            },
          ]
        : []),
      { text: t('about.close'), variant: 'primary' as const },
    ],
    onClose: () => {
      redraw = null;
    },
  });
}

export const pluginSettingsTab: SettingsTab = {
  id: 'plugin-settings',
  icon: 'puzzle',
  label: 'settings.tab.pluginSettings',
  render(ctx) {
    listen();
    const plugins = installedPlugins().filter((p) => p.enabled && pluginSettingsCount(p));
    if (!plugins.length) return [note(t('settings.pluginSettings.none'))];
    return [
      section(
        ...plugins.map((plugin) =>
          row(
            plugin.manifest.name,
            t('settings.pluginSettings.count', { n: pluginSettingsCount(plugin) }),
            button(t('settings.pluginSettings.open'), 'sliders', () => void openPluginSettings(ctx.ui, plugin)),
          ),
        ),
      ),
    ];
  },
};
