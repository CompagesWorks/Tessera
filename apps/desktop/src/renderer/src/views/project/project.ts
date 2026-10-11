import type { ProjectSummary } from '@tessera/protocol';
import type { AppContext, Navigation } from '../../app/context';
import { fromTemplate, required } from '../../components/dom';
import { hueOf, KIND_ICONS } from '../../components/project-card/project-card';
import { t, type MessageKey } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import './project.css';
import template from './project.html?raw';

const STEPS: MessageKey[] = ['loading.reading', 'loading.sources', 'loading.layout', 'loading.ready'];
const STEP_MS = 140;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createProjectView(host: HTMLElement, getContext: () => AppContext): Navigation {
  const view = fromTemplate(template);
  const loading = required<HTMLElement>(view, '[data-loading]');
  const workspace = required<HTMLElement>(view, '[data-workspace]');
  const progress = required<HTMLElement>(view, '.atrium-progress');
  const step = required<HTMLElement>(view, '[data-step]');
  host.append(view);

  let current: ProjectSummary | null = null;
  let ticket = 0;
  const listeners = new Set<(project: ProjectSummary | null) => void>();
  const emit = () => listeners.forEach((listener) => listener(current));

  required<HTMLButtonElement>(view, '[data-back]').addEventListener('click', () => navigation.closeProject());
  required<HTMLButtonElement>(view, '[data-reveal]').addEventListener('click', () => {
    if (current) void window.tessera.invoke('projects:reveal', { id: current.id });
  });

  function showLoadingCard(project: ProjectSummary) {
    const cover = required<HTMLElement>(view, '[data-cover]');
    cover.style.setProperty('--_hue', String(hueOf(project.id)));
    cover.querySelector('img')?.remove();
    const kind = required<HTMLElement>(view, '[data-kind]');
    kind.className = `bi bi-${KIND_ICONS[project.kind]}`;
    if (project.cover) {
      const img = document.createElement('img');
      img.src = project.cover;
      img.alt = '';
      cover.prepend(img);
    }
    required<HTMLElement>(view, '[data-name]').textContent = project.name;
    required<HTMLElement>(view, '[data-path]').textContent = project.path;
  }

  const navigation: Navigation = {
    get current() {
      return current;
    },

    async openProject(id) {
      const { store, ui, status } = getContext();
      const summary = store.project(id);
      if (!summary) return;
      const mine = ++ticket;

      showLoadingCard(summary);
      view.hidden = false;
      loading.hidden = false;
      loading.classList.remove('is-done');
      workspace.hidden = true;
      progress.style.setProperty('--atrium-progress', '0%');
      status.set(t('status.opening', { name: summary.name }), 'busy');
      document.body.classList.add('is-project');

      const opening = window.tessera.invoke('projects:open', { id });
      try {
        for (const [index, key] of STEPS.entries()) {
          step.textContent = t(key);
          progress.style.setProperty('--atrium-progress', `${Math.round(((index + 1) / STEPS.length) * 100)}%`);
          if (index === 0) await opening;
          await wait(STEP_MS);
          if (mine !== ticket) return;
        }
        const project = await opening;
        store.replace(project);
        current = project;
        loading.classList.add('is-done');
        workspace.hidden = false;
        status.set(t('status.opened', { name: project.name }), 'success');
        emit();
      } catch (error) {
        if (mine !== ticket) return;
        ui.toast('error', errorMessage(error));
        navigation.closeProject();
        void store.refresh();
      }
    },

    closeProject() {
      ticket++;
      current = null;
      view.hidden = true;
      document.body.classList.remove('is-project');
      getContext().status.set(t('status.ready'));
      emit();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return navigation;
}
