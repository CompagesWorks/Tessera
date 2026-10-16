import { PERMISSION_RISK, type Permission, type PluginManifest } from '@tessera/protocol';
import { t, type MessageKey } from '../i18n';

interface PermissionInfo {
  icon: string;
  label: MessageKey;
  description: MessageKey;
}

export const PERMISSION_INFO: Record<Permission, PermissionInfo> = {
  'fs.project.read': { icon: 'folder2-open', label: 'permission.fsProjectRead', description: 'permission.fsProjectReadDesc' },
  'fs.project.write': { icon: 'pencil-square', label: 'permission.fsProjectWrite', description: 'permission.fsProjectWriteDesc' },
  'fs.external': { icon: 'folder-symlink', label: 'permission.fsExternal', description: 'permission.fsExternalDesc' },
  net: { icon: 'globe2', label: 'permission.net', description: 'permission.netDesc' },
  secrets: { icon: 'key', label: 'permission.secrets', description: 'permission.secretsDesc' },
  'ui.theme': { icon: 'palette', label: 'permission.uiTheme', description: 'permission.uiThemeDesc' },
  'ui.provider': { icon: 'window-stack', label: 'permission.uiProvider', description: 'permission.uiProviderDesc' },
  exec: { icon: 'terminal', label: 'permission.exec', description: 'permission.execDesc' },
  'exec.system': { icon: 'terminal-plus', label: 'permission.execSystem', description: 'permission.execSystemDesc' },
  'discord.rpc': { icon: 'discord', label: 'permission.discordRpc', description: 'permission.discordRpcDesc' },
  'clipboard.write': { icon: 'clipboard-check', label: 'permission.clipboardWrite', description: 'permission.clipboardWriteDesc' },
  'notify.system': { icon: 'bell', label: 'permission.notifySystem', description: 'permission.notifySystemDesc' },
  'open.external': { icon: 'box-arrow-up-right', label: 'permission.openExternal', description: 'permission.openExternalDesc' },
  'projects.list': { icon: 'collection', label: 'permission.projectsList', description: 'permission.projectsListDesc' },
};

const RISK_LABEL: Record<string, MessageKey> = { low: 'permission.riskLow', medium: 'permission.riskMedium', high: 'permission.riskHigh' };

function detailOf(permission: Permission, manifest?: PluginManifest): string | null {
  if (!manifest) return null;
  if (permission === 'net') return t('permission.netDomains', { list: manifest.network.join(', ') });
  if (permission === 'exec' && manifest.exec) return t('permission.execProgram', { program: manifest.exec.program, hash: manifest.exec.sha256.slice(0, 16) });
  if (permission === 'exec.system') return t('permission.execSystemPrograms', { list: manifest.systemPrograms.join(', ') });
  if (permission === 'discord.rpc') return t('permission.discordClient', { id: manifest.discordClientId ?? '' });
  return null;
}

export function permissionRow(
  permission: Permission,
  toggle?: { checked: boolean; onChange(checked: boolean): void },
  manifest?: PluginManifest,
): HTMLElement {
  const info = PERMISSION_INFO[permission];
  const level = PERMISSION_RISK[permission];
  const row = document.createElement('div');
  row.className = `tessera-permission is-${level}`;
  const icon = document.createElement('span');
  icon.className = 'tessera-permission-icon';
  icon.innerHTML = `<i class="bi bi-${info.icon}"></i>`;
  const text = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = t(info.label);
  const code = document.createElement('code');
  code.textContent = ` ${permission}`;
  const risk = document.createElement('span');
  risk.className = `tessera-permission-risk is-${level}`;
  risk.textContent = t(RISK_LABEL[level]!);
  const small = document.createElement('small');
  small.textContent = t(info.description);
  text.append(title, code, risk, small);
  const detail = detailOf(permission, manifest);
  if (detail) {
    const extra = document.createElement('small');
    extra.className = 'tessera-permission-detail';
    extra.textContent = detail;
    text.append(extra);
  }
  row.append(icon, text);
  if (toggle) {
    const label = document.createElement('label');
    label.className = 'atrium-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = toggle.checked;
    input.addEventListener('change', () => toggle.onChange(input.checked));
    const slider = document.createElement('span');
    slider.className = 'atrium-switch-slider';
    label.append(input, slider);
    row.append(label);
  }
  return row;
}
