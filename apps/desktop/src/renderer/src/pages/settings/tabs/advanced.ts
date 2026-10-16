import type { ProfilePreview } from '@tessera/protocol';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import { openPluginLab } from '../../../plugins/lab/lab';
import { button, group, note, pathBox, row, section, select, toggle } from '../controls';
import type { SettingsTab, TabContext } from './types';

function megabytes(bytes: number) {
  return t('settings.megabytes', { n: (bytes / 1024 / 1024).toFixed(1) });
}

async function exportProfile({ ui }: TabContext) {
  const home = await window.tessera.invoke('projects:home');
  const projects = home.projects.filter((p) => !p.missing);
  let layoutFrom = '';
  const body = document.createElement('div');
  body.className = 'tessera-profile';
  const intro = document.createElement('p');
  intro.textContent = t('profile.exportIntro');
  const label = document.createElement('label');
  label.textContent = t('profile.layoutFrom');
  const pick = select(
    ui,
    '',
    [{ value: '', label: t('profile.noLayout') }, ...projects.map((p) => ({ value: p.id, label: p.name }))],
    (value) => (layoutFrom = value),
  );
  const hint = document.createElement('small');
  hint.textContent = t('profile.exportHint');
  body.append(intro, label, pick, hint);
  ui.atrium.modal.open({
    title: t('profile.exportTitle'),
    icon: 'download',
    body,
    buttons: [
      { text: t('dialog.cancel'), variant: 'cancel' },
      {
        text: t('profile.export'),
        variant: 'primary',
        onClick: async () => {
          try {
            const file = await window.tessera.invoke('profile:export', { layoutFrom: layoutFrom || null });
            if (file) ui.toast('success', t('profile.exported', { file }));
            return Boolean(file);
          } catch (error) {
            ui.toast('error', errorMessage(error));
            return false;
          }
        },
      },
    ],
  });
}

function pluginLine(plugin: ProfilePreview['plugins'][number]): HTMLElement {
  const state =
    plugin.state === 'same'
      ? t('profile.pluginSame')
      : plugin.state === 'version'
        ? t('profile.pluginVersion', { have: plugin.installedVersion ?? '?', want: plugin.version })
        : t('profile.pluginMissing');
  const line = row(plugin.name ?? plugin.id, `${state} · ${plugin.enabled ? t('profile.enabled') : t('profile.disabled')}`);
  line.classList.toggle('is-muted', plugin.state === 'missing');
  return line;
}

async function importProfile({ ui }: TabContext) {
  const read = await window.tessera.invoke('profile:read');
  if (!read) return;
  if (!read.ok) {
    ui.toast('error', t(read.error === 'too-large' ? 'profile.error.tooLarge' : 'profile.error.invalid'));
    return;
  }
  const { preview } = read;
  const choice = { settings: true, plugins: true, layout: preview.hasLayout };

  const body = document.createElement('div');
  body.className = 'tessera-profile';
  const intro = document.createElement('p');
  intro.textContent = t('profile.importIntro', { date: new Date(preview.createdAt).toLocaleString(), version: preview.appVersion });
  const rows = [
    row(t('profile.settings'), t('profile.settingsHint', { n: preview.settingKeys.length, shortcuts: preview.shortcuts }), toggle(true, (on) => (choice.settings = on))),
    row(
      t('profile.plugins'),
      t('profile.pluginsHint', { n: preview.plugins.length, settings: preview.pluginSettings }),
      toggle(true, (on) => (choice.plugins = on), preview.plugins.length === 0),
    ),
    ...(preview.hasLayout ? [row(t('profile.layout'), t('profile.layoutHint'), toggle(true, (on) => (choice.layout = on)))] : []),
  ];
  const list = document.createElement('div');
  list.className = 'tessera-profile-plugins';
  list.append(...preview.plugins.map(pluginLine));
  const warning = document.createElement('small');
  warning.textContent = t('profile.importWarning');
  body.append(intro, section(...rows), ...(preview.plugins.length ? [list] : []), warning);

  ui.atrium.modal.open({
    title: t('profile.importTitle'),
    icon: 'upload',
    body,
    buttons: [
      { text: t('dialog.cancel'), variant: 'cancel' },
      {
        text: t('profile.apply'),
        variant: 'primary',
        onClick: async () => {
          try {
            const result = await window.tessera.invoke('profile:apply', { token: preview.token, ...choice });
            ui.toast('success', t('profile.applied', { settings: result.settings, plugins: result.plugins }));
            if (result.skipped.length) ui.toast('warning', t('profile.skipped', { list: result.skipped.join(', ') }));
          } catch (error) {
            ui.toast('error', errorMessage(error));
            return false;
          }
          return true;
        },
      },
    ],
  });
}

export const advancedTab: SettingsTab = {
  id: 'advanced',
  icon: 'wrench-adjustable',
  label: 'settings.tab.advanced',
  render(ctx) {
    const { ui, info, settings, update } = ctx;
    const size = document.createElement('span');
    size.textContent = '…';
    void window.tessera.invoke('app:cache-size').then((bytes) => (size.textContent = megabytes(bytes)));

    const clear = button(t('settings.clear'), 'trash3', async () => {
      await window.tessera.invoke('app:clear-cache');
      size.textContent = megabytes(await window.tessera.invoke('app:cache-size'));
      ui.toast('success', t('settings.cacheCleared'));
    });

    const reset = button(
      t('settings.reset'),
      'arrow-counterclockwise',
      async () => {
        const ok = await ui.atrium.modal.confirm({
          title: t('settings.resetTitle'),
          message: t('settings.resetMessage'),
          confirmText: t('settings.reset'),
          cancelText: t('dialog.cancel'),
          danger: true,
        });
        if (ok) await window.tessera.invoke('app:reset');
      },
      'danger',
    );

    const lab = button(t('settings.labOpen'), 'bug', () => openPluginLab(ui));
    lab.disabled = !settings.developerMode;

    return [
      group('code-slash', t('settings.group.developer')),
      section(
        row(t('settings.devMode'), t('settings.devModeHint'), toggle(settings.developerMode, (on) => void update({ developerMode: on }))),
        row(t('settings.lab'), t('settings.labHint'), lab),
      ),
      group('box-arrow-up', t('settings.group.profile')),
      section(
        row(t('settings.profileExport'), t('settings.profileExportHint'), button(t('profile.export'), 'download', () => void exportProfile(ctx))),
        row(t('settings.profileImport'), t('settings.profileImportHint'), button(t('profile.import'), 'upload', () => void importProfile(ctx))),
      ),
      note(t('settings.profileNote')),
      group('folder2', t('settings.group.data')),
      section(row(t('settings.dataFolder'), t('settings.dataFolderHint'), pathBox(info.userData), button(t('settings.open'), 'folder2-open', () => void window.tessera.invoke('app:open-data')))),
      group('exclamation-octagon', t('settings.group.danger')),
      section(row(t('settings.cache'), size, clear), row(t('settings.reset'), t('settings.resetHint'), reset)),
    ];
  },
};
