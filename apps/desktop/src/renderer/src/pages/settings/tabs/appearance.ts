import { ACCENTS, UI_SCALE_MAX, UI_SCALE_MIN } from '@tessera/protocol';
import { t } from '../../../i18n';
import { installedPlugins } from '../../../plugins/loader';
import { themeKey } from '../../../plugins/theme';
import { providerWarning } from '../../plugins/install-dialog';
import { group, row, section, segmented, select } from '../controls';
import type { SettingsTab, TabContext } from './types';

function swatches({ settings, update }: TabContext): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tessera-set-swatches';
  const swatch = (color: string | null, label: string) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `tessera-set-swatch${settings.accent === color ? ' is-on' : ''}${color ? '' : ' is-default'}`;
    if (color) el.style.background = color;
    el.title = label;
    el.setAttribute('aria-label', label);
    el.addEventListener('click', () => void update({ accent: color }));
    return el;
  };
  wrap.append(swatch(null, t('settings.accentDefault')), ...ACCENTS.map((color) => swatch(color, color)));
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'tessera-set-color';
  custom.value = settings.accent ?? '#7a9bff';
  custom.title = t('settings.accentCustom');
  custom.addEventListener('change', () => void update({ accent: custom.value.toLowerCase() }));
  wrap.append(custom);
  return wrap;
}

function scale({ settings, update }: TabContext): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tessera-set-range';
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'atrium-range';
  input.min = String(UI_SCALE_MIN);
  input.max = String(UI_SCALE_MAX);
  input.step = '5';
  input.value = String(settings.uiScale);
  const value = document.createElement('span');
  value.textContent = `${settings.uiScale} %`;
  input.addEventListener('input', () => (value.textContent = `${input.value} %`));
  input.addEventListener('change', () => void update({ uiScale: Number(input.value) }));
  wrap.append(input, value);
  return wrap;
}

async function switchProvider({ ui, update }: TabContext, id: string | null, name: string) {
  if (id) {
    let accepted = false;
    const ok = await new Promise<boolean>((resolve) => {
      let settled = false;
      ui.atrium.modal.open({
        title: t('plugins.providerUseTitle', { name }),
        icon: 'exclamation-octagon',
        body: providerWarning((value) => (accepted = value)),
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
    if (!ok) return false;
  }
  await update({ uiProvider: id });
  window.location.reload();
  return true;
}

export const appearanceTab: SettingsTab = {
  id: 'appearance',
  icon: 'palette',
  label: 'settings.tab.appearance',
  render(ctx) {
    const { ui, settings, update, rerender } = ctx;
    const plugins = installedPlugins().filter((p) => p.enabled);
    const themes = plugins
      .filter((p) => p.granted.includes('ui.theme'))
      .flatMap((p) => p.manifest.contributes.themes.map((theme) => ({ key: themeKey(p.manifest.id, theme.id), theme, plugin: p.manifest.name })));
    const providers = plugins.filter((p) => p.granted.includes('ui.provider') && p.manifest.contributes.uiProvider);
    const engine = document.createElement('span');
    engine.className = 'tessera-set-warning';
    engine.innerHTML = '<i class="bi bi-exclamation-triangle"></i> ';
    engine.append(t('settings.engineHint'));

    return [
      group('circle-half', t('settings.group.theme')),
      section(
        row(
          t('settings.mode'),
          null,
          segmented(
            ui,
            settings.theme,
            [
              { value: 'dark', label: t('settings.modeDark') },
              { value: 'light', label: t('settings.modeLight') },
              { value: 'system', label: t('settings.modeSystem') },
            ],
            (value) => void update({ theme: value === 'light' ? 'light' : value === 'system' ? 'system' : 'dark' }),
          ),
        ),
        row(
          t('settings.theme'),
          t('settings.themeHint'),
          select(
            ui,
            themes.some((x) => x.key === settings.pluginTheme) ? settings.pluginTheme! : '',
            [{ value: '', label: t('settings.themeDefault') }, ...themes.map((x) => ({ value: x.key, label: `${x.theme.name} · ${x.plugin}` }))],
            (value) => {
              const chosen = themes.find((x) => x.key === value);
              void update(chosen ? { pluginTheme: chosen.key, theme: chosen.theme.base } : { pluginTheme: null });
            },
          ),
        ),
        row(t('settings.accent'), t('settings.accentHint'), swatches(ctx)),
      ),
      group('magic', t('settings.group.motion')),
      section(
        row(
          t('settings.motion'),
          null,
          segmented(
            ui,
            settings.motion,
            [
              { value: 'full', label: t('settings.motionFull') },
              { value: 'reduced', label: t('settings.motionReduced') },
              { value: 'none', label: t('settings.motionNone') },
            ],
            (value) => void update({ motion: value === 'none' ? 'none' : value === 'reduced' ? 'reduced' : 'full' }),
          ),
        ),
      ),
      group('aspect-ratio', t('settings.group.interface')),
      section(
        row(t('settings.scale'), null, scale(ctx)),
        row(
          t('settings.engine'),
          engine,
          select(
            ui,
            providers.some((p) => p.manifest.id === settings.uiProvider) ? settings.uiProvider! : '',
            [{ value: '', label: t('settings.engineDefault') }, ...providers.map((p) => ({ value: p.manifest.id, label: p.manifest.name }))],
            (value) => {
              const chosen = providers.find((p) => p.manifest.id === value);
              void switchProvider(ctx, chosen?.manifest.id ?? null, chosen?.manifest.name ?? '').then((done) => {
                if (!done) rerender();
              });
            },
          ),
        ),
      ),
    ];
  },
};
