import type { GameSettings } from '@tessera/protocol';
import { t, type MessageKey } from '../../../i18n';
import { button, group, note, pathBox, row, section, textField, toggle } from '../controls';
import type { SettingsTab, TabContext } from './types';

type PathKey = 'ryujinx' | 'sdMods' | 'mosaicMods';

function folderRow(ctx: TabContext, key: PathKey, title: MessageKey, hint: MessageKey): HTMLElement {
  const { settings, update } = ctx;
  const value = settings.game[key];
  const patch = (next: string | null) => update({ game: { ...settings.game, [key]: next } as GameSettings });
  const choose = async () => {
    const folder = await window.tessera.invoke('app:pick-folder', { title: t(title) });
    if (folder) await patch(folder);
  };
  return row(
    t(title),
    t(hint),
    pathBox(value ?? t('settings.game.unset'), !value),
    button(t('settings.change'), 'folder2-open', () => void choose()),
    ...(value ? [button(t('settings.default'), null, () => void patch(null))] : []),
  );
}

export const gameTab: SettingsTab = {
  id: 'game',
  icon: 'controller',
  label: 'settings.tab.game',
  render(ctx) {
    const { settings, update } = ctx;
    const arc = textField(
      settings.game.arcVersion,
      (value) => {
        const version = value.trim().toLowerCase();
        if (/^(latest|\d{1,2}\.\d{1,3}(\.\d{1,3})?)$/.test(version)) void update({ game: { ...settings.game, arcVersion: version } });
        else {
          arc.value = settings.game.arcVersion;
          ctx.ui.toast('warning', t('settings.game.arcInvalid'));
        }
      },
      { placeholder: 'latest', maxLength: 12, width: 120 },
    );
    return [
      group('nintendo-switch', t('settings.game.emulator')),
      section(
        folderRow(ctx, 'ryujinx', 'settings.game.ryujinx', 'settings.game.ryujinxHint'),
        row(t('settings.game.launch'), t('settings.game.launchHint'), toggle(settings.game.launchAfterDeploy, (on) => void update({ game: { ...settings.game, launchAfterDeploy: on } }))),
      ),
      group('sd-card', t('settings.game.sd')),
      section(folderRow(ctx, 'sdMods', 'settings.game.sdMods', 'settings.game.sdModsHint')),
      group('box-seam', t('settings.game.arcMosaic')),
      section(row(t('settings.game.arc'), t('settings.game.arcHint'), arc), folderRow(ctx, 'mosaicMods', 'settings.game.mosaic', 'settings.game.mosaicHint')),
      note(t('settings.game.note')),
    ];
  },
};
