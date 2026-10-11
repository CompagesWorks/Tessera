import type { InstalledPlugin } from '@tessera/protocol';
import type { AppContext } from '../../app/context';
import { required } from '../../components/dom';
import { hueOf } from '../../components/project-card/project-card';
import { applyTranslations, t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import { installedPlugins, loadPlugins } from '../../plugins/loader';
import { permissionRow } from '../../plugins/permissions';
import { allWidgets } from '../../widgets/registry';
import type { Page } from '../types';
import { installDialog } from './install-dialog';
import './plugins.css';
import template from './plugins.html?raw';

const CORE = '__core__';

let rerender: (() => void) | null = null;

function badge(text: string, tone: string) {
  const el = document.createElement('span');
  el.className = `atrium-badge ${tone}`;
  el.textContent = text;
  return el;
}

function icon(name: string, seed: string, className = 'tessera-plugin-icon') {
  const el = document.createElement('span');
  el.className = className;
  el.style.setProperty('--_hue', String(seed === CORE ? 225 : hueOf(seed)));
  el.innerHTML = `<i class="bi bi-${name}"></i>`;
  return el;
}

function switchInput(checked: boolean, onChange: (checked: boolean) => void) {
  const label = document.createElement('label');
  label.className = 'atrium-switch';
  label.addEventListener('click', (event) => event.stopPropagation());
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const slider = document.createElement('span');
  slider.className = 'atrium-switch-slider';
  label.append(input, slider);
  return label;
}

export const pluginsPage: Page = {
  id: 'plugins',
  icon: 'puzzle',
  label: 'nav.plugins',
  template,
  mount(root, ctx: AppContext) {
    const { ui } = ctx;
    applyTranslations(root);
    const list = required<HTMLElement>(root, '[data-list]');
    const detail = required<HTMLElement>(root, '[data-detail]');
    let selected = CORE;

    const attempt = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (error) {
        ui.toast('error', errorMessage(error));
      }
      await loadPlugins();
      render();
    };

    function row(id: string, name: string, meta: string, iconName: string, plugin?: InstalledPlugin) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tessera-plugin-row';
      button.classList.toggle('is-selected', id === selected);
      button.classList.toggle('is-off', plugin ? !plugin.enabled : false);
      const text = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'tessera-plugin-name';
      title.append(name, plugin ? badge(t('plugins.trustLocal'), 'atrium-badge-warning') : badge(t('plugins.trustBuiltin'), 'atrium-badge-neutral'));
      const sub = document.createElement('div');
      sub.className = 'tessera-plugin-meta';
      sub.textContent = meta;
      text.append(title, sub);
      button.append(icon(iconName, id), text);
      if (plugin) button.append(switchInput(plugin.enabled, (enabled) => void attempt(() => window.tessera.invoke('plugins:set-enabled', { id, enabled }))));
      button.addEventListener('click', () => {
        selected = id;
        render();
      });
      return button;
    }

    function widgetBadges(names: string[]) {
      const wrap = document.createElement('div');
      wrap.className = 'tessera-plugin-widgets';
      for (const name of names) wrap.append(badge(name, 'atrium-badge-neutral'));
      return wrap;
    }

    function heading(key: Parameters<typeof t>[0]) {
      const h = document.createElement('h3');
      h.textContent = t(key);
      return h;
    }

    function renderCore() {
      const head = document.createElement('div');
      head.className = 'tessera-plugin-head';
      const title = document.createElement('div');
      const h2 = document.createElement('h2');
      h2.textContent = 'Tessera';
      const meta = document.createElement('div');
      meta.className = 'tessera-plugin-meta';
      meta.textContent = t('plugins.coreMeta', { version: ctx.info.version });
      title.append(h2, meta);
      head.append(icon('grid-1x2-fill', CORE), title);
      const desc = document.createElement('p');
      desc.className = 'tessera-plugin-desc';
      desc.textContent = t('plugins.coreDescription');
      detail.replaceChildren(
        head,
        desc,
        heading('plugins.widgets'),
        widgetBadges(allWidgets().filter((w) => w.trust === 'builtin').map((w) => w.title())),
      );
    }

    function renderPlugin(plugin: InstalledPlugin) {
      const { manifest } = plugin;
      const head = document.createElement('div');
      head.className = 'tessera-plugin-head';
      const title = document.createElement('div');
      const h2 = document.createElement('h2');
      h2.textContent = manifest.name;
      const meta = document.createElement('div');
      meta.className = 'tessera-plugin-meta';
      meta.textContent = `${manifest.author} · v${manifest.version}`;
      title.append(h2, meta);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'atrium-btn atrium-btn-secondary';
      remove.innerHTML = '<i class="bi bi-trash3"></i>';
      remove.append(t('plugins.remove'));
      remove.addEventListener('click', async () => {
        const ok = await ui.atrium.modal.confirm({
          title: t('plugins.removeTitle', { name: manifest.name }),
          message: t('plugins.removeMessage'),
          confirmText: t('plugins.remove'),
          cancelText: t('dialog.cancel'),
          danger: true,
        });
        if (!ok) return;
        selected = CORE;
        await attempt(() => window.tessera.invoke('plugins:remove', { id: manifest.id }));
      });
      head.append(icon(manifest.icon, manifest.id), title, remove);

      const desc = document.createElement('p');
      desc.className = 'tessera-plugin-desc';
      desc.textContent = manifest.description || t('plugins.noDescription');

      const permissions: HTMLElement[] = manifest.permissions.length
        ? manifest.permissions.map((permission) =>
            permissionRow(permission, {
              checked: plugin.granted.includes(permission),
              onChange: (checked) => {
                const granted = checked ? [...plugin.granted, permission] : plugin.granted.filter((p) => p !== permission);
                void attempt(() => window.tessera.invoke('plugins:set-grants', { id: manifest.id, granted }));
              },
            }),
          )
        : [Object.assign(document.createElement('div'), { className: 'atrium-empty is-boxed', textContent: t('plugins.noPermission') })];

      const info = document.createElement('div');
      info.className = 'tessera-plugin-info';
      const pairs: Array<[string, string]> = [
        [t('plugins.id'), manifest.id],
        [t('plugins.folder'), plugin.path],
        [t('plugins.sandbox'), t('plugins.sandboxValue')],
      ];
      for (const [k, v] of pairs) {
        const key = document.createElement('span');
        key.textContent = k;
        const value = document.createElement('span');
        const code = document.createElement('code');
        code.textContent = v;
        value.append(code);
        info.append(key, value);
      }

      detail.replaceChildren(
        head,
        desc,
        heading('plugins.widgets'),
        widgetBadges(manifest.contributes.widgets.map((w) => w.title)),
        heading('plugins.permissions'),
        ...permissions,
        heading('plugins.info'),
        info,
      );
    }

    function render() {
      const plugins = installedPlugins();
      if (selected !== CORE && !plugins.some((p) => p.manifest.id === selected)) selected = CORE;
      list.replaceChildren(
        row(CORE, 'Tessera', t('plugins.builtinMeta'), 'grid-1x2-fill'),
        ...plugins.map((p) => row(p.manifest.id, p.manifest.name, `${p.manifest.author} · v${p.manifest.version}`, p.manifest.icon, p)),
      );
      const plugin = plugins.find((p) => p.manifest.id === selected);
      if (plugin) renderPlugin(plugin);
      else renderCore();
    }

    required(root, '[data-load-local]').addEventListener('click', async () => {
      const inspected = await window.tessera.invoke('plugins:inspect-local');
      if (!inspected) return;
      if ('error' in inspected) {
        await ui.atrium.modal.alert({ title: t('plugins.invalidTitle'), message: inspected.error, tone: 'danger' });
        return;
      }
      const granted = await installDialog(ui, inspected.manifest);
      if (!granted) return;
      selected = inspected.manifest.id;
      await attempt(() => window.tessera.invoke('plugins:install-local', { path: inspected.path, granted }));
      ui.toast('success', t('plugins.installed', { name: inspected.manifest.name }));
    });

    rerender = render;
    render();
  },
  onLanguageChange(root) {
    applyTranslations(root);
    rerender?.();
  },
};
