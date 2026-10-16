import type { Settings, SettingsPatch } from '@tessera/protocol';
import { required } from '../../components/dom';
import { applyTranslations, t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import type { Page } from '../types';
import { aboutTab } from './tabs/about';
import { advancedTab } from './tabs/advanced';
import { appearanceTab } from './tabs/appearance';
import { accountsTab } from './tabs/accounts';
import { backupsTab } from './tabs/backups';
import { gameTab } from './tabs/game';
import { generalTab } from './tabs/general';
import { journalTab } from './tabs/journal';
import { pluginSettingsTab } from './tabs/plugin-settings';
import { securityTab } from './tabs/security';
import { shortcutsTab } from './tabs/shortcuts';
import type { SettingsTab, TabContext } from './tabs/types';
import './settings.css';
import template from './settings.html?raw';

const TABS: SettingsTab[] = [
  generalTab,
  appearanceTab,
  shortcutsTab,
  securityTab,
  pluginSettingsTab,
  journalTab,
  gameTab,
  accountsTab,
  backupsTab,
  advancedTab,
  aboutTab,
];

let open: ((id: string) => void) | null = null;
let rerender: (() => void) | null = null;

export function openSettingsTab(id: string) {
  open?.(id);
}

function matches(element: Element, query: string) {
  return (element.textContent ?? '').toLowerCase().includes(query);
}

export const settingsPage: Page = {
  id: 'settings',
  icon: 'gear',
  label: 'nav.settings',
  bottom: true,
  template,
  mount(root, { ui, info }) {
    applyTranslations(root);
    const tabsBox = required<HTMLElement>(root, '[data-tabs]');
    const bottomBox = required<HTMLElement>(root, '[data-bottom-tabs]');
    const body = required<HTMLElement>(root, '[data-body]');
    const search = required<HTMLInputElement>(root, '[data-search]');
    let settings: Settings | null = null;
    let current = TABS[0]!.id;

    const update = async (patch: SettingsPatch) => {
      try {
        settings = await window.tessera.invoke('settings:update', patch);
      } catch (error) {
        ui.toast('error', errorMessage(error));
        render();
      }
    };
    const context = (): TabContext => ({ ui, info, settings: settings!, update, rerender: render, openTab: (id) => open?.(id) });

    function renderNav() {
      const button = (tab: SettingsTab) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'tessera-set-tab';
        el.classList.toggle('is-on', tab.id === current && !search.value.trim());
        el.innerHTML = `<i class="bi bi-${tab.icon}"></i>`;
        el.append(t(tab.label));
        el.addEventListener('click', () => {
          search.value = '';
          current = tab.id;
          render();
        });
        return el;
      };
      tabsBox.replaceChildren(...TABS.filter((tab) => !tab.bottom).map(button));
      bottomBox.replaceChildren(...TABS.filter((tab) => tab.bottom).map(button));
    }

    function page(tab: SettingsTab) {
      const wrap = document.createElement('div');
      wrap.className = 'tessera-set-page';
      wrap.dataset['tab'] = tab.id;
      const title = document.createElement('h2');
      title.className = 'tessera-set-title';
      title.textContent = t(tab.label);
      wrap.append(title, ...tab.render(context()));
      return wrap;
    }

    function render() {
      renderNav();
      if (!settings) return;
      const scroll = body.scrollTop;
      const query = search.value.trim().toLowerCase();
      if (!query) {
        body.replaceChildren(page(TABS.find((tab) => tab.id === current) ?? TABS[0]!));
        body.scrollTop = scroll;
        return;
      }
      const pages = TABS.map(page);
      let found = 0;
      for (const wrap of pages) {
        for (const extra of wrap.querySelectorAll('.tessera-set-after')) extra.toggleAttribute('hidden', true);
        for (const row of wrap.querySelectorAll('.tessera-set-row')) {
          const hit = matches(row, query);
          row.toggleAttribute('hidden', !hit);
          if (hit) found++;
        }
        for (const section of wrap.querySelectorAll('.tessera-set-section')) {
          const empty = ![...section.children].some((child) => !child.hasAttribute('hidden'));
          section.toggleAttribute('hidden', empty);
          const previous = section.previousElementSibling;
          if (previous?.classList.contains('tessera-set-group')) previous.toggleAttribute('hidden', empty);
        }
        wrap.toggleAttribute('hidden', !wrap.querySelector('.tessera-set-row:not([hidden])'));
      }
      const empty = document.createElement('div');
      empty.className = 'atrium-empty is-boxed';
      empty.textContent = t('settings.noResult');
      body.replaceChildren(...pages, ...(found ? [] : [empty]));
    }

    search.addEventListener('input', render);
    open = (id) => {
      search.value = '';
      current = TABS.some((tab) => tab.id === id) ? id : TABS[0]!.id;
      render();
    };
    rerender = render;

    void window.tessera.invoke('settings:get').then((value) => {
      settings = value;
      render();
    });
    window.tessera.on('settings:changed', (value) => {
      settings = value;
      render();
    });
    render();
  },
  onLanguageChange(root) {
    applyTranslations(root);
    rerender?.();
  },
};
