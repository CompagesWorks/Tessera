import type { AppInfo, InstalledPlugin } from '@tessera/protocol';
import { fromTemplate, required } from '../components/dom';
import { t } from '../i18n';
import { errorMessage } from '../i18n/format';
import type { UiProvider } from '../ui/provider';
import template from './safe-screen.html?raw';

export function safeScreen(ui: UiProvider, info: AppInfo, plugins: InstalledPlugin[], onStay: () => void): HTMLElement {
  const root = fromTemplate(template);
  const reason = info.safeReason === 'crash' ? 'safe.reasonCrash' : info.safeReason === 'shift' ? 'safe.reasonShift' : 'safe.reasonFlag';
  required(root, '[data-reason]').textContent = t(reason);

  const list = required<HTMLElement>(root, '[data-plugins]');
  const all = required<HTMLInputElement>(root, '[data-disable-all]');
  const boxes = plugins
    .filter((p) => p.enabled)
    .map((plugin) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = plugin.manifest.id;
      input.checked = plugin.integrity !== 'ok';
      label.append(input, plugin.manifest.name);
      list.append(label);
      return input;
    });
  if (boxes.length === 0) {
    required<HTMLElement>(root, '[data-plugin-row]').hidden = true;
    all.disabled = true;
  }
  all.addEventListener('change', () => boxes.forEach((box) => (box.checked = all.checked)));

  const apply = required<HTMLButtonElement>(root, '[data-apply]');
  apply.addEventListener('click', async () => {
    apply.disabled = true;
    try {
      await window.tessera.invoke('safe:apply', {
        disable: boxes.filter((box) => box.checked).map((box) => box.value),
        resetLayouts: required<HTMLInputElement>(root, '[data-layouts]').checked,
        resetLook: required<HTMLInputElement>(root, '[data-look]').checked,
        clearCache: required<HTMLInputElement>(root, '[data-cache]').checked,
      });
      await window.tessera.invoke('app:restart', { safeMode: false });
    } catch (error) {
      apply.disabled = false;
      ui.toast('error', errorMessage(error));
    }
  });
  required(root, '[data-stay]').addEventListener('click', onStay);
  required(root, '[data-data]').addEventListener('click', () => void window.tessera.invoke('app:open-data'));
  required(root, '[data-reset]').addEventListener('click', async () => {
    const ok = await ui.atrium.modal.confirm({
      title: t('settings.resetTitle'),
      message: t('settings.resetMessage'),
      confirmText: t('settings.reset'),
      cancelText: t('dialog.cancel'),
      danger: true,
    });
    if (ok) await window.tessera.invoke('app:reset');
  });
  return root;
}
