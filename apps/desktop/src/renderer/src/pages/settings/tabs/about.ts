import type { UpdateInfo } from '@tessera/protocol';
import { checkUpdates, openRelease, updateSummary } from '../../../app/updates';
import { showWelcome } from '../../../app/welcome';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import { logoImage } from '../../../shell/shell';
import { button, group, row, section, toggle } from '../controls';
import type { SettingsTab } from './types';

const ATRIUM_URL = 'https://github.com/CompagesWorks/Atrium-UI';
const DISCORD_URL = 'https://discord.gg/2zT5Rg46bG';

const LICENSES: Array<[string, string]> = [
  ['Atrium-UI', 'CompagesWorks'],
  ['Tauri', 'MIT / Apache-2.0'],
  ['Bootstrap Icons', 'MIT · © The Bootstrap Authors'],
  ['zod', 'MIT'],
  ['marked', 'MIT'],
  ['DOMPurify', 'Apache-2.0 / MPL-2.0'],
];

export const aboutTab: SettingsTab = {
  id: 'about',
  icon: 'info-circle',
  label: 'settings.tab.about',
  bottom: true,
  render({ info, settings, update }) {
    const head = document.createElement('div');
    head.className = 'tessera-set-about';
    const title = document.createElement('h2');
    title.textContent = 'Tessera';
    const version = document.createElement('p');
    version.textContent = t('about.version', { version: info.version, tauri: info.tauri });
    const versions = document.createElement('small');
    versions.textContent = `WebView ${info.webview} · ${info.platform}`;
    const team = document.createElement('p');
    team.textContent = t('about.team');
    head.append(logoImage('tessera-about-logo'), title, team, version, versions);

    const credit = document.createElement('button');
    credit.type = 'button';
    credit.className = 'tessera-set-credit';
    credit.innerHTML = '<i class="bi bi-grid-1x2-fill"></i>';
    const text = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = t('about.credit');
    const link = document.createElement('span');
    link.textContent = 'github.com/CompagesWorks/Atrium-UI';
    text.append(b, link);
    credit.append(text);
    credit.addEventListener('click', () => void window.tessera.invoke('app:open-external', { url: ATRIUM_URL }));

    const status = document.createElement('span');
    status.textContent = t('updates.idle');
    let found: UpdateInfo | null = null;
    const view = button(t('updates.view'), 'box-arrow-up-right', () => found && openRelease(found));
    view.hidden = true;
    const check = button(t('updates.check'), 'arrow-repeat', async () => {
      check.disabled = true;
      status.textContent = t('updates.checking');
      try {
        found = await checkUpdates();
        status.textContent = updateSummary(found);
        view.hidden = !(found.available && found.url);
      } catch (error) {
        status.textContent = errorMessage(error);
      } finally {
        check.disabled = false;
      }
    });

    const discord = button(t('about.discordButton'), 'discord', () => void window.tessera.invoke('app:open-external', { url: DISCORD_URL }), 'primary');

    return [head, credit, section(row(t('about.discord'), t('about.discordHint'), discord)), group('arrow-repeat', t('settings.group.updates')),
      section(
        row(t('updates.check'), status, check, view),
        row(t('updates.auto'), t('updates.autoHint'), toggle(settings.updates.auto, (on) => void update({ updates: { auto: on } }))),
      ),
      section(row(t('welcome.replay'), t('welcome.replayHint'), button(t('welcome.replayButton'), 'stars', showWelcome))),
      group('file-earmark-text', t('settings.group.licenses')), section(...LICENSES.map(([name, license]) => row(name, license)))];
  },
};
