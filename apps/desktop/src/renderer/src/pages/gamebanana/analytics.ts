import type { GbAnalytics, GbOwnMod } from '@tessera/protocol';
import { t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import type { UiProvider } from '../../ui/provider';
import { el } from './posts';

const SVG = 'http://www.w3.org/2000/svg';

export function linePoints(values: number[]): string {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  return values.map((v, i) => `${+(i * step).toFixed(2)},${+(38 - (v / max) * 36).toFixed(2)}`).join(' ');
}

function chart(series: GbAnalytics['series'][number], dates: string[]) {
  const row = el('div', 'tessera-gbp-chart');
  const total = series.values.reduce((sum, v) => sum + v, 0);
  const head = el('div', 'tessera-gbp-chart-head');
  head.append(el('b', '', series.title), el('span', '', total.toLocaleString()));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 40');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${series.title}: ${series.values.map((v, i) => `${dates[i]} ${v}`).join(', ')}`);
  const line = document.createElementNS(SVG, 'polyline');
  line.setAttribute('points', linePoints(series.values));
  line.setAttribute('stroke', series.color ?? 'currentColor');
  svg.append(line);
  const axis = el('div', 'tessera-gbp-chart-axis');
  axis.append(el('small', '', dates[0] ?? ''), el('small', '', dates[dates.length - 1] ?? ''));
  row.append(head, svg, axis);
  return row;
}

export function showAnalytics(mod: GbOwnMod, ui: UiProvider, open: (url: string) => void) {
  const body = el('div', 'tessera-gbp-analytics');
  const link = el('button', 'atrium-btn atrium-btn-secondary', t('gbpage.openMod'));
  link.type = 'button';
  link.addEventListener('click', () => open(mod.url));
  const content = el('div', 'tessera-gbp-charts');
  content.append(el('p', 'tessera-gbp-empty', t('gbpage.loading')));
  body.append(el('h3', '', t('gbpage.stats')), content, link);
  ui.modal({ title: mod.name, icon: 'graph-up', body, closeText: t('gbpage.close') });
  window.tessera.invoke('gamebanana:analytics', { modId: mod.id }).then(
    (data) => content.replaceChildren(...data.series.map((s) => chart(s, data.dates))),
    (error) => content.replaceChildren(el('p', 'tessera-gbp-empty', errorMessage(error))),
  );
}
