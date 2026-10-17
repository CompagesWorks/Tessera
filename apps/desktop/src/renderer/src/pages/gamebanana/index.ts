import type { GbComment, GbMember, GbOwnMod, Settings } from '@tessera/protocol';
import type { AppContext } from '../../app/context';
import { required } from '../../components/dom';
import { applyTranslations, t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import type { UiProvider } from '../../ui/provider';
import type { Page } from '../types';
import './gamebanana.css';
import template from './gamebanana.html?raw';
import { el, postCard, remoteImage } from './posts';

const MAX_THUMBNAILS = 24;

function open(url: string) {
  void window.tessera.invoke('app:open-external', { url });
}

function stat(icon: string, value: number) {
  const span = el('span', '');
  span.append(el('i', `bi bi-${icon}`), ` ${value.toLocaleString()}`);
  return span;
}

function modCard(mod: GbOwnMod, withThumbnail: boolean) {
  const card = el('button', 'tessera-gbp-mod');
  card.type = 'button';
  card.title = mod.name;
  card.addEventListener('click', () => open(mod.url));
  const thumb = el('div', 'tessera-gbp-thumb');
  if (mod.thumbnail && withThumbnail) thumb.append(remoteImage(mod.thumbnail, ''));
  const meta = el('div', 'tessera-gbp-meta');
  meta.append(stat('heart', mod.likes), stat('eye', mod.views), stat('chat', mod.comments));
  card.append(thumb, el('b', '', mod.name), el('small', '', mod.category), meta);
  return card;
}

function renderOverview(body: HTMLElement, data: GbMember, ui: UiProvider, showThread: (modId: number) => void) {
  const total = (key: 'likes' | 'views' | 'comments') => data.mods.reduce((sum, mod) => sum + mod[key], 0);
  const mods = el('section', '');
  const stats = el('div', 'tessera-gbp-stats');
  stats.append(stat('box-seam', data.mods.length), stat('heart', total('likes')), stat('eye', total('views')), stat('chat', total('comments')));
  const grid = el('div', 'tessera-gbp-mods');
  grid.append(...data.mods.map((mod, index) => modCard(mod, index < MAX_THUMBNAILS)));
  mods.append(el('h2', '', t('gbpage.mods')), stats, data.mods.length ? grid : el('p', 'tessera-gbp-empty', t('gbpage.noMods')));
  const comments = el('section', '');
  const list = el('div', 'tessera-gbp-comments');
  list.append(
    ...data.comments.map((comment: GbComment) => {
      const link = el('button', 'tessera-gbp-modlink', comment.modName);
      link.type = 'button';
      link.addEventListener('click', () => showThread(comment.modId));
      return postCard(comment, { ui, canReply: data.session, extra: link });
    }),
  );
  comments.append(el('h2', '', t('gbpage.comments')), data.comments.length ? list : el('p', 'tessera-gbp-empty', t('gbpage.noComments')));
  body.replaceChildren(mods, comments);
}

export const gamebananaPage: Page = {
  id: 'gamebanana',
  icon: 'globe2',
  label: 'nav.gamebanana',
  template,
  mount(root, { ui }: AppContext) {
    applyTranslations(root);
    const body = required<HTMLElement>(root, '[data-body]');
    const who = required<HTMLElement>(root, '[data-who]');
    const profile = required<HTMLButtonElement>(root, '[data-profile]');
    const refresh = required<HTMLButtonElement>(root, '[data-refresh]');
    const tabs = required<HTMLElement>(root, '[data-tabs]');
    const threads = required<HTMLElement>(root, '[data-threads]');
    const modList = required<HTMLElement>(root, '[data-mod-list]');
    const thread = required<HTMLElement>(root, '[data-thread]');
    let memberId: number | null = null;
    let data: GbMember | null = null;
    let selected: number | null = null;
    let visible = false;
    let loaded = false;

    const setTab = (tab: string) => {
      tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
      body.hidden = tab !== 'overview';
      threads.hidden = tab !== 'comments';
    };

    const showThread = async (modId: number) => {
      if (!data) return;
      selected = modId;
      setTab('comments');
      renderModList();
      const notice = data.session ? [] : [el('p', 'tessera-gbp-empty', t('gbpage.signInToReply'))];
      thread.replaceChildren(el('p', 'tessera-gbp-empty', t('gbpage.loading')));
      try {
        const posts = await window.tessera.invoke('gamebanana:posts', { modId });
        if (selected !== modId) return;
        const cards = posts.map((post) => postCard(post, { ui, canReply: !!data?.session }));
        thread.replaceChildren(...notice, ...(cards.length ? cards : [el('p', 'tessera-gbp-empty', t('gbpage.noComments'))]));
      } catch (error) {
        thread.replaceChildren(el('p', 'tessera-gbp-empty', errorMessage(error)));
      }
    };

    const renderModList = () => {
      modList.replaceChildren(
        ...(data?.mods ?? []).map((mod) => {
          const row = el('button', 'tessera-gbp-modrow');
          row.type = 'button';
          row.classList.toggle('is-selected', mod.id === selected);
          const thumb = el('div', 'tessera-gbp-thumb');
          if (mod.thumbnail) thumb.append(remoteImage(mod.thumbnail, ''));
          const info = el('div', 'tessera-gbp-modrow-info');
          info.append(el('span', '', mod.name), stat('chat', mod.comments));
          row.append(thumb, info);
          row.addEventListener('click', () => void showThread(mod.id));
          return row;
        }),
      );
      if (selected === null) thread.replaceChildren(el('p', 'tessera-gbp-empty', t(data?.mods.length ? 'gbpage.pickMod' : 'gbpage.noMods')));
    };

    const load = async () => {
      loaded = true;
      data = null;
      selected = null;
      tabs.hidden = true;
      setTab('overview');
      if (memberId === null) {
        body.replaceChildren(el('p', 'tessera-gbp-empty', t('gbpage.notLinked')));
        return;
      }
      refresh.disabled = true;
      body.replaceChildren(el('p', 'tessera-gbp-empty', t('gbpage.loading')));
      try {
        data = await window.tessera.invoke('gamebanana:member');
        renderOverview(body, data, ui, (modId) => void showThread(modId));
        renderModList();
        tabs.hidden = false;
      } catch (error) {
        body.replaceChildren(el('p', 'tessera-gbp-empty', errorMessage(error)));
        ui.toast('error', errorMessage(error));
      } finally {
        refresh.disabled = false;
      }
    };

    const apply = (settings: Settings) => {
      const account = settings.accounts.gamebanana;
      if ((account?.memberId ?? null) === memberId && loaded) return;
      memberId = account?.memberId ?? null;
      who.textContent = account ? account.name : '';
      profile.hidden = refresh.hidden = !account;
      loaded = false;
      if (visible) void load();
    };

    tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab!)));
    profile.addEventListener('click', () => memberId && open(`https://gamebanana.com/members/${memberId}`));
    refresh.addEventListener('click', () => void load());
    new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible && !loaded) void load();
    }).observe(root);
    window.tessera.on('settings:changed', apply);
    void window.tessera.invoke('settings:get').then(apply);
  },
  onLanguageChange(root) {
    applyTranslations(root);
  },
};
