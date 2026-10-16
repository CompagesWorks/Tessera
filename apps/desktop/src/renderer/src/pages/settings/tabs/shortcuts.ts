import { renderShortcut } from 'atrium-ui';
import { ShortcutSchema } from '@tessera/protocol';
import { commandCatalog } from '../../../commands/core';
import { t } from '../../../i18n';
import { button, group, row, section } from '../controls';
import type { SettingsTab, TabContext } from './types';

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIERS.has(event.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (/^F\d{1,2}$/.test(event.key)) key = event.key;
  else if (event.key.length === 1) key = event.key;
  else key = event.key;
  const parts = [event.ctrlKey || event.metaKey ? 'Mod' : null, event.altKey ? 'Alt' : null, event.shiftKey ? 'Shift' : null, key].filter(Boolean);
  const value = parts.join('+');
  if (!/^F\d{1,2}$/.test(key) && !event.ctrlKey && !event.metaKey && !event.altKey) return null;
  return ShortcutSchema.safeParse(value).success ? value : null;
}

function keys(shortcut: string | undefined): HTMLElement {
  if (!shortcut) {
    const none = document.createElement('span');
    none.className = 'tessera-set-muted';
    none.textContent = t('settings.noShortcut');
    return none;
  }
  return renderShortcut(shortcut);
}

function capture({ ui, settings, update }: TabContext, id: string, current: (id: string) => string | undefined, trigger: HTMLButtonElement) {
  const original = trigger.textContent;
  trigger.textContent = t('settings.pressKeys');
  trigger.classList.add('is-recording');
  const stop = () => {
    window.removeEventListener('keydown', onKey, true);
    trigger.textContent = original;
    trigger.classList.remove('is-recording');
  };
  const onKey = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') return stop();
    const combo = shortcutFromEvent(event);
    if (!combo) {
      if (!MODIFIERS.has(event.key)) ui.toast('warning', t('settings.shortcutNeedsModifier'));
      return;
    }
    stop();
    const clash = commandCatalog().find((c) => c.id !== id && current(c.id) === combo);
    if (clash) {
      ui.toast('error', t('settings.shortcutTaken', { command: clash.title }));
      return;
    }
    void update({ shortcuts: { ...settings.shortcuts, [id]: combo } });
  };
  window.addEventListener('keydown', onKey, true);
}

export const shortcutsTab: SettingsTab = {
  id: 'shortcuts',
  icon: 'keyboard',
  label: 'settings.tab.shortcuts',
  render(ctx) {
    const { settings, update } = ctx;
    const current = (id: string) => {
      if (id in settings.shortcuts) return settings.shortcuts[id] ?? undefined;
      return commandCatalog().find((c) => c.id === id)?.shortcut;
    };
    const sections = new Map<string, HTMLElement[]>();
    for (const command of commandCatalog()) {
      const changed = command.id in settings.shortcuts;
      const change = button(t('settings.change'), 'pencil', () => capture(ctx, command.id, current, change));
      const controls: Array<HTMLElement> = [keys(current(command.id)), change];
      if (changed) {
        controls.push(
          button(t('settings.default'), 'arrow-counterclockwise', () => {
            const next = { ...settings.shortcuts };
            delete next[command.id];
            void update({ shortcuts: next });
          }),
        );
      } else if (command.shortcut) {
        controls.push(button(t('settings.removeShortcut'), 'x-lg', () => void update({ shortcuts: { ...settings.shortcuts, [command.id]: null } })));
      }
      const line = row(command.title, null, ...controls);
      line.querySelector('b')?.insertAdjacentHTML('afterbegin', `<i class="bi bi-${command.icon} tessera-set-icon"></i>`);
      const list = sections.get(command.section) ?? [];
      list.push(line);
      sections.set(command.section, list);
    }
    return [
      group('command', t('settings.group.palette')),
      section(row(t('settings.openPalette'), t('settings.openPaletteHint'), keys('Mod+K'))),
      ...[...sections].flatMap(([name, rows]) => [group('keyboard', name), section(...rows)]),
      ...(Object.keys(settings.shortcuts).length
        ? [Object.assign(button(t('settings.resetShortcuts'), 'arrow-counterclockwise', () => void update({ shortcuts: {} })), { className: 'atrium-btn atrium-btn-secondary tessera-set-after' })]
        : []),
    ];
  },
};
