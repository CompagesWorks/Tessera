import type { MarketplaceEntry } from '@tessera/protocol';
import { t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import type { UiProvider } from '../../ui/provider';

export interface LinkActions {
  show: () => void;
  browse: () => void;
  install: (entry: MarketplaceEntry) => Promise<void> | undefined;
}

export function startMarketplaceLinks(ui: UiProvider, actions: LinkActions) {
  let busy = false;
  const handle = async () => {
    if (busy) return;
    busy = true;
    try {
      const link = await window.tessera.invoke('marketplace:take-link');
      if (!link) return;
      if (link.plugin) {
        const entry = await window.tessera.invoke('marketplace:lookup', { url: link.url, id: link.plugin });
        actions.show();
        await actions.install(entry);
        return;
      }
      const ok = await ui.atrium.modal.confirm({
        title: t('marketplace.linkTitle'),
        message: t('marketplace.linkMessage', { url: link.url }),
        confirmText: t('marketplace.add'),
        cancelText: t('dialog.cancel'),
      });
      if (!ok) return;
      await window.tessera.invoke('marketplace:add-source', { url: link.url });
      ui.toast('success', t('marketplace.added'));
      actions.show();
      actions.browse();
    } catch (error) {
      ui.toast('error', errorMessage(error));
    } finally {
      busy = false;
    }
  };
  window.tessera.on('marketplace:link', () => void handle());
  void handle();
}
