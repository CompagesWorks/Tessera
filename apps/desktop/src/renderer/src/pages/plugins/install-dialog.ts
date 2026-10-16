import type { Permission, PluginManifest, PluginMode } from '@tessera/protocol';
import { t } from '../../i18n';
import { permissionRow } from '../../plugins/permissions';
import type { UiProvider } from '../../ui/provider';

export interface InstallChoice {
  granted: Permission[];
  mode: PluginMode;
}

function paragraph(text: string, className = 'tessera-plugin-desc') {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

function warning(text: string, icon = 'exclamation-triangle') {
  const box = document.createElement('div');
  box.className = 'tessera-plugin-warning';
  box.innerHTML = `<i class="bi bi-${icon}"></i>`;
  const span = document.createElement('span');
  span.textContent = text;
  box.append(span);
  return box;
}

export function providerWarning(onAccept: (accepted: boolean) => void): HTMLElement {
  const box = document.createElement('div');
  box.className = 'tessera-plugin-warning is-danger';
  box.innerHTML = '<i class="bi bi-exclamation-octagon-fill"></i>';
  const body = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = t('plugins.providerWarningTitle');
  const text = document.createElement('span');
  text.textContent = t('plugins.providerWarning');
  const accept = document.createElement('label');
  accept.className = 'tessera-plugin-accept';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.addEventListener('change', () => onAccept(input.checked));
  accept.append(input, t('plugins.providerAccept'));
  body.append(title, text, accept);
  box.append(body);
  return box;
}

export function installDialog(ui: UiProvider, manifest: PluginManifest, defaultMode: PluginMode = 'installed', packaged = false): Promise<InstallChoice | null> {
  return new Promise((resolve) => {
    const granted = new Set<Permission>(manifest.permissions.filter((p) => p !== 'ui.provider'));
    let mode = defaultMode;
    let settled = false;
    const body = document.createElement('div');

    body.append(
      warning(t('plugins.localWarning', { author: manifest.author })),
      paragraph(`${manifest.name} ${manifest.version} · ${manifest.author}${manifest.description ? ` — ${manifest.description}` : ''}`),
    );

    const modeLabel = document.createElement('label');
    modeLabel.className = 'atrium-label';
    modeLabel.textContent = t('plugins.mode');
    const modes = document.createElement('div');
    modes.className = 'tessera-chip-list';
    const modeHint = paragraph('', 'tessera-form-hint');
    const options: Array<[PluginMode, string, string]> = [
      ['installed', 'shield-check', t('plugins.modeInstalled')],
      ['dev', 'link-45deg', t('plugins.modeDev')],
    ];
    const refreshMode = () => {
      modes.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('is-active', b.dataset['mode'] === mode));
      modeHint.textContent = mode === 'installed' ? t('plugins.modeInstalledHint') : t('plugins.modeDevHint');
    };
    for (const [value, icon, label] of options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'atrium-chip-btn';
      button.dataset['mode'] = value;
      button.innerHTML = `<i class="bi bi-${icon}"></i>`;
      button.append(label);
      button.addEventListener('click', () => {
        mode = value;
        refreshMode();
      });
      modes.append(button);
    }
    refreshMode();
    if (packaged) body.append(paragraph(t('plugins.packageHint'), 'tessera-form-hint'));
    else body.append(modeLabel, modes, modeHint);

    const requests = document.createElement('label');
    requests.className = 'atrium-label';
    requests.style.marginTop = '16px';
    requests.textContent = t('plugins.requests');
    body.append(requests);
    if (manifest.permissions.length === 0) {
      const none = document.createElement('div');
      none.className = 'atrium-empty is-boxed';
      none.textContent = t('plugins.noPermission');
      body.append(none);
    }
    for (const permission of manifest.permissions) {
      body.append(
        permissionRow(
          permission,
          permission === 'ui.provider'
            ? undefined
            : {
                checked: true,
                onChange: (checked) => (checked ? granted.add(permission) : granted.delete(permission)),
              },
          manifest,
        ),
      );
    }

    if (manifest.permissions.includes('ui.provider')) body.append(providerWarning((accepted) => (accepted ? granted.add('ui.provider') : granted.delete('ui.provider'))));
    if (manifest.contributes.themes.length) body.append(paragraph(t('plugins.addsThemes', { list: manifest.contributes.themes.map((theme) => theme.name).join(', ') })));

    body.append(paragraph(t('plugins.addsWidgets', { list: manifest.contributes.widgets.map((w) => w.title).join(', ') || '—' })));

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
            resolve({ granted: [...granted], mode });
          },
        },
      ],
    });
  });
}
