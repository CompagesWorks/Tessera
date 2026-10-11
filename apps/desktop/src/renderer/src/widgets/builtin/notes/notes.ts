import { NoteNameSchema } from '@tessera/protocol';
import { fromTemplate, required } from '../../../components/dom';
import { handleMarkdownLinks, mountMarkdown } from '../../../components/markdown/markdown';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import type { WidgetDefinition } from '../../types';
import './notes.css';
import template from './notes.html?raw';

const SAVE_DELAY = 500;
const PREVIEW_DELAY = 150;
type View = 'edit' | 'preview' | 'split';
const VIEWS: View[] = ['edit', 'split', 'preview'];

export const notesWidget: WidgetDefinition = {
  type: 'core/notes',
  title: 'widget.notes.title',
  description: 'widget.notes.description',
  icon: 'journal-text',
  source: 'Tessera',
  create({ project, ui, state, setState }) {
    const element = fromTemplate(template);
    const select = required<HTMLSelectElement>(element, '[data-select]');
    const area = required<HTMLTextAreaElement>(element, '[data-area]');
    const status = required<HTMLElement>(element, '[data-status]');
    const body = required<HTMLElement>(element, '[data-body]');
    const preview = required<HTMLElement>(element, '[data-preview]');
    handleMarkdownLinks(preview);
    const more = required<HTMLButtonElement>(element, '[data-more]');
    required<HTMLButtonElement>(element, '[data-new]').dataset['atriumTooltip'] = t('widget.notes.new');
    area.placeholder = t('widget.notes.placeholder');

    const api = window.tessera;
    let current = typeof state['note'] === 'string' ? state['note'] : '';
    let saved = '';
    let timer = 0;
    let disposed = false;
    let view: View = VIEWS.includes(state['view'] as View) ? (state['view'] as View) : 'split';
    let previewTimer = 0;

    const renderPreview = () => {
      clearTimeout(previewTimer);
      if (view !== 'edit') mountMarkdown(preview, area.value);
    };
    const schedulePreview = () => {
      clearTimeout(previewTimer);
      previewTimer = window.setTimeout(renderPreview, PREVIEW_DELAY);
    };
    const remember = () => setState({ note: current, view });
    const applyView = () => {
      body.dataset['view'] = view;
      renderPreview();
    };
    applyView();

    ui.atrium.segmented(required(element, '[data-mode]'), {
      value: view,
      label: t('widget.notes.view'),
      options: [
        { value: 'edit', icon: 'pencil' },
        { value: 'split', icon: 'layout-split' },
        { value: 'preview', icon: 'eye' },
      ],
      onChange: (value) => {
        view = value as View;
        applyView();
        remember();
      },
    }).element.classList.add('is-icons', 'is-small');

    const showStatus = () => {
      status.textContent = current ? `.tessera/notes/${current}.md` : '';
    };

    const flush = async () => {
      clearTimeout(timer);
      if (!current || area.value === saved) return;
      const content = area.value;
      try {
        await api.invoke('notes:write', { id: project.id, name: current, content });
        saved = content;
      } catch (error) {
        ui.toast('error', errorMessage(error));
      }
    };

    const open = async (name: string) => {
      await flush();
      current = name;
      area.value = saved = name ? await api.invoke('notes:read', { id: project.id, name }) : '';
      area.disabled = !name;
      select.value = name;
      remember();
      showStatus();
      renderPreview();
    };

    const refreshList = async (selected: string) => {
      const notes = await api.invoke('notes:list', { id: project.id });
      select.replaceChildren(
        ...notes.map((note) => {
          const option = document.createElement('option');
          option.value = option.textContent = note.name;
          return option;
        }),
      );
      return notes.some((n) => n.name === selected) ? selected : (notes[0]?.name ?? '');
    };

    const create = async (name: string, content = '') => {
      const created = await api.invoke('notes:create', { id: project.id, name, content });
      await open(await refreshList(created));
    };

    const askName = () =>
      ui.atrium.modal.prompt({
        title: t('widget.notes.newTitle'),
        label: t('widget.notes.name'),
        icon: 'journal-plus',
        confirmText: t('dialog.create'),
        cancelText: t('dialog.cancel'),
        validate: (value) => (NoteNameSchema.safeParse(value).success ? null : t('error.noteName')),
      });

    async function init() {
      const legacy = typeof state['text'] === 'string' ? state['text'] : null;
      if (legacy !== null && !current) return create(t('widget.notes.defaultName'), legacy);
      const selected = await refreshList(current);
      if (!selected) return create(t('widget.notes.defaultName'));
      await open(selected);
    }

    area.addEventListener('input', () => {
      schedulePreview();
      clearTimeout(timer);
      timer = window.setTimeout(() => void flush(), SAVE_DELAY);
    });
    area.addEventListener('blur', () => void flush());
    select.addEventListener('change', () => void open(select.value));
    required(element, '[data-new]').addEventListener('click', async () => {
      const name = await askName();
      if (name) await create(name).catch((error) => ui.toast('error', errorMessage(error)));
    });
    more.addEventListener('click', () => {
      ui.atrium.menu.openAt(more, [
        {
          label: t('widget.notes.delete'),
          icon: 'trash3',
          danger: true,
          disabled: !current,
          onClick: async () => {
            const ok = await ui.atrium.modal.confirm({
              title: t('widget.notes.deleteTitle', { name: current }),
              message: t('widget.notes.deleteMessage'),
              confirmText: t('delete.confirm'),
              cancelText: t('dialog.cancel'),
              danger: true,
            });
            if (!ok) return;
            clearTimeout(timer);
            await api.invoke('notes:delete', { id: project.id, name: current });
            saved = area.value;
            const next = await refreshList('');
            if (next) await open(next);
            else await create(t('widget.notes.defaultName'));
          },
        },
      ], { placement: 'bottom-end' });
    });

    void init().catch((error) => {
      if (!disposed) ui.toast('error', errorMessage(error));
    });

    return {
      element,
      dispose: () => {
        disposed = true;
        clearTimeout(previewTimer);
        void flush();
      },
    };
  },
};
