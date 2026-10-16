import type { ConfirmRequest } from '@tessera/protocol';
import { iconElement, pluginIcon } from '../components/icon';
import type { UiProvider } from '../ui/provider';
import { installedPlugins } from './loader';
import './confirm.css';

type Decision = 'once' | 'session' | 'deny';

function ask(ui: UiProvider, request: ConfirmRequest) {
  let settled = false;
  const answer = (decision: Decision) => {
    if (settled) return;
    settled = true;
    void window.tessera.invoke('plugins:confirm-answer', { id: request.id, decision });
  };

  const manifest = installedPlugins().find((plugin) => plugin.manifest.id === request.pluginId)?.manifest;
  const head = document.createElement('div');
  head.className = 'tessera-confirm-head';
  const icon = document.createElement('span');
  icon.className = 'tessera-confirm-icon';
  icon.append(iconElement(manifest ? pluginIcon(manifest.id, manifest.icon) : 'puzzle'));
  const message = document.createElement('strong');
  message.textContent = request.message;
  head.append(icon, message);
  const detail = document.createElement('p');
  detail.className = 'tessera-confirm-detail';
  detail.textContent = request.detail;
  const body = document.createElement('div');
  body.append(head, detail);

  ui.atrium.modal.open({
    title: request.title,
    icon: 'exclamation-triangle-fill',
    tone: 'warning',
    body,
    buttons: [
      { text: request.deny, variant: 'cancel', autofocus: true, onClick: () => answer('deny') },
      ...(request.session ? [{ text: request.session, variant: 'secondary' as const, onClick: () => answer('session') }] : []),
      { text: request.once, variant: 'primary', onClick: () => answer('once') },
    ],
    onClose: () => answer('deny'),
  });
}

export function startPluginConfirm(ui: UiProvider) {
  window.tessera.on('plugins:confirm', (request) => ask(ui, request));
}
