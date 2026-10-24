import type { ProjectKind, ProjectStatus, ProjectSummary, Tag } from '@tessera/protocol';
import { t } from '../../i18n';
import { relativeTime } from '../../i18n/format';
import './project-card.css';
import template from './project-card.html?raw';

export const KIND_ICONS: Record<ProjectKind, string> = {
  skin: 'person-bounding-box',
  stage: 'map',
  ui: 'window',
  audio: 'music-note-beamed',
  effect: 'stars',
  other: 'box',
};

export const STATUS_TONES: Record<ProjectStatus, string> = {
  draft: 'atrium-badge-neutral',
  wip: 'atrium-badge-warning',
  done: 'atrium-badge-success',
  published: '',
};

const holder = document.createElement('template');
holder.innerHTML = template.trim();

export function hueOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

export function tagBadge(tag: Tag): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'atrium-badge';
  badge.textContent = tag.name;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(tag.color.slice(i, i + 2), 16));
  badge.style.setProperty('--_color', tag.color);
  badge.style.setProperty('--_rgb', `${r}, ${g}, ${b}`);
  return badge;
}

export function projectCard(project: ProjectSummary, tags: Map<string, Tag>, layout: 'grid' | 'list'): HTMLElement {
  const card = holder.content.firstElementChild!.cloneNode(true) as HTMLElement;
  card.dataset['id'] = project.id;
  card.classList.toggle('is-list', layout === 'list');
  card.classList.toggle('is-missing', project.missing);

  const cover = card.querySelector<HTMLElement>('[data-cover]')!;
  cover.style.setProperty('--_hue', String(hueOf(project.id)));
  if (project.cover && !project.missing) {
    const img = document.createElement('img');
    img.src = project.cover;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => {
      img.remove();
      cover.classList.remove('has-image');
    });
    cover.prepend(img);
    cover.classList.add('has-image');
  }

  card.querySelector('[data-kind]')!.classList.add(`bi-${KIND_ICONS[project.kind]}`);

  const status = card.querySelector<HTMLElement>('[data-status]')!;
  if (project.missing) {
    status.className = 'atrium-badge atrium-badge-danger tessera-card-status';
    status.textContent = t('projects.missing');
  } else {
    if (STATUS_TONES[project.status]) status.classList.add(STATUS_TONES[project.status]);
    status.textContent = t(`projectStatus.${project.status}`);
  }

  if (!project.favorite) card.querySelector('[data-fav]')!.remove();

  card.querySelector('[data-name]')!.textContent = project.name;
  card.title = project.path;

  const meta = card.querySelector<HTMLElement>('[data-meta]')!;
  const kind = document.createElement('span');
  kind.textContent = t(`kind.${project.kind}`);
  const edited = document.createElement('span');
  edited.textContent = t('projects.edited', { when: relativeTime(project.updatedAt) });
  meta.append(kind, edited);

  const tagList = card.querySelector<HTMLElement>('[data-tags]')!;
  for (const id of project.tags) {
    const tag = tags.get(id);
    if (tag) tagList.append(tagBadge(tag));
  }

  return card;
}
