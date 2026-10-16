import type { InstalledPlugin, Permission } from '@tessera/protocol';
import { fromTemplate, required } from '../../components/dom';
import { t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import type { UiProvider } from '../../ui/provider';
import { clearLab, labDenied, labLog, labTrace, liveFrames, onLabChange, reloadPluginFrames, setSimulatedDenial } from '../bridge';
import { installedPlugins, loadPlugins } from '../loader';
import './lab.css';
import template from './lab.html?raw';

type Tab = 'console' | 'calls' | 'permissions' | 'manifest';
const TABS: Tab[] = ['console', 'calls', 'permissions', 'manifest'];

const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour12: false });

function empty(text: string) {
  const p = document.createElement('p');
  p.className = 'tessera-lab-empty';
  p.textContent = text;
  return p;
}

function fact(label: string, value: string) {
  const row = document.createElement('div');
  row.className = 'tessera-lab-fact';
  const b = document.createElement('b');
  b.textContent = label;
  const span = document.createElement('span');
  span.textContent = value;
  row.append(b, span);
  return row;
}

export function openPluginLab(ui: UiProvider, pluginId?: string) {
  const plugins = () => installedPlugins();
  if (!plugins().length) {
    ui.toast('info', t('lab.noPlugins'));
    return;
  }
  const root = fromTemplate(template);
  const select = required<HTMLSelectElement>(root, '[data-plugin]');
  const tabsBox = required<HTMLElement>(root, '[data-tabs]');
  const live = required<HTMLElement>(root, '[data-live]');
  const body = required<HTMLElement>(root, '[data-body]');
  const clear = required<HTMLButtonElement>(root, '[data-clear]');

  const sorted = [...plugins()].sort((a, b) => Number(b.mode === 'dev') - Number(a.mode === 'dev') || a.manifest.name.localeCompare(b.manifest.name));
  for (const plugin of sorted) select.append(new Option(`${plugin.manifest.name}${plugin.mode === 'dev' ? ' · dev' : ''}`, plugin.manifest.id));
  let selected = pluginId && sorted.some((p) => p.manifest.id === pluginId) ? pluginId : sorted[0]!.manifest.id;
  select.value = selected;
  let tab: Tab = 'console';

  ui.atrium.select(select, {
    onChange: (value) => {
      selected = value;
      render();
    },
  });
  const segmentHost = document.createElement('div');
  tabsBox.append(segmentHost);
  ui.atrium.segmented(segmentHost, {
    value: tab,
    label: t('lab.title'),
    options: TABS.map((value) => ({ value, label: t(`lab.tab.${value}`) })),
    onChange: (value) => {
      tab = value as Tab;
      render();
    },
  });

  const plugin = (): InstalledPlugin | undefined => plugins().find((p) => p.manifest.id === selected);

  function renderConsole() {
    const logs = labLog(selected);
    if (!logs.length) return body.replaceChildren(empty(liveFrames(selected) ? t('lab.noLogs') : t('lab.noFrames')));
    body.replaceChildren(
      ...logs.map((log) => {
        const row = document.createElement('div');
        row.className = `tessera-lab-log${log.level === 'error' ? ' is-error' : log.level === 'warn' ? ' is-warn' : ''}`;
        const time = document.createElement('small');
        time.textContent = clock(log.time);
        const level = document.createElement('span');
        level.textContent = log.level;
        const text = document.createElement('span');
        text.textContent = log.text;
        row.append(time, level, text);
        return row;
      }),
    );
    body.scrollTop = body.scrollHeight;
  }

  function renderCalls() {
    const calls = labTrace(selected);
    if (!calls.length) return body.replaceChildren(empty(t('lab.noCalls')));
    body.replaceChildren(
      ...calls.map((call) => {
        const row = document.createElement('div');
        row.className = 'tessera-lab-call';
        const time = document.createElement('small');
        time.textContent = clock(call.time);
        const method = document.createElement('span');
        method.textContent = call.method;
        const outcome = document.createElement('span');
        outcome.className = `is-${call.outcome}`;
        outcome.textContent = t(`lab.outcome.${call.outcome}`);
        const ms = document.createElement('small');
        ms.textContent = `${call.ms} ms`;
        const detail = document.createElement('small');
        detail.textContent = call.detail;
        row.append(time, method, outcome, ms, detail);
        return row;
      }),
    );
    body.scrollTop = body.scrollHeight;
  }

  function renderPermissions() {
    const current = plugin();
    if (!current) return body.replaceChildren(empty(t('lab.gone')));
    const declared = current.manifest.permissions;
    const denied = labDenied(selected);
    const rows = declared.map((permission: Permission) => {
      const granted = current.granted.includes(permission);
      const row = document.createElement('div');
      row.className = 'tessera-lab-perm';
      const code = document.createElement('code');
      code.textContent = permission;
      const state = document.createElement('span');
      state.textContent = !granted ? t('lab.notGranted') : denied.has(permission) ? t('lab.simulatedDenied') : t('lab.granted');
      const label = document.createElement('label');
      label.className = 'atrium-switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = denied.has(permission);
      input.disabled = !granted;
      input.addEventListener('change', () => setSimulatedDenial(selected, permission, input.checked));
      const slider = document.createElement('span');
      slider.className = 'atrium-switch-slider';
      label.append(input, slider);
      row.append(code, state, label);
      return row;
    });
    const note = document.createElement('p');
    note.className = 'tessera-lab-note';
    note.textContent = t('lab.permNote');
    body.replaceChildren(...(rows.length ? rows : [empty(t('lab.noPermissions'))]), note);
  }

  function renderManifest() {
    const current = plugin();
    if (!current) return body.replaceChildren(empty(t('lab.gone')));
    const { manifest } = current;
    const actions = document.createElement('div');
    actions.className = 'tessera-lab-actions';
    const verify = document.createElement('button');
    verify.type = 'button';
    verify.className = 'atrium-btn atrium-btn-secondary';
    verify.innerHTML = '<i class="bi bi-shield-check"></i> ';
    verify.append(t('lab.verify'));
    verify.addEventListener('click', async () => {
      try {
        const result = await window.tessera.invoke('plugins:verify', { id: selected });
        ui.toast(result.ok ? 'success' : 'error', result.ok ? t('lab.verifyOk') : t('lab.verifyFailed', { error: result.error ?? '' }));
        await loadPlugins();
        render();
      } catch (error) {
        ui.toast('error', errorMessage(error));
      }
    });
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'atrium-btn atrium-btn-primary';
    reload.innerHTML = '<i class="bi bi-arrow-clockwise"></i> ';
    reload.append(t('lab.reload'));
    reload.addEventListener('click', async () => {
      try {
        await window.tessera.invoke('plugins:verify', { id: selected });
        await loadPlugins();
        reloadPluginFrames(selected);
        ui.toast('success', t('lab.reloaded'));
        render();
      } catch (error) {
        ui.toast('error', errorMessage(error));
      }
    });
    actions.append(verify, reload);
    body.replaceChildren(
      fact('id', manifest.id),
      fact(t('lab.version'), manifest.version),
      fact(t('lab.mode'), current.mode === 'dev' ? t('lab.modeDev') : t('lab.modeInstalled')),
      fact(t('lab.integrity'), current.integrityError ? `${current.integrity} · ${current.integrityError}` : current.integrity),
      fact(t('lab.enabled'), current.enabled ? t('lab.yes') : t('lab.no')),
      fact(t('lab.requested'), manifest.permissions.join(', ') || '-'),
      fact(t('lab.grantedList'), current.granted.join(', ') || '-'),
      fact(t('lab.pending'), current.pending.join(', ') || '-'),
      fact(t('lab.widgets'), String(manifest.contributes.widgets.length)),
      fact(t('lab.themes'), String(manifest.contributes.themes.length)),
      fact(t('lab.settings'), String(manifest.contributes.settings.length)),
      actions,
    );
  }

  let frame = 0;
  function render() {
    const frames = liveFrames(selected);
    live.textContent = t('lab.live', { n: frames });
    live.classList.toggle('is-on', frames > 0);
    clear.hidden = tab !== 'console' && tab !== 'calls';
    if (tab === 'console') renderConsole();
    else if (tab === 'calls') renderCalls();
    else if (tab === 'permissions') renderPermissions();
    else renderManifest();
  }

  clear.addEventListener('click', () => clearLab(selected));
  const off = onLabChange(() => {
    if (tab === 'permissions' || tab === 'manifest') return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  });

  ui.atrium.modal.open({
    title: t('lab.title'),
    icon: 'bug',
    body: root,
    size: 'large',
    className: 'tessera-lab-modal',
    closeButton: true,
    buttons: [{ text: t('about.close'), variant: 'primary' }],
    onClose: () => {
      off();
      cancelAnimationFrame(frame);
    },
  });
  render();
}
