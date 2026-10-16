import type { AccountService, InvokeRequest } from '@tessera/protocol';
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
      ? connectedRow('GitHub', t('settings.accounts.githubOn', { login: github.login }), () => void disconnect(ctx, 'github'), badge('GH', 'is-github'))
      : (() => {
          const el = row(
            'GitHub',
            t('settings.accounts.githubHint'),
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
          el.querySelector('.tessera-set-text b')?.prepend(badge('GH', 'is-github'));
          return el;
        })();

    const bananaRow = gamebanana
      ? connectedRow('GameBanana', t('settings.accounts.gamebananaOn', { name: gamebanana.name, id: gamebanana.memberId }), () => void disconnect(ctx, 'gamebanana'), badge('GB', 'is-gamebanana'))
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
            button(t('settings.accounts.findMember'), 'box-arrow-up-right', () => void window.tessera.invoke('app:open-external', { url: GAMEBANANA_URL })),
          );
          el.querySelector('.tessera-set-text b')?.prepend(badge('GB', 'is-gamebanana'));
          return el;
        })();

    const discordRow = row('Discord', t('settings.accounts.discordHint'));
    discordRow.querySelector('.tessera-set-text b')?.prepend(badge('DC', 'is-discord'));

    return [group('person-circle', t('settings.tab.accounts')), section(bananaRow, githubRow, discordRow), note(t('settings.accounts.note'))];
  },
};
