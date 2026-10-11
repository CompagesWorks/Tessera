import { showAbout } from '../../about/about';
import type { Page } from '../types';
import './settings.css';
import template from './settings.html?raw';

export const settingsPage: Page = {
  id: 'settings',
  icon: 'gear',
  label: 'nav.settings',
  bottom: true,
  template,
  mount(root, { ui, info }) {
    root.querySelector('[data-about]')?.addEventListener('click', () => showAbout(ui, info));
  },
};
