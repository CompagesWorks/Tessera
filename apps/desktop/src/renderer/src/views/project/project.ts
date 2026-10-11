import type { ProjectLayout, ProjectSummary } from '@tessera/protocol';
import type { AppContext, Navigation } from '../../app/context';
import { fromTemplate, required } from '../../components/dom';
import { hueOf, KIND_ICONS } from '../../components/project-card/project-card';
import { t, type MessageKey } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import type { UiProvider } from '../../ui/provider';
import './project.css';
import template from './project.html?raw';
import { createWorkspaceController } from './workspace/workspace';

const STEPS: MessageKey[] = ['loading.reading', 'loading.sources', 'loading.layout', 'loading.ready'];
const STEP_MS = 140;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Options {
  host: HTMLElement;
  workspaces: HTMLElement;
  editButton: HTMLButtonElement;
  ui: UiProvider;
  getContext(): AppContext;
}

export function createProjectView({ host, workspaces, editButton, ui, getContext }: Options): Navigation {
  const view = fromTemplate(template);
  const loading = required<HTMLElement>(view, '[data-loading]');
  const workspaceHost = required<HTMLElement>(view, '[data-workspace]');
  const progress = required<HTMLElement>(view, '.atrium-progress');
  const step = required<HTMLElement>(view, '[data-step]');
  host.append(view);

  const workspace = createWorkspaceController({
    host: workspaceHost,
    sidebar: workspaces,
    ui,
    onEditingChange: (editing) => {
      editButton.classList.toggle('is-active', editing);
      const label = editButton.querySelector('span')!;
      label.dataset['i18n'] = editing ? 'layout.done' : 'layout.edit';
      label.textContent = t(editing ? 'layout.done' : 'layout.edit');
      editButton.querySelector('i')!.className = `bi bi-${editing ? 'check-lg' : 'pencil-square'}`;
    },
  });
  editButton.addEventListener('click', () => workspace.toggleEditing());

  let current: ProjectSummary | null = null;
  let ticket = 0;
  const listeners = new Set<(project: ProjectSummary | null) => void>();
  const emit = () => listeners.forEach((listener) => listener(current));

  function showLoadingCard(project: ProjectSummary) {
    const cover = required<HTMLElement>(view, '[data-cover]');
    cover.style.setProperty('--_hue', String(hueOf(project.id)));
    cover.querySelector('img')?.remove();
    required<HTMLElement>(view, '[data-kind]').className = `bi bi-${KIND_ICONS[project.kind]}`;
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

    workspace,

    async openProject(id) {
      const { store, status } = getContext();
      const summary = store.project(id);
      if (!summary) return;
      if (current) await workspace.unload();
      current = null;
      const mine = ++ticket;

      showLoadingCard(summary);
      view.hidden = false;
      loading.hidden = false;
      loading.classList.remove('is-done');
      workspaceHost.hidden = true;
      progress.style.setProperty('--atrium-progress', '0%');
      status.set(t('status.opening', { name: summary.name }), 'busy');
      document.body.classList.add('is-project');

      const opening = window.tessera.invoke('projects:open', { id });
      let layout: Promise<ProjectLayout> | null = null;
      try {
        for (const [index, key] of STEPS.entries()) {
          step.textContent = t(key);
          progress.style.setProperty('--atrium-progress', `${Math.round(((index + 1) / STEPS.length) * 100)}%`);
          if (index === 0) await opening;
          if (key === 'loading.layout') layout = window.tessera.invoke('layout:get', { id });
          if (layout) await layout;
          await wait(STEP_MS);
          if (mine !== ticket) return;
        }
        const project = await opening;
        store.replace(project);
        current = project;
        workspace.load(project, await layout!);
        loading.classList.add('is-done');
        workspaceHost.hidden = false;
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
      const wasOpen = current !== null;
      current = null;
      void workspace.unload();
      view.hidden = true;
      document.body.classList.remove('is-project');
      if (wasOpen) getContext().status.set(t('status.ready'));
      emit();
    },

    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return navigation;
}
