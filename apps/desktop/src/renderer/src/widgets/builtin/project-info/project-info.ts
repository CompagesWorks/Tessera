import { fromTemplate, required } from '../../../components/dom';
import { KIND_ICONS, STATUS_TONES } from '../../../components/project-card/project-card';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import { toBase64 } from '../explorer/actions';
import type { WidgetDefinition } from '../../types';
import { INFO_KEYS, readInfo, writeInfo, type Info } from './info-toml';
import './project-info.css';
import template from './project-info.html?raw';

const INFO_PATH = 'sources/info.toml';
const PREVIEW_PATH = 'sources/preview.webp';
const CATEGORIES: Record<string, string> = { skin: 'Fighter', stage: 'Stage', ui: 'UI', audio: 'Audio', effect: 'Effects', other: 'Misc' };

const date = (iso: string) => new Date(iso).toLocaleString();

async function toWebp(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
  if (blob?.type !== 'image/webp') throw new Error(t('widget.info.webpUnsupported'));
  return blob;
}

export const projectInfoWidget: WidgetDefinition = {
  type: 'core/project-info',
  title: () => t('widget.info.title'),
  description: () => t('widget.info.description'),
  icon: 'info-square',
  category: 'project',
  source: 'Tessera',
  trust: 'builtin',
  create({ project, ui }) {
    const element = fromTemplate(template);
    required(element, '[data-kind]').classList.add(`bi-${KIND_ICONS[project.kind]}`);
    required(element, '[data-name]').textContent = project.name;
    required(element, '[data-sub]').textContent = t(`kind.${project.kind}`);
    const status = required(element, '[data-status]');
    status.textContent = t(`projectStatus.${project.status}`);
    if (STATUS_TONES[project.status]) status.classList.add(STATUS_TONES[project.status]);
    required(element, '[data-created]').textContent = date(project.createdAt);
    required(element, '[data-updated]').textContent = date(project.updatedAt);
    const path = required<HTMLElement>(element, '[data-path]');
    path.textContent = project.path;
    path.title = project.path;

    const api = window.tessera;
    required(element, '[data-copy]').addEventListener('click', () => {
      navigator.clipboard.writeText(project.path).then(
        () => ui.toast('success', t('search.copied')),
        (error) => ui.toast('error', errorMessage(error)),
      );
    });
    required(element, '[data-reveal]').addEventListener('click', () => {
      api.invoke('projects:reveal', { id: project.id }).catch((error) => ui.toast('error', errorMessage(error)));
    });

    const form = required<HTMLFormElement>(element, '[data-form]');
    const fields = required<HTMLFieldSetElement>(element, '[data-fields]');
    const unsupported = required<HTMLElement>(element, '[data-unsupported]');
    const state = required<HTMLElement>(element, '[data-state]');
    const save = required<HTMLButtonElement>(element, '[data-save]');
    const saveIcon = required<HTMLElement>(element, '[data-save-icon]');
    const revert = required<HTMLButtonElement>(element, '[data-revert]');
    const field = (key: string) => form.elements.namedItem(key) as HTMLInputElement;
    const values = (): Info => Object.fromEntries(INFO_KEYS.map((key) => [key, field(key).value]));
    let text = '';
    let saved: Info | null = null;
    let editable = false;
    let saving = false;
    let justSaved = false;

    const fill = (info: Info) => {
      for (const key of INFO_KEYS) field(key).value = info[key] ?? '';
    };
    const refresh = () => {
      const dirty = !saved || INFO_KEYS.some((key) => field(key).value !== saved![key]);
      save.disabled = !editable || saving || !dirty;
      revert.disabled = !editable || saving || !saved || !dirty;
      saveIcon.className = saving ? 'bi bi-arrow-repeat atrium-spin' : 'bi bi-floppy';
      form.setAttribute('aria-busy', String(saving));
      state.className = 'tessera-info-state';
      if (!editable) state.textContent = '';
      else if (!saved) state.textContent = t('widget.info.missing');
      else if (dirty) {
        state.textContent = t('widget.info.unsaved');
        state.classList.add('is-dirty');
      } else if (justSaved) {
        state.textContent = t('widget.info.saved');
        state.classList.add('is-saved');
      } else state.textContent = '';
    };
    const ready = (canEdit: boolean) => {
      editable = canEdit;
      fields.disabled = !canEdit;
      fields.removeAttribute('aria-busy');
      refresh();
    };

    fill({ display_name: project.name, category: CATEGORIES[project.kind] ?? 'Misc' });
    refresh();
    api
      .invoke('files:read-text', { id: project.id, path: INFO_PATH })
      .then((content) => {
        text = content;
        const info = readInfo(content);
        unsupported.hidden = info !== null;
        if (info) {
          fill(info);
          saved = values();
        }
        ready(info !== null);
      })
      .catch(() => ready(true));

    form.addEventListener('input', () => {
      justSaved = false;
      refresh();
    });
    form.addEventListener('reset', (event) => {
      event.preventDefault();
      if (saved) fill(saved);
      refresh();
    });
    form.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!save.disabled) form.requestSubmit();
      }
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const info = values();
      saving = true;
      refresh();
      try {
        const next = writeInfo(text, info);
        await api.invoke('files:write-bytes', { id: project.id, path: INFO_PATH, data: await toBase64(new File([next], 'info.toml')) });
        text = next;
        saved = info;
        justSaved = true;
        ui.toast('success', t('widget.info.saved'));
      } catch (error) {
        ui.toast('error', errorMessage(error));
      } finally {
        saving = false;
        refresh();
      }
    });

    const drop = required<HTMLElement>(element, '[data-drop]');
    const loading = required<HTMLElement>(element, '[data-preview-loading]');
    const preview = required<HTMLImageElement>(element, '[data-preview]');
    const noPreview = required<HTMLElement>(element, '[data-no-preview]');
    const previewInput = required<HTMLInputElement>(element, '[data-preview-input]');
    const choose = required<HTMLButtonElement>(element, '[data-choose]');
    const chooseLabel = required<HTMLElement>(element, '[data-choose-label]');

    const showPreview = (src: string | null) => {
      loading.hidden = true;
      preview.hidden = !src;
      noPreview.hidden = !!src;
      drop.classList.toggle('is-empty', !src);
      chooseLabel.textContent = t(src ? 'widget.info.replacePreview' : 'widget.info.choosePreview');
      if (src) preview.src = src;
    };
    api
      .invoke('files:preview', { id: project.id, path: PREVIEW_PATH })
      .then((p) => showPreview(`data:image/png;base64,${p.data}`))
      .catch(() => showPreview(null));

    choose.addEventListener('click', () => previewInput.click());
    drop.addEventListener('click', () => {
      if (drop.classList.contains('is-empty')) previewInput.click();
    });
    previewInput.addEventListener('change', async () => {
      const file = previewInput.files?.[0];
      previewInput.value = '';
      if (!file) return;
      choose.disabled = true;
      try {
        const webp = await toWebp(file);
        await api.invoke('files:write-bytes', { id: project.id, path: PREVIEW_PATH, data: await toBase64(new File([webp], 'preview.webp')) });
        if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
        showPreview(URL.createObjectURL(webp));
        ui.toast('success', t('widget.info.previewSaved'));
      } catch (error) {
        ui.toast('error', errorMessage(error));
      } finally {
        choose.disabled = false;
      }
    });

    return {
      element,
      dispose: () => {
        if (preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
      },
    };
  },
};
