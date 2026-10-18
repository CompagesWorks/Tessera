import type { ModalHandle } from 'atrium-ui';
import { z } from 'zod';
import { t } from '../i18n';
import type { UiProvider } from '../ui/provider';
import './progress.css';

export const ProgressSchema = z
  .object({
    title: z.string().trim().min(1).max(60),
    message: z.string().max(300).optional(),
    percent: z.number().min(0).max(100).optional(),
    background: z.boolean().optional(),
  })
  .strict();
export type ProgressSpec = z.infer<typeof ProgressSchema>;

interface Task {
  pluginName: string;
  spec: ProgressSpec;
  started: number;
  timer: number;
  chip: HTMLButtonElement;
  modal: ModalHandle | null;
  view: { title: HTMLElement; message: HTMLElement; bar: HTMLProgressElement; elapsed: HTMLElement } | null;
}

const tasks = new Map<string, Task>();

const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

function tray() {
  const content = document.querySelector('.atrium-statusbar-content');
  let element = content?.querySelector<HTMLElement>('.tessera-status-tasks') ?? null;
  if (content && !element) {
    element = document.createElement('div');
    element.className = 'tessera-status-tasks';
    content.querySelector('.atrium-statusbar-right')?.before(element);
  }
  return element;
}

function render(task: Task) {
  const percent = task.spec.percent;
  const label = percent === undefined ? task.spec.title : `${task.spec.title} · ${Math.round(percent)} %`;
  task.chip.lastElementChild!.textContent = label;
  task.chip.title = `${task.pluginName} · ${t('plugins.progressShow')}`;
  if (!task.view) return;
  task.view.title.textContent = task.spec.title;
  task.view.message.textContent = task.spec.message ?? '';
  task.view.bar.hidden = percent === undefined;
  if (percent !== undefined) task.view.bar.value = percent;
  task.view.elapsed.textContent = clock(performance.now() - task.started);
}

function openModal(ui: UiProvider, task: Task) {
  if (task.modal) return;
  const body = document.createElement('div');
  body.className = 'tessera-plugin-progress';
  body.setAttribute('role', 'status');
  body.innerHTML = '<i class="bi bi-arrow-repeat tessera-plugin-progress-spin" aria-hidden="true"></i>';
  const text = document.createElement('div');
  const title = document.createElement('b');
  const message = document.createElement('p');
  const bar = document.createElement('progress');
  bar.max = 100;
  const elapsed = document.createElement('small');
  text.append(title, message, bar, elapsed);
  body.append(text);
  task.view = { title, message, bar, elapsed };
  task.modal = ui.atrium.modal.open({
    title: task.pluginName,
    icon: 'hourglass-split',
    body,
    clickOverlayToClose: false,
    buttons: [{ text: t('plugins.progressHide'), variant: 'secondary' }],
    onClose: () => {
      task.modal = null;
      task.view = null;
    },
  });
  render(task);
}

export function showProgress(ui: UiProvider, owner: string, pluginName: string, spec: ProgressSpec) {
  const current = tasks.get(owner);
  if (current) {
    current.spec = spec;
    render(current);
    return;
  }
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'tessera-status-task';
  chip.innerHTML = '<i class="bi bi-arrow-repeat tessera-plugin-progress-spin" aria-hidden="true"></i><span></span>';
  const task: Task = { pluginName, spec, started: performance.now(), timer: 0, chip, modal: null, view: null };
  task.timer = window.setInterval(() => render(task), 1000);
  chip.addEventListener('click', () => openModal(ui, task));
  tray()?.append(chip);
  tasks.set(owner, task);
  if (!spec.background) openModal(ui, task);
}

export function closeProgress(owner: string) {
  const task = tasks.get(owner);
  if (!task) return;
  tasks.delete(owner);
  clearInterval(task.timer);
  task.chip.remove();
  void task.modal?.close();
}
