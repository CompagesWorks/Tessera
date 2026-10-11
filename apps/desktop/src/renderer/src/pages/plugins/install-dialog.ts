import type { Permission, PluginManifest } from '@tessera/protocol';
import { t } from '../../i18n';
import { permissionRow } from '../../plugins/permissions';
import type { UiProvider } from '../../ui/provider';

export function installDialog(ui: UiProvider, manifest: PluginManifest): Promise<Permission[] | null> {
  return new Promise((resolve) => {
    const granted = new Set<Permission>(manifest.permissions);
    let settled = false;
    const body = document.createElement('div');

    const warning = document.createElement('div');
    warning.className = 'tessera-plugin-warning';
    warning.innerHTML = '<i class="bi bi-exclamation-triangle"></i>';
    const text = document.createElement('span');
    text.textContent = t('plugins.localWarning', { author: manifest.author });
    warning.append(text);
    body.append(warning);

    const meta = document.createElement('p');
    meta.className = 'tessera-plugin-desc';
    meta.textContent = `${manifest.name} ${manifest.version} · ${manifest.author}${manifest.description ? ` — ${manifest.description}` : ''}`;
    body.append(meta);

    const heading = document.createElement('h3');
    heading.className = 'atrium-label';
    heading.textContent = t('plugins.requests');
    body.append(heading);
    if (manifest.permissions.length === 0) {
      const none = document.createElement('div');
      none.className = 'atrium-empty is-boxed';
      none.textContent = t('plugins.noPermission');
      body.append(none);
    }
    for (const permission of manifest.permissions) {
      body.append(
        permissionRow(permission, {
          checked: true,
          onChange: (checked) => (checked ? granted.add(permission) : granted.delete(permission)),
        }),
      );
    }

    const widgets = document.createElement('p');
    widgets.className = 'tessera-plugin-desc';
    widgets.textContent = t('plugins.addsWidgets', { list: manifest.contributes.widgets.map((w) => w.title).join(', ') || '—' });
    body.append(widgets);

    ui.atrium.modal.open({
      title: t('plugins.installTitle', { name: manifest.name }),
      icon: 'puzzle',
      body,
      onClose: () => {
        if (!settled) resolve(null);
      },
      buttons: [
        { text: t('dialog.cancel'), variant: 'cancel' },
        {
          text: t('plugins.install'),
          variant: 'primary',
          onClick: () => {
            settled = true;
            resolve([...granted]);
          },
        },
      ],
    });
  });
}
