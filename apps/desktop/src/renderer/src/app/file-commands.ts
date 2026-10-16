import type { Command } from 'atrium-ui';
import { t } from '../i18n';
import { openProjectSearch } from '../search/search';
import type { AppContext } from './context';

const REFRESH_DELAY = 600;
const ICONS: Record<string, string> = {
  png: 'file-earmark-image', jpg: 'file-earmark-image', jpeg: 'file-earmark-image', webp: 'file-earmark-image', gif: 'file-earmark-image',
  json: 'filetype-json', md: 'journal-text', txt: 'file-earmark-text', toml: 'file-earmark-code', xml: 'file-earmark-code', lua: 'file-earmark-code',
  zip: 'file-earmark-zip', nutexb: 'file-earmark-image', nus3audio: 'file-earmark-music', wav: 'file-earmark-music', mp3: 'file-earmark-music',
};

function iconOf(path: string) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ICONS[ext] ?? 'file-earmark';
}

export function startFileCommands(ctx: AppContext) {
  const { ui, navigation } = ctx;
  let remove: (() => void) | null = null;
  let timer = 0;
  let ticket = 0;

  const clear = () => {
    remove?.();
    remove = null;
  };

  async function refresh() {
    const project = navigation.current;
    const mine = ++ticket;
    if (!project) return clear();
    const { files } = await window.tessera.invoke('files:index', { id: project.id }).catch(() => ({ files: [] as string[] }));
    if (mine !== ticket || navigation.current?.id !== project.id) return;
    const section = t('commands.section.files');
    const commands: Command[] = files.map((path) => {
      const slash = path.lastIndexOf('/');
      const note = path.startsWith('.tessera/notes/');
      return {
        id: `file:${path}`,
        title: note ? path.slice(slash + 1).replace(/\.md$/i, '') : path.slice(slash + 1),
        icon: note ? 'journal-text' : iconOf(path),
        section,
        keywords: [path],
        hint: note ? t('commands.noteHint') : slash > 0 ? path.slice(0, slash) : undefined,
        run: () => openProjectSearch(ctx, path.slice(slash + 1).replace(/\.md$/i, '')),
      };
    });
    clear();
    remove = ui.atrium.commands.register(commands);
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), REFRESH_DELAY);
  };

  navigation.onChange(schedule);
  window.addEventListener('focus', schedule);
  window.tessera.on('history:changed', schedule);
  window.tessera.on('backups:changed', schedule);
  window.tessera.on('plugin:files-changed', schedule);
  schedule();
}
