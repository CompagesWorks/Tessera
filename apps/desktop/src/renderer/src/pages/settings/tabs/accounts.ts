import type { AccountService, InvokeRequest } from '@tessera/protocol';
import gamebananaLogo from '../../../assets/gamebanana.png';
import '../../../components/dialogs/dialogs.css';
import { t, type MessageKey } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import { button, group, note, row, section } from '../controls';
import type { SettingsTab, TabContext } from './types';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const GAMEBANANA_URL = 'https://gamebanana.com/members';

function badge(letters: string, className: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `tessera-set-badge ${className}`;
  el.textContent = letters;
  return el;
}

function iconBadge(icon: string, className: string): HTMLElement {
  const el = badge('', className);
  el.append(Object.assign(document.createElement('i'), { className: `bi bi-${icon}` }));
  return el;
}

function gamebananaBadge(): HTMLElement {
  const el = badge('', 'is-gamebanana');
  el.append(Object.assign(document.createElement('img'), { src: gamebananaLogo, alt: '' }));
  return el;
}

async function connect({ ui }: TabContext, request: InvokeRequest<'accounts:connect'>, done: MessageKey) {
  try {
    await window.tessera.invoke('accounts:connect', request);
    ui.toast('success', t(done));
    return true;
  } catch (error) {
    ui.toast('error', errorMessage(error));
    return false;
  }
}

async function disconnect({ ui }: TabContext, service: AccountService) {
  try {
    await window.tessera.invoke('accounts:disconnect', { service });
    ui.toast('info', t('settings.accounts.disconnected'));
  } catch (error) {
    ui.toast('error', errorMessage(error));
  }
}

function field(label: string, input: HTMLInputElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'tessera-form-field';
  input.className = 'atrium-input';
  wrap.append(label, input);
  return wrap;
}

function gamebananaLogin(ctx: TabContext) {
  const username = document.createElement('input');
  username.autocomplete = 'username';
  const password = document.createElement('input');
  password.type = 'password';
  password.autocomplete = 'current-password';
  const code = document.createElement('input');
  code.autocomplete = 'one-time-code';
  code.inputMode = 'numeric';
  code.maxLength = 6;
  code.placeholder = t('settings.accounts.codeHint');
  const message = document.createElement('p');
  message.textContent = t('settings.accounts.gamebananaLoginMessage');
  const body = document.createElement('div');
  body.className = 'tessera-form';
  body.append(message, field(t('settings.accounts.username'), username), field(t('settings.accounts.password'), password), field(t('settings.accounts.code'), code));
  let busy = false;
  const submit = async () => {
    if (busy || !username.value.trim() || !password.value) return false;
    busy = true;
    const totp = code.value.trim();
    const done = await connect(ctx, { service: 'gamebanana-login', username: username.value, password: password.value, ...(totp ? { code: totp } : {}) }, 'settings.accounts.gamebananaDone');
    code.value = '';
    busy = false;
    return done;
  };
  ctx.ui.atrium.modal.open({
    title: t('settings.accounts.gamebananaLogin'),
    icon: 'key',
    body,
    clickOverlayToClose: false,
    buttons: [
      { text: t('dialog.cancel'), variant: 'cancel' },
      {
        text: t('settings.accounts.connect'),
        variant: 'primary',
        onClick: async (_event, modal) => {
          const done = await submit();
          if (!done) modal.shake();
          return done;
        },
      },
    ],
  });
  requestAnimationFrame(() => username.focus());
}

function connectedRow(title: string, description: string, onDisconnect: () => void, mark: HTMLElement): HTMLElement {
  const el = row(title, description, button(t('settings.accounts.disconnect'), 'box-arrow-right', onDisconnect));
  el.querySelector('.tessera-set-text b')?.prepend(mark);
  return el;
}

export const accountsTab: SettingsTab = {
  id: 'accounts',
  icon: 'person-circle',
  label: 'settings.tab.accounts',
  render(ctx) {
    const { ui, settings } = ctx;
    const { github, gamebanana } = settings.accounts;

    const githubRow = github
      ? connectedRow('GitHub', t('settings.accounts.githubOn', { login: github.login }), () => void disconnect(ctx, 'github'), iconBadge('github', 'is-github'))
      : (() => {
          const el = row(
            'GitHub',
            t('settings.accounts.githubSoon'),
            button(t('settings.accounts.connect'), 'box-arrow-in-right', async () => {
              const token = await ui.atrium.modal.prompt({
                title: t('settings.accounts.githubTitle'),
                message: t('settings.accounts.githubMessage'),
                label: t('settings.accounts.token'),
                icon: 'github',
                confirmText: t('settings.accounts.connect'),
                cancelText: t('dialog.cancel'),
                validate: (value) => (/^[A-Za-z0-9_]{20,255}$/.test(value.trim()) ? null : t('settings.accounts.tokenInvalid')),
              });
              if (token) await connect(ctx, { service: 'github', token }, 'settings.accounts.githubDone');
            }),
            button(t('settings.accounts.createToken'), 'box-arrow-up-right', () => void window.tessera.invoke('app:open-external', { url: TOKEN_URL })),
          );
          el.querySelector('.tessera-set-text b')?.prepend(iconBadge('github', 'is-github'));
          el.classList.add('is-unavailable');
          el.setAttribute('aria-disabled', 'true');
          for (const control of el.querySelectorAll('button')) control.disabled = true;
          return el;
        })();

    const bananaRow = gamebanana
      ? connectedRow('GameBanana', t('settings.accounts.gamebananaOn', { name: gamebanana.name, id: gamebanana.memberId }), () => void disconnect(ctx, 'gamebanana'), gamebananaBadge())
      : (() => {
          const el = row(
            'GameBanana',
            t('settings.accounts.gamebananaHint'),
            button(t('settings.accounts.connect'), 'box-arrow-in-right', async () => {
              const member = await ui.atrium.modal.prompt({
                title: t('settings.accounts.gamebananaTitle'),
                message: t('settings.accounts.gamebananaMessage'),
                label: t('settings.accounts.member'),
                placeholder: 'https://gamebanana.com/members/12345',
                icon: 'person-badge',
                confirmText: t('settings.accounts.connect'),
                cancelText: t('dialog.cancel'),
                validate: (value) => (/^(\d{1,9}|https:\/\/gamebanana\.com\/members\/\d{1,9}.*)$/i.test(value.trim()) ? null : t('settings.accounts.memberInvalid')),
              });
              if (member) await connect(ctx, { service: 'gamebanana', member }, 'settings.accounts.gamebananaDone');
            }),
            button(t('settings.accounts.gamebananaLogin'), 'key', () => gamebananaLogin(ctx)),
            button(t('settings.accounts.findMember'), 'box-arrow-up-right', () => void window.tessera.invoke('app:open-external', { url: GAMEBANANA_URL })),
          );
          el.querySelector('.tessera-set-text b')?.prepend(gamebananaBadge());
          return el;
        })();

    const discordRow = row('Discord', t('settings.accounts.discordHint'));
    discordRow.querySelector('.tessera-set-text b')?.prepend(iconBadge('discord', 'is-discord'));

    return [group('person-circle', t('settings.tab.accounts')), section(bananaRow, githubRow, discordRow), note(t('settings.accounts.note'))];
  },
};
