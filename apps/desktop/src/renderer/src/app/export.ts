import { choose } from '../components/dialogs/choose';
import { t } from '../i18n';
import { errorMessage } from '../i18n/format';
import type { AppContext } from './context';

export async function exportProject({ ui, navigation }: AppContext) {
  const project = navigation.current;
  if (!project) return;
  const format = await choose(ui, {
    title: t('export.title'),
    icon: 'box-arrow-up',
    value: 'zip',
    cancelText: t('dialog.cancel'),
    choices: [
      { value: 'zip', label: t('export.zip'), icon: 'file-earmark-zip' },
      { value: 'folder', label: t('export.folder'), icon: 'folder2' },
    ],
  });
  if (!format) return;
  try {
    await window.tessera.invoke('projects:export', { id: project.id, zip: format === 'zip' });
    ui.toast('success', t('export.done'));
  } catch (error) {
    ui.toast('error', errorMessage(error));
  }
}
