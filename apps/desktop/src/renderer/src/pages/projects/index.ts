import type { Page } from '../types';
import template from './projects.html?raw';

export const projectsPage: Page = {
  id: 'projects',
  icon: 'collection',
  label: 'nav.projects',
  template,
};
