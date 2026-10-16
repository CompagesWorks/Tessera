import type { InstalledPlugin, Settings } from '@tessera/protocol';
import { t, type MessageKey } from '../../i18n';
import { themeKey } from '../../plugins/theme';
import type { UiProvider } from '../../ui/provider';
import { providerWarning } from './install-dialog';

interface ExtrasDeps {
  ui: UiProvider;
  settings: Settings;
  attempt(run: () => Promise<unknown>): Promise<void>;
}

function heading(key: MessageKey) {
  const h = document.createElement('h3');
  h.textContent = t(key);
  return h;
}

function button(label: string, icon: string, primary: boolean, onClick: () => void, disabled = false) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `atrium-btn ${primary ? 'atrium-btn-primary' : 'atrium-btn-secondary'}`;
  el.disabled = disabled;
  el.innerHTML = `<i class="bi bi-${icon}"></i>`;
  el.append(label);
  el.addEventListener('click', onClick);
  return el;
}

function actions(...children: Array<HTMLElement | string>) {
  const row = document.createElement('div');
  row.className = 'tessera-plugin-row-actions';
  row.append(...children);
  return row;
}

function code(text: string) {
  const el = document.createElement('code');
  el.textContent = text;
  return el;
}

function hint(key: MessageKey) {
  const p = document.createElement('p');
  p.className = 'tessera-form-hint';
  p.textContent = t(key);
  return p;
}

function externalSection(plugin: InstalledPlugin, { attempt }: ExtrasDeps): HTMLElement[] {
  const id = plugin.manifest.id;
  const granted = plugin.granted.includes('fs.external');
  return [
    heading('plugins.externalFolder'),
    actions(
      plugin.externalFolder ? code(plugin.externalFolder) : t('plugins.externalNone'),
      button(t('plugins.externalPick'), 'folder2-open', !plugin.externalFolder, () => void attempt(() => window.tessera.invoke('plugins:set-external', { id, pick: true })), !granted),
      ...(plugin.externalFolder ? [button(t('plugins.externalForget'), 'x-lg', false, () => void attempt(() => window.tessera.invoke('plugins:set-external', { id, pick: false })))] : []),
    ),
    ...(granted ? [] : [hint('plugins.needsGrant')]),
  ];
}

function programsSection(plugin: InstalledPlugin, { attempt }: ExtrasDeps): HTMLElement[] {
  const id = plugin.manifest.id;
  const granted = plugin.granted.includes('exec.system');
  const rows = plugin.manifest.systemPrograms.map((name) => {
    const picked = plugin.systemPrograms[name];
    return actions(
      code(name),
      picked ? code(picked.path) : t('plugins.programNone'),
      button(t('plugins.programPick'), 'file-earmark-binary', !picked, () => void attempt(() => window.tessera.invoke('plugins:pick-program', { id, name, pick: true })), !granted),
      ...(picked ? [button(t('plugins.externalForget'), 'x-lg', false, () => void attempt(() => window.tessera.invoke('plugins:pick-program', { id, name, pick: false })))] : []),
    );
  });
  return [heading('plugins.programs'), ...rows, hint(granted ? 'plugins.programHint' : 'plugins.needsGrant')];
}

function themesSection(plugin: InstalledPlugin, { settings, attempt }: ExtrasDeps): HTMLElement[] {
  const granted = plugin.enabled && plugin.granted.includes('ui.theme');
  const rows = plugin.manifest.contributes.themes.map((theme) => {
    const key = themeKey(plugin.manifest.id, theme.id);
    const active = settings.pluginTheme === key;
    return actions(
      `${theme.name} · ${theme.base === 'dark' ? t('plugins.themeDark') : t('plugins.themeLight')}`,
      active
        ? button(t('plugins.themeReset'), 'arrow-counterclockwise', false, () => void attempt(() => window.tessera.invoke('settings:update', { pluginTheme: null })))
        : button(t('plugins.themeApply'), 'palette', true, () => void attempt(() => window.tessera.invoke('settings:update', { pluginTheme: key, theme: theme.base })), !granted),
    );
  });
  return [heading('plugins.themes'), ...rows, ...(granted ? [] : [hint('plugins.needsGrant')])];
}

function providerSection(plugin: InstalledPlugin, { ui, settings, attempt }: ExtrasDeps): HTMLElement[] {
  const id = plugin.manifest.id;
  const granted = plugin.enabled && plugin.granted.includes('ui.provider');
  const active = settings.uiProvider === id;
  const reload = async (uiProvider: string | null) => {
    await attempt(() => window.tessera.invoke('settings:update', { uiProvider }));
    window.location.reload();
  };
  const activate = async () => {
    let accepted = false;
    const body = providerWarning((value) => (accepted = value));
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      ui.atrium.modal.open({
        title: t('plugins.providerUseTitle', { name: plugin.manifest.name }),
        icon: 'exclamation-octagon',
        body,
        onClose: () => {
          if (!settled) resolve(false);
        },
        buttons: [
          { text: t('dialog.cancel'), variant: 'cancel' },
          {
            text: t('plugins.providerUse'),
            variant: 'danger',
            onClick: () => {
              settled = true;
              resolve(accepted);
            },
          },
        ],
      });
    });
    if (ok) await reload(id);
  };
  return [
    heading('plugins.provider'),
    actions(
      active && granted ? t('plugins.providerIsActive') : t('plugins.providerIsInactive'),
      active
        ? button(t('plugins.providerStop'), 'arrow-counterclockwise', true, () => void reload(null))
        : button(t('plugins.providerUse'), 'window-stack', false, () => void activate(), !granted),
    ),
    hint('plugins.providerSafeMode'),
  ];
}

export function pluginExtras(plugin: InstalledPlugin, deps: ExtrasDeps): HTMLElement[] {
  const { manifest } = plugin;
  return [
    ...(manifest.permissions.includes('fs.external') ? externalSection(plugin, deps) : []),
    ...(manifest.systemPrograms.length ? programsSection(plugin, deps) : []),
    ...(manifest.contributes.themes.length ? themesSection(plugin, deps) : []),
    ...(manifest.contributes.uiProvider ? providerSection(plugin, deps) : []),
  ];
}
