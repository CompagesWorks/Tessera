import DOMPurify from 'dompurify';
import { marked } from 'marked';
import './markdown.css';

const SAFE_URI = /^(?:https:|mailto:|#)/i;

const purify = DOMPurify();
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('rel', 'noreferrer');
    node.removeAttribute('target');
  }
  if (node.tagName === 'INPUT') {
    node.setAttribute('type', 'checkbox');
    node.setAttribute('disabled', '');
  }
});

export function renderMarkdown(source: string): DocumentFragment {
  const html = marked.parse(source, { async: false, gfm: true, breaks: true });
  return purify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_URI_REGEXP: SAFE_URI,
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'class', 'id'],
  });
}

export function mountMarkdown(target: HTMLElement, source: string) {
  target.classList.add('tessera-markdown');
  target.replaceChildren(renderMarkdown(source));
}

export function handleMarkdownLinks(target: HTMLElement) {
  target.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest('a');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) {
      target.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (/^https:\/\//i.test(href)) void window.tessera.invoke('app:open-external', { url: href });
  });
}
