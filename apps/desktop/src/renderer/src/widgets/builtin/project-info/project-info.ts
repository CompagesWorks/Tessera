import { fromTemplate, required } from '../../../components/dom';
import { KIND_ICONS } from '../../../components/project-card/project-card';
import { t } from '../../../i18n';
import type { WidgetDefinition } from '../../types';
import './project-info.css';
import template from './project-info.html?raw';

const date = (iso: string) => new Date(iso).toLocaleString();

export const projectInfoWidget: WidgetDefinition = {
  type: 'core/project-info',
  title: () => t('widget.info.title'),
  description: () => t('widget.info.description'),
  icon: 'info-square',
  category: 'project',
  source: 'Tessera',
  trust: 'builtin',
  create({ project }) {
    const element = fromTemplate(template);
    required(element, '[data-kind]').classList.add(`bi-${KIND_ICONS[project.kind]}`);
    required(element, '[data-name]').textContent = project.name;
    required(element, '[data-sub]').textContent = t(`kind.${project.kind}`);
    required(element, '[data-status]').textContent = t(`projectStatus.${project.status}`);
    required(element, '[data-created]').textContent = date(project.createdAt);
    required(element, '[data-updated]').textContent = date(project.updatedAt);
    required(element, '[data-path]').textContent = project.path;
    return { element };
  },
};
