import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

const html = (source: string) => {
  const div = document.createElement('div');
  div.append(renderMarkdown(source));
  return div.innerHTML;
};

describe('renderMarkdown', () => {
  it('renders headings, lists, tasks and tables', () => {
    const out = html('# Titre\n\n- un\n- [x] fait\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('<h1>Titre</h1>');
    expect(out).toContain('<li>un</li>');
    const box = new DOMParser().parseFromString(out, 'text/html').querySelector('input');
    expect(box?.type).toBe('checkbox');
    expect(box?.checked).toBe(true);
    expect(box?.disabled).toBe(true);
    expect(out).toContain('<td>1</td>');
  });

  it('removes scripts, handlers and unsafe links', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[a](javascript:alert(1)) [b](http://x.com) [c](https://ok.com)');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('href="javascript:');
    expect(out).not.toContain('href="http://x.com"');
    expect(out).toContain('href="https://ok.com"');
  });

  it('drops raw styles and iframes', () => {
    const out = html('<iframe src="https://x.com"></iframe><p style="color:red" class="x">t</p>');
    expect(out).not.toContain('<iframe');
    expect(out).not.toContain('style=');
    expect(out).not.toContain('class=');
  });
});
