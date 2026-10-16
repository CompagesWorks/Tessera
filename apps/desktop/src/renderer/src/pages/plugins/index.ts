import { PACKAGE_EXTENSION, PERMISSION_RISK, type AuditEntry, type InstalledPlugin, type Settings } from '@tessera/protocol';
import type { AppContext } from '../../app/context';
import { required } from '../../components/dom';
import { iconElement, pluginIcon } from '../../components/icon';
import { hueOf } from '../../components/project-card/project-card';
import { applyTranslations, t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import { installedPlugins, loadPlugins } from '../../plugins/loader';
import { permissionRow } from '../../plugins/permissions';
import { allWidgets } from '../../widgets/registry';
import type { Page } from '../types';
import { pluginExtras } from './extras';
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
  el.append(iconElement(pluginIcon(seed, name)));
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
    let settings: Settings | null = null;

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
      title.append(name, plugin ? statusBadge(plugin) : badge(t('plugins.trustBuiltin'), 'atrium-badge-neutral'));
      if (plugin?.pending.length) title.append(badge(t('plugins.pendingBadge'), 'atrium-badge-warning'));
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

    function statusBadge(plugin: InstalledPlugin) {
      if (plugin.integrity === 'tampered') return badge(t('plugins.statusTampered'), 'atrium-badge-danger');
      if (plugin.integrity === 'dev') return badge(t('plugins.statusDev'), 'atrium-badge-warning');
      return badge(t('plugins.statusInstalled'), 'atrium-badge-success');
    }

    function banner(text: string, icon: string, actions: HTMLElement[] = []) {
      const box = document.createElement('div');
      box.className = 'tessera-plugin-warning';
      box.innerHTML = `<i class="bi bi-${icon}"></i>`;
      const span = document.createElement('span');
      span.textContent = text;
      const wrap = document.createElement('div');
      wrap.className = 'tessera-plugin-banner-body';
      wrap.append(span);
      if (actions.length) {
        const row = document.createElement('div');
        row.className = 'tessera-plugin-banner-actions';
        row.append(...actions);
        wrap.append(row);
      }
      box.append(wrap);
      return box;
    }

    function actionButton(label: string, icon: string, primary: boolean, onClick: () => void) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `atrium-btn ${primary ? 'atrium-btn-primary' : 'atrium-btn-secondary'}`;
      button.innerHTML = `<i class="bi bi-${icon}"></i>`;
      button.append(label);
      button.addEventListener('click', onClick);
      return button;
    }

    async function installFrom(path?: string, defaultMode: 'installed' | 'dev' = 'installed') {
      const inspected = await window.tessera.invoke('plugins:inspect-local', path ? { path } : undefined);
      if (!inspected) return;
      if ('error' in inspected) {
        await ui.atrium.modal.alert({ title: t('plugins.invalidTitle'), message: inspected.error, tone: 'danger' });
        return;
      }
      const choice = await installDialog(ui, inspected.manifest, defaultMode);
      if (!choice) return;
      selected = inspected.manifest.id;
      await attempt(() => window.tessera.invoke('plugins:install-local', { path: inspected.path, granted: choice.granted, mode: choice.mode }));
      ui.toast('success', t('plugins.installed', { name: inspected.manifest.name }));
    }

    async function installPackage(path?: string) {
      const inspected = await window.tessera.invoke('plugins:inspect-package', path ? { path } : undefined);
      if (!inspected) return;
      if ('error' in inspected) {
        await ui.atrium.modal.alert({ title: t('plugins.invalidTitle'), message: inspected.error, tone: 'danger' });
        return;
      }
      const choice = await installDialog(ui, inspected.manifest, 'installed', true);
      if (!choice) return;
      selected = inspected.manifest.id;
      await attempt(() => window.tessera.invoke('plugins:install-package', { token: inspected.token, granted: choice.granted }));
      ui.toast('success', t('plugins.installed', { name: inspected.manifest.name }));
    }

    function activityList(entries: AuditEntry[]) {
      if (entries.length === 0) {
        return Object.assign(document.createElement('div'), { className: 'atrium-empty is-boxed', textContent: t('plugins.noActivity') });
      }
      const list = document.createElement('div');
      list.className = 'tessera-activity';
      for (const entry of entries.slice(0, 30)) {
        const row = document.createElement('div');
        row.className = `tessera-activity-row ${entry.allowed ? '' : 'is-denied'}`;
        row.innerHTML = `<i class="bi bi-${entry.allowed ? 'check-circle' : 'x-octagon'}"></i>`;
        const action = document.createElement('code');
        action.textContent = entry.action;
        const target = document.createElement('span');
        target.className = 'tessera-activity-target';
        target.textContent = entry.target;
        const time = document.createElement('span');
        time.className = 'tessera-activity-time';
        time.textContent = new Date(entry.time).toLocaleTimeString();
        row.append(action, target, time);
        list.append(row);
      }
      return list;
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

      const banners: HTMLElement[] = [];
      if (plugin.integrity === 'tampered') {
        banners.push(
          banner(t('plugins.tamperedBanner', { reason: plugin.integrityError ?? '' }), 'shield-exclamation', [
            actionButton(t('plugins.reinstall'), 'arrow-repeat', true, () => void (plugin.source.endsWith(`.${PACKAGE_EXTENSION}`) ? installPackage(plugin.source) : installFrom(plugin.source))),
          ]),
        );
      }
      if (plugin.integrity === 'dev') banners.push(banner(t('plugins.devBanner'), 'link-45deg'));
      if (plugin.pending.length) {
        banners.push(
          banner(t('plugins.pendingBanner', { list: plugin.pending.join(', ') }), 'person-raised-hand', [
            actionButton(t('plugins.allow'), 'check-lg', true, () =>
              void attempt(() => window.tessera.invoke('plugins:set-grants', { id: manifest.id, granted: [...plugin.granted, ...plugin.pending] })),
            ),
            actionButton(t('plugins.deny'), 'x-lg', false, () =>
              void attempt(() => window.tessera.invoke('plugins:set-grants', { id: manifest.id, granted: plugin.granted })),
            ),
          ]),
        );
      }

      const activity = document.createElement('div');
      void window.tessera.invoke('plugins:activity', { id: manifest.id }).then((entries) => activity.replaceChildren(activityList(entries)));

      const permissions: HTMLElement[] = manifest.permissions.length
        ? manifest.permissions.map((permission) =>
            permissionRow(
              permission,
              {
                checked: plugin.granted.includes(permission),
                onChange: async (checked) => {
                  if (checked && PERMISSION_RISK[permission] === 'high') {
                    const ok = await ui.atrium.modal.confirm({
                      title: t('plugins.highRiskTitle', { permission }),
                      message: t(permission === 'ui.provider' ? 'plugins.providerWarning' : 'plugins.execWarning'),
                      confirmText: t('plugins.allow'),
                      cancelText: t('dialog.cancel'),
                      danger: true,
                    });
                    if (!ok) return render();
                  }
                  const granted = checked ? [...plugin.granted, permission] : plugin.granted.filter((p) => p !== permission);
                  void attempt(() => window.tessera.invoke('plugins:set-grants', { id: manifest.id, granted }));
                },
              },
              manifest,
            ),
          )
        : [Object.assign(document.createElement('div'), { className: 'atrium-empty is-boxed', textContent: t('plugins.noPermission') })];

      const info = document.createElement('div');
      info.className = 'tessera-plugin-info';
      const pairs: Array<[string, string]> = [
        [t('plugins.id'), manifest.id],
        [t('plugins.mode'), plugin.mode === 'installed' ? t('plugins.modeInstalled') : t('plugins.modeDev')],
        [t('plugins.folder'), plugin.path],
        ...(plugin.source !== plugin.path ? [[t('plugins.source'), plugin.source] as [string, string]] : []),
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
        ...banners,
        ...(manifest.contributes.widgets.length ? [heading('plugins.widgets'), widgetBadges(manifest.contributes.widgets.map((w) => w.title))] : []),
        heading('plugins.permissions'),
        ...permissions,
        ...(settings ? pluginExtras(plugin, { ui, settings, attempt }) : []),
        heading('plugins.activity'),
        activity,
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

    required(root, '[data-load-local]').addEventListener('click', () => void installFrom());
    required(root, '[data-load-package]').addEventListener('click', () => void installPackage());

    window.tessera.on('plugins:tampered', ({ id, reason }) => {
      ui.toast('error', t('plugins.tamperedToast', { id, reason }));
      void loadPlugins().then(render);
    });

    void window.tessera.invoke('settings:get').then((value) => {
      settings = value;
      render();
    });
    window.tessera.on('settings:changed', (value) => {
      settings = value;
      render();
    });

    rerender = render;
    render();
  },
  onLanguageChange(root) {
    applyTranslations(root);
    rerender?.();
  },
};
