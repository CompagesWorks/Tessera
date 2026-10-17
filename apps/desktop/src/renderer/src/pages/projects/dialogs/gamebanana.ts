import { ProjectKindSchema, ProjectNameSchema, type GbMod, type GbProgress, type ProjectKind, type ProjectSummary } from '@tessera/protocol';
import '../../../components/dialogs/dialogs.css';
import { fromTemplate, required } from '../../../components/dom';
import { KIND_ICONS } from '../../../components/project-card/project-card';
import { t } from '../../../i18n';
import { errorMessage } from '../../../i18n/format';
import type { UiProvider } from '../../../ui/provider';
import './gamebanana.css';
import template from './gamebanana.html?raw';

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function gamebananaDialog(ui: UiProvider, defaultLocation: string): Promise<ProjectSummary | null> {
  return new Promise((resolve) => {
    const body = fromTemplate(template);
    const pick = <T extends HTMLElement>(selector: string) => required<T>(body, selector);
    const url = pick<HTMLInputElement>('[data-url]');
    const error = pick<HTMLElement>('[data-error]');
    const modView = pick<HTMLElement>('[data-mod]');
    const fileSelect = pick<HTMLSelectElement>('[data-file]');
    const name = pick<HTMLInputElement>('[data-name]');
    const kinds = pick<HTMLElement>('[data-kind]');
    const locationEl = pick<HTMLElement>('[data-location]');
    const progress = pick<HTMLElement>('[data-progress]');
    const phase = pick<HTMLElement>('[data-phase]');
    const bar = pick<HTMLProgressElement>('[data-bar]');
    let mod: GbMod | null = null;
    let kind: ProjectKind = 'skin';
    let location = defaultLocation;
    let busy = false;
    let settled = false;

    const showLocation = () => {
      locationEl.textContent = location;
      locationEl.title = location;
    };
    showLocation();

    for (const value of ProjectKindSchema.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'atrium-chip-btn';
      button.classList.toggle('is-active', value === kind);
      button.innerHTML = `<i class="bi bi-${KIND_ICONS[value]}"></i>`;
      button.append(t(`kind.${value}`));
      button.addEventListener('click', () => {
        kind = value;
        kinds.querySelectorAll('.atrium-chip-btn').forEach((b) => b.classList.toggle('is-active', b === button));
      });
      kinds.append(button);
    }

    pick<HTMLButtonElement>('[data-change]').addEventListener('click', async () => {
      const picked = await window.tessera.invoke('projects:pick-location');
      if (picked) {
        location = picked;
        showLocation();
      }
    });

    function show(found: GbMod) {
      mod = found;
      modView.hidden = false;
      const slot = pick<HTMLElement>('[data-image]');
      slot.replaceChildren();
      if (found.thumbnails[0]) {
        const image = document.createElement('img');
        image.alt = '';
        slot.append(image);
        void window.tessera
          .invoke('gamebanana:image', { url: found.thumbnails[0] })
          .then((data) => (image.src = data))
          .catch(() => image.remove());
      }
      pick<HTMLElement>('[data-title]').textContent = found.name;
      pick<HTMLElement>('[data-meta]').textContent = [found.author, found.category].filter(Boolean).join(' · ');
      const remix = pick<HTMLElement>('[data-remix]');
      remix.dataset['remix'] = found.remix;
      remix.textContent = t(`gamebanana.remix.${found.remix}`);
      fileSelect.replaceChildren(
        ...found.files.map((file) => {
          const option = new Option(`${file.name} · ${megabytes(file.size)}${file.clean ? '' : ` · ${t('gamebanana.notScanned')}`}`, String(file.id));
          option.disabled = !file.clean;
          return option;
        }),
      );
      fileSelect.value = String(found.files.find((file) => file.clean)?.id ?? '');
      name.value = found.name.slice(0, 80);
    }

    pick<HTMLFormElement>('[data-lookup]').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      error.textContent = '';
      busy = true;
      try {
        show(await window.tessera.invoke('gamebanana:lookup', { url: url.value }));
      } catch (err) {
        modView.hidden = true;
        mod = null;
        error.textContent = errorMessage(err);
      } finally {
        busy = false;
      }
    });

    async function runImport(): Promise<boolean> {
      if (!mod || busy) return false;
      const fileId = Number(fileSelect.value);
      const parsedName = ProjectNameSchema.safeParse(name.value);
      if (!fileId) {
        error.textContent = t('gamebanana.noFile');
        return false;
      }
      if (!parsedName.success) {
        error.textContent = t('error.name');
        return false;
      }
      const token = `gb-${Math.random().toString(36).slice(2, 12)}`;
      busy = true;
      error.textContent = '';
      progress.hidden = false;
      phase.textContent = t('gamebanana.phase.download');
      bar.removeAttribute('value');
      const off = window.tessera.on('gamebanana:progress', (payload) => {
        const update = payload as GbProgress;
        if (update.token !== token) return;
        phase.textContent = update.phase === 'download' ? `${t('gamebanana.phase.download')} ${megabytes(update.done)} / ${megabytes(update.total)}` : t(`gamebanana.phase.${update.phase}`);
        if (update.phase === 'download' && update.total) bar.value = (update.done / update.total) * 100;
        else bar.removeAttribute('value');
      });
      try {
        const project = await window.tessera.invoke('gamebanana:import', { modId: mod.id, fileId, name: parsedName.data, kind, location, token });
        settled = true;
        resolve(project);
        return true;
      } catch (err) {
        error.textContent = errorMessage(err);
        progress.hidden = true;
        return false;
      } finally {
        off();
        busy = false;
      }
    }

    ui.atrium.modal.open({
      title: t('gamebanana.title'),
      icon: 'cloud-download',
      body,
      clickOverlayToClose: false,
      onClose: () => {
        if (!settled) resolve(null);
      },
      buttons: [
        { text: t('dialog.cancel'), variant: 'cancel' },
        {
          text: t('gamebanana.import'),
          variant: 'primary',
          onClick: async (_event, modal) => {
            const done = await runImport();
            if (!done) modal.shake();
            return done;
          },
        },
      ],
    });
    requestAnimationFrame(() => url.focus());
  });
}
