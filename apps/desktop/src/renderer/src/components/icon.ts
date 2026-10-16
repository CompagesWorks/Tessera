import { ICON_IMAGE } from '@tessera/protocol';
import { pluginUrl } from '../bridge/schemes';
import './icon.css';

export function pluginIcon(pluginId: string, icon: string): string {
  return ICON_IMAGE.test(icon) ? pluginUrl(pluginId, icon) : icon;
}

export function iconElement(icon: string): HTMLElement {
  if (!icon.includes('/')) {
    const glyph = document.createElement('i');
    glyph.className = `bi bi-${icon}`;
    return glyph;
  }
  const image = document.createElement('img');
  image.className = 'tessera-icon-img';
  image.alt = '';
  image.draggable = false;
  image.src = icon;
  image.addEventListener('error', () => image.replaceWith(iconElement('puzzle')), { once: true });
  return image;
}
