import type { GameSettings, Language } from '@tessera/protocol';
import '../components/dialogs/dialogs.css';
import { getLanguage, t, type MessageKey } from '../i18n';
import type { AppContext } from './context';
import './welcome.css';

const SEEN = 'tessera.welcomed';

function seen() {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN, '1');
  } catch {}
}

function heading(text: string) {
  return Object.assign(document.createElement('h4'), { className: 'tessera-welcome-heading', textContent: text });
}

let opener: (() => void) | null = null;

export function showWelcome() {
  opener?.();
}

export function startWelcome(ctx: AppContext, createProject: () => Promise<void>, auto: boolean) {
  let reopen = false;
  window.tessera.on('settings:changed', () => {
    if (!reopen) return;
    reopen = false;
    open();
  });

  function folder(key: 'ryujinx' | 'sdMods', title: MessageKey, game: GameSettings) {
    const row = document.createElement('div');
    row.className = 'tessera-welcome-folder';
    const text = document.createElement('div');
    const name = Object.assign(document.createElement('b'), { textContent: t(title) });
    const path = Object.assign(document.createElement('small'), { textContent: game[key] ?? t('settings.game.unset') });
    text.append(name, path);
    const pick = Object.assign(document.createElement('button'), { type: 'button', className: 'atrium-btn atrium-btn-secondary', textContent: t('settings.change') });
    pick.addEventListener('click', async () => {
      const picked = await window.tessera.invoke('app:pick-folder', { title: t(title) });
      if (!picked) return;
      const settings = await window.tessera.invoke('settings:get');
      await window.tessera.invoke('settings:update', { game: { ...settings.game, [key]: picked } });
      path.textContent = picked;
    });
    row.append(text, pick);
    return row;
  }

  async function open() {
    const settings = await window.tessera.invoke('settings:get');
    const body = document.createElement('div');
    body.className = 'tessera-form tessera-welcome';
    const intro = Object.assign(document.createElement('p'), { textContent: t('welcome.intro') });
    const widgets = Object.assign(document.createElement('p'), { textContent: t('welcome.widgets') });
    const languages = document.createElement('div');
    languages.className = 'tessera-chip-list';
    for (const [value, label] of [['fr', 'Français'], ['en', 'English']] as [Language, string][]) {
      const chip = Object.assign(document.createElement('button'), { type: 'button', className: 'atrium-chip-btn', textContent: label });
      chip.classList.toggle('is-active', value === getLanguage());
      chip.addEventListener('click', () => {
        if (value === getLanguage()) return;
        reopen = true;
        void modal.close();
        void window.tessera.invoke('settings:update', { language: value });
      });
      languages.append(chip);
    }
    const note = Object.assign(document.createElement('p'), { className: 'tessera-form-hint', textContent: t('welcome.note') });
    body.append(
      intro,
      widgets,
      heading(t('settings.language')),
      languages,
      heading(t('welcome.testing')),
      folder('ryujinx', 'settings.game.ryujinx', settings.game),
      folder('sdMods', 'settings.game.sdMods', settings.game),
      note,
    );
    const modal = ctx.ui.atrium.modal.open({
      title: t('welcome.title'),
      icon: 'stars',
      body,
      clickOverlayToClose: false,
      buttons: [
        { text: t('welcome.skip'), variant: 'cancel' },
        {
          text: t('welcome.create'),
          variant: 'primary',
          onClick: () => {
            setTimeout(() => void createProject());
            return true;
          },
        },
      ],
    });
  }

  opener = () => void open();
  if (!auto || seen() || ctx.store.current.projects.length > 0) return;
  markSeen();
  void open();
}
