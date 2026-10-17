import type { GbPost, GbStamp } from '@tessera/protocol';
import { t } from '../../i18n';
import { errorMessage, relativeTime } from '../../i18n/format';
import type { UiProvider } from '../../ui/provider';

const images = new Map<string, Promise<string>>();

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function remoteImage(url: string, className: string): HTMLImageElement {
  const image = el('img', className);
  image.alt = '';
  if (!images.has(url)) images.set(url, window.tessera.invoke('gamebanana:image', { url }));
  images
    .get(url)!
    .then((data) => (image.src = data))
    .catch(() => {
      images.delete(url);
      image.remove();
    });
  return image;
}

export interface PostOptions {
  ui: UiProvider;
  canReply: boolean;
  nested?: boolean;
  extra?: HTMLElement;
}

function loadReplies(post: GbPost, box: HTMLElement, options: PostOptions) {
  box.replaceChildren(el('p', 'tessera-gbp-empty', t('gbpage.loading')));
  window.tessera
    .invoke('gamebanana:posts', { postId: post.id })
    .then((replies) => box.replaceChildren(...replies.reverse().map((reply) => postCard(reply, { ...options, nested: true }))))
    .catch((error) => box.replaceChildren(el('p', 'tessera-gbp-empty', errorMessage(error))));
}

function renderStamps(box: HTMLElement, stamps: GbStamp[]) {
  box.hidden = !stamps.length;
  box.replaceChildren(...stamps.map((stamp) => el('span', `tessera-gbp-stamp is-${stamp.category}`, `${stamp.title} ×${stamp.count}`)));
}

async function openStampPicker(post: GbPost, picker: HTMLElement, stamps: HTMLElement, ui: UiProvider) {
  picker.hidden = false;
  picker.replaceChildren(el('p', 'tessera-gbp-empty', t('gbpage.loading')));
  try {
    const choice = await window.tessera.invoke('gamebanana:stamps', { postId: post.id });
    const chosen = new Set(choice.mine);
    const chips = choice.available.map((stamp) => {
      const chip = el('button', `atrium-chip-btn tessera-gbp-stamp is-${stamp.category}`, stamp.title);
      chip.type = 'button';
      chip.classList.toggle('is-active', chosen.has(stamp.id));
      chip.setAttribute('aria-pressed', String(chosen.has(stamp.id)));
      if (stamp.locked) {
        chip.disabled = true;
        chip.title = t('gbpage.stampLocked');
        chip.prepend(el('i', 'bi bi-lock-fill'), ' ');
        return chip;
      }
      chip.addEventListener('click', () => {
        if (chosen.has(stamp.id)) chosen.delete(stamp.id);
        else chosen.add(stamp.id);
        chip.classList.toggle('is-active', chosen.has(stamp.id));
        chip.setAttribute('aria-pressed', String(chosen.has(stamp.id)));
      });
      return chip;
    });
    const apply = el('button', 'atrium-btn atrium-btn-primary', t('gbpage.applyStamps'));
    apply.type = 'button';
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        renderStamps(stamps, await window.tessera.invoke('gamebanana:stamp', { postId: post.id, stampIds: [...chosen] }));
        ui.toast('success', t('gbpage.stampsSaved'));
        picker.hidden = true;
      } catch (error) {
        ui.toast('error', errorMessage(error));
      } finally {
        apply.disabled = false;
      }
    });
    const list = el('div', 'tessera-gbp-stamps');
    list.append(...chips);
    picker.replaceChildren(list, apply);
  } catch (error) {
    picker.replaceChildren(el('p', 'tessera-gbp-empty', errorMessage(error)));
  }
}

export function postCard(post: GbPost, options: PostOptions): HTMLElement {
  const card = el('article', 'tessera-gbp-post');
  const head = el('header', 'tessera-gbp-post-head');
  const avatar = el('span', 'tessera-gbp-avatar', post.author.slice(0, 1).toUpperCase());
  if (post.avatar) avatar.append(remoteImage(post.avatar, ''));
  head.append(avatar, el('b', '', post.author));
  if (post.submitter) head.append(el('span', 'atrium-badge', t('gbpage.submitter')));
  head.append(el('small', '', relativeTime(new Date(post.date * 1000).toISOString())));
  card.append(head);
  if (options.extra) card.append(options.extra);
  card.append(el('p', 'tessera-gbp-post-text', post.text));

  const stamps = el('div', 'tessera-gbp-stamps');
  renderStamps(stamps, post.stamps);
  card.append(stamps);

  if (!options.canReply && !post.replies) return card;
  const actions = el('div', 'tessera-gbp-post-actions');
  const picker = el('div', 'tessera-gbp-picker');
  picker.hidden = true;
  if (options.canReply) {
    const stamp = el('button', 'atrium-btn atrium-btn-secondary', t('gbpage.stamp'));
    stamp.type = 'button';
    stamp.addEventListener('click', () => {
      if (picker.hidden) void openStampPicker(post, picker, stamps, options.ui);
      else picker.hidden = true;
    });
    actions.append(stamp);
  }
  const replies = el('div', 'tessera-gbp-replies');
  replies.hidden = true;
  if (post.replies) {
    const toggle = el('button', 'atrium-btn atrium-btn-secondary', t('gbpage.replies', { n: post.replies }));
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      replies.hidden = !replies.hidden;
      toggle.textContent = replies.hidden ? t('gbpage.replies', { n: post.replies }) : t('gbpage.hideReplies');
      if (!replies.hidden) loadReplies(post, replies, options);
    });
    actions.append(toggle);
  }
  const form = el('div', 'tessera-gbp-reply');
  form.hidden = true;
  if (options.canReply && !options.nested) {
    const open = el('button', 'atrium-btn atrium-btn-secondary', t('gbpage.reply'));
    open.type = 'button';
    const input = el('textarea', 'atrium-input');
    input.placeholder = t('gbpage.replyPlaceholder');
    input.maxLength = 5000;
    input.rows = 3;
    const send = el('button', 'atrium-btn atrium-btn-primary', t('gbpage.send'));
    send.type = 'button';
    open.addEventListener('click', () => {
      form.hidden = !form.hidden;
      if (!form.hidden) input.focus();
    });
    send.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text || send.disabled) return;
      send.disabled = true;
      try {
        await window.tessera.invoke('gamebanana:reply', { postId: post.id, text });
        options.ui.toast('success', t('gbpage.replySent'));
        input.value = '';
        form.hidden = true;
        replies.hidden = false;
        loadReplies(post, replies, options);
      } catch (error) {
        options.ui.toast('error', errorMessage(error));
      } finally {
        send.disabled = false;
      }
    });
    form.append(input, send);
    actions.append(open);
  }
  card.append(actions, picker, form, replies);
  return card;
}
