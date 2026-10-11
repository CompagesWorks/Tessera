import { WIDGET_CATEGORIES, type WidgetCategory } from '@tessera/protocol';
import { t } from '../i18n';
import type { WidgetDefinition } from './types';

export const CATEGORY_ICONS: Record<WidgetCategory, string> = {
  project: 'briefcase',
  files: 'folder2',
  editing: 'brush',
  media: 'image',
  publishing: 'rocket-takeoff',
  tools: 'tools',
  other: 'puzzle',
};

export const categoryLabel = (category: WidgetCategory) => t(`widgetCategory.${category}`);

const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function searchWidgets(widgets: WidgetDefinition[], query: string, category: WidgetCategory | 'all') {
  const needle = fold(query.trim());
  const matches = widgets.filter((widget) => {
    if (category !== 'all' && widget.category !== category) return false;
    if (!needle) return true;
    return fold(`${widget.title()} ${widget.description()} ${widget.source} ${categoryLabel(widget.category)}`).includes(needle);
  });
  return WIDGET_CATEGORIES.map((cat) => ({
    category: cat,
    widgets: matches.filter((w) => w.category === cat).sort((a, b) => a.title().localeCompare(b.title())),
  })).filter((group) => group.widgets.length > 0);
}
