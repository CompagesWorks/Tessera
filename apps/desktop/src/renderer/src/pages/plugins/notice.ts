import { t } from '../../i18n';
import { installedPlugins, onPluginsLoaded } from '../../plugins/loader';

export function startPluginNotice(button: HTMLElement) {
  const update = () => {
    const count = installedPlugins().filter((plugin) => plugin.pending.length > 0).length;
    button.classList.toggle('has-notice', count > 0);
    if (count > 0) button.setAttribute('aria-description', t('plugins.pendingNotice', { count }));
    else button.removeAttribute('aria-description');
  };
  onPluginsLoaded(update);
  update();
}
