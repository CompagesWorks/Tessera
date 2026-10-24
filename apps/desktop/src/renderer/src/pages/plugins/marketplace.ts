import type { MarketplaceEntry, MarketplaceListing } from '@tessera/protocol';
import { iconElement } from '../../components/icon';
import { hueOf } from '../../components/project-card/project-card';
import { t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import { installedPlugins } from '../../plugins/loader';
import type { UiProvider } from '../../ui/provider';

export function newerVersion(a: string, b: string) {
  const parts = (v: string) => v.replace(/^v/i, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, icon: string, tone: 'primary' | 'secondary', onClick: () => void) {
  const b = el('button', `atrium-btn atrium-btn-${tone}`);
  b.type = 'button';
  b.innerHTML = `<i class="bi bi-${icon}"></i>`;
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

export function mountMarketplace(root: HTMLElement, ui: UiProvider, install: (entry: MarketplaceEntry) => Promise<void>) {
  let listings: MarketplaceListing[] = [];
  let loading = false;
  let query = '';

  const sources = el('div', 'tessera-market-sources');
  const search = el('input', 'atrium-input tessera-market-search');
  search.type = 'search';
  search.placeholder = t('marketplace.search');
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderGrid();
  });
  const grid = el('div', 'tessera-market-grid');
  root.replaceChildren(sources, search, grid);

  async function refresh() {
    loading = true;
    render();
    try {
      listings = await window.tessera.invoke('marketplace:fetch');
    } catch (error) {
      ui.toast('error', errorMessage(error));
    }
    loading = false;
    render();
  }

  async function addSource() {
    const url = await ui.atrium.modal.prompt({
      title: t('marketplace.addTitle'),
      label: t('marketplace.addMessage'),
      value: '',
      icon: 'shop',
      confirmText: t('marketplace.add'),
      cancelText: t('dialog.cancel'),
    });
    if (!url?.trim()) return;
    try {
      await window.tessera.invoke('marketplace:add-source', { url: url.trim() });
      await refresh();
    } catch (error) {
      ui.toast('error', errorMessage(error));
    }
  }

  async function removeSource(url: string) {
    const ok = await ui.atrium.modal.confirm({
      title: t('marketplace.removeTitle'),
      message: url,
      confirmText: t('plugins.remove'),
      cancelText: t('dialog.cancel'),
      danger: true,
    });
    if (!ok) return;
    await window.tessera.invoke('marketplace:remove-source', { url });
    listings = listings.filter((l) => l.url !== url);
    render();
  }

  function renderSources() {
    const chips = listings.map((listing) => {
      const chip = el('span', `tessera-market-source ${listing.error ? 'is-error' : ''}`);
      chip.title = listing.error ?? listing.url;
      chip.innerHTML = `<i class="bi bi-${listing.official ? 'patch-check-fill' : listing.error ? 'exclamation-triangle' : 'github'}"></i>`;
      chip.append(listing.name ?? listing.url.replace('https://github.com/', ''));
      if (!listing.official) {
        const remove = el('button', 'tessera-market-source-remove');
        remove.type = 'button';
        remove.title = t('plugins.remove');
        remove.innerHTML = '<i class="bi bi-x"></i>';
        remove.addEventListener('click', () => void removeSource(listing.url));
        chip.append(remove);
      }
      return chip;
    });
    const reload = button(t('marketplace.refresh'), 'arrow-clockwise', 'secondary', () => void refresh());
    reload.disabled = loading;
    sources.replaceChildren(...chips, button(t('marketplace.addSource'), 'plus-lg', 'secondary', () => void addSource()), reload);
  }

  function card(entry: MarketplaceEntry, listing: MarketplaceListing) {
    const box = el('div', 'tessera-market-card');
    const head = el('div', 'tessera-plugin-head');
    const icon = el('span', 'tessera-plugin-icon');
    icon.style.setProperty('--_hue', String(hueOf(entry.id)));
    icon.append(iconElement(/^[a-z0-9-]{1,40}$/.test(entry.icon ?? '') ? entry.icon! : 'puzzle'));
    const title = el('div');
    title.append(el('div', 'tessera-plugin-name', entry.name), el('div', 'tessera-plugin-meta', `${entry.author || '?'} · v${entry.version}`));
    head.append(icon, title);
    const desc = el('p', 'tessera-plugin-desc', entry.description || t('plugins.noDescription'));
    const actions = el('div', 'tessera-market-actions');
    const installed = installedPlugins().find((p) => p.manifest.id === entry.id);
    if (!installed || newerVersion(entry.version, installed.manifest.version)) {
      const go = button(t(installed ? 'marketplace.update' : 'marketplace.install'), installed ? 'arrow-up-circle' : 'download', 'primary', async () => {
        go.disabled = true;
        await install(entry);
        go.disabled = false;
      });
      actions.append(go);
    } else {
      actions.append(el('span', 'atrium-badge atrium-badge-success', t('marketplace.installed')));
    }
    if (entry.homepage) actions.append(button(t('marketplace.homepage'), 'box-arrow-up-right', 'secondary', () => void window.tessera.invoke('app:open-external', { url: entry.homepage! })));
    if (!listing.official) actions.append(el('span', 'tessera-market-from', listing.name ?? listing.url.replace('https://github.com/', '')));
    box.append(head, desc, actions);
    return box;
  }

  function renderGrid() {
    if (loading) return grid.replaceChildren(el('div', 'atrium-empty is-boxed', t('marketplace.loading')));
    const cards = listings.flatMap((listing) =>
      listing.plugins
        .filter((e) => !query || `${e.name} ${e.author} ${e.description} ${e.id}`.toLowerCase().includes(query))
        .map((entry) => card(entry, listing)),
    );
    grid.replaceChildren(...(cards.length ? cards : [el('div', 'atrium-empty is-boxed', t('marketplace.empty'))]));
  }

  function render() {
    renderSources();
    renderGrid();
  }

  return { refresh, render };
}
