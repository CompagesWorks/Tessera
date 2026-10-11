import type { Permission } from '@tessera/protocol';
import { t, type MessageKey } from '../i18n';

interface PermissionInfo {
  level: 'low' | 'medium' | 'high';
  icon: string;
  label: MessageKey;
  description: MessageKey;
}

export const PERMISSION_INFO: Record<Permission, PermissionInfo> = {
  'fs.project.read': { level: 'low', icon: 'folder2-open', label: 'permission.fsProjectRead', description: 'permission.fsProjectReadDesc' },
};

export function permissionRow(permission: Permission, toggle?: { checked: boolean; onChange(checked: boolean): void }): HTMLElement {
  const info = PERMISSION_INFO[permission];
  const row = document.createElement('div');
  row.className = `tessera-permission is-${info.level}`;
  const icon = document.createElement('span');
  icon.className = 'tessera-permission-icon';
  icon.innerHTML = `<i class="bi bi-${info.icon}"></i>`;
  const text = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = t(info.label);
  const code = document.createElement('code');
  code.textContent = ` ${permission}`;
  const small = document.createElement('small');
  small.textContent = t(info.description);
  text.append(title, code, small);
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
