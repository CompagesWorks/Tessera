import { mediaUrl } from '../../../bridge/schemes';
import { handleMarkdownLinks, mountMarkdown } from '../../../components/markdown/markdown';
import { t } from '../../../i18n';
import { h264Player } from './h264-player';
import { createPlayer, mediaEngine } from './player';

export type PreviewKind = 'image' | 'video' | 'h264' | 'audio' | 'markdown' | 'text';

const KINDS: [PreviewKind, RegExp][] = [
  ['image', /\.(png|jpe?g|webp|gif|bmp|tga|tiff?|ico|dds|nutexb)$/i],
  ['video', /\.(mp4|m4v|webm|mov)$/i],
  ['h264', /\.h264$/i],
  ['audio', /\.(mp3|wav|ogg|flac|m4a)$/i],
  ['markdown', /\.(md|markdown)$/i],
  ['text', /\.(txt|json|jsonc|toml|xml|prcxml|msbtxml|yml|yaml|lua|csv|tsv|log|ini|cfg|conf|html|css|js|ts|rs|py|sh|bat|ps1|motdiff|nfo)$/i],
];
const MAX_TEXT_CHARS = 200_000;

export const previewKind = (path: string): PreviewKind | null => KINDS.find(([, pattern]) => pattern.test(path))?.[0] ?? null;

const clock = (seconds: number) =>
  Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '';

export interface Rendered {
  node: HTMLElement;
  info: Promise<string>;
}

function image(projectId: string, path: string, name: string): Rendered {
  const node = document.createElement('img');
  node.alt = name;
  const info = window.tessera.invoke('files:preview', { id: projectId, path }).then((preview) => {
    node.src = `data:image/png;base64,${preview.data}`;
    return [`${preview.width} × ${preview.height}`, preview.format, preview.mipmaps > 1 ? t('widget.explorer.mipmaps', { count: preview.mipmaps }) : null]
      .filter(Boolean)
      .join(' · ');
  });
  return { node, info };
}

function media(projectId: string, path: string, video: boolean): Rendered {
  const media = document.createElement(video ? 'video' : 'audio');
  media.preload = 'metadata';
  media.src = mediaUrl(projectId, path);
  const node = createPlayer(video ? media : null, mediaEngine(media));
  const info = new Promise<string>((resolve, reject) => {
    media.addEventListener('loadedmetadata', () => {
      const size = media instanceof HTMLVideoElement && media.videoWidth ? `${media.videoWidth} × ${media.videoHeight}` : null;
      resolve([size, clock(media.duration)].filter(Boolean).join(' · '));
    });
    media.addEventListener('error', () => reject(new Error(t('widget.preview.unsupported'))));
  });
  return { node, info };
}

function text(projectId: string, path: string, markdown: boolean): Rendered {
  const node = document.createElement(markdown ? 'div' : 'pre');
  node.className = markdown ? 'tessera-preview-markdown' : 'tessera-preview-text';
  node.tabIndex = 0;
  if (markdown) handleMarkdownLinks(node);
  const info = window.tessera.invoke('files:read-text', { id: projectId, path }).then((content) => {
    if (markdown) mountMarkdown(node, content);
    else node.textContent = content.length > MAX_TEXT_CHARS ? `${content.slice(0, MAX_TEXT_CHARS)}\n…` : content;
    return t('widget.preview.lines', { count: content.split('\n').length });
  });
  return { node, info };
}

export function renderPreview(kind: PreviewKind, projectId: string, path: string, name: string): Rendered {
  if (kind === 'image') return image(projectId, path, name);
  if (kind === 'h264') return h264Player(mediaUrl(projectId, path));
  if (kind === 'video' || kind === 'audio') return media(projectId, path, kind === 'video');
  return text(projectId, path, kind === 'markdown');
}
