import { ProjectNameSchema, ProjectStatusSchema, type Collection, type ProjectSummary, type Tag } from '@tessera/protocol';
import type { MenuEntry } from 'atrium-ui';
import type { AppContext } from '../../app/context';
import { choose } from '../../components/dialogs/choose';
import { editTag } from '../../components/dialogs/tag-editor';
import { t } from '../../i18n';
import { errorMessage } from '../../i18n/format';
import { gamebananaDialog } from './dialogs/gamebanana';
import { newProjectDialog } from './dialogs/new-project';
import { pickTags } from './dialogs/pick-tags';

const NONE = '__none__';

export function createProjectActions(ctx: AppContext) {
  const { ui, store, navigation } = ctx;
  const { atrium } = ui;

  const attempt = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      ui.toast('error', errorMessage(error));
      void store.refresh();
    }
  };

  async function newProject() {
    const project = await newProjectDialog(ui, store.current.defaultLocation);
    if (!project) return;
    store.replace(project);
    await navigation.openProject(project.id);
  }

  async function fromGamebanana() {
    const project = await gamebananaDialog(ui, store.current.defaultLocation);
    if (!project) return;
    store.replace(project);
    await navigation.openProject(project.id);
  }

  async function importProject() {
    await attempt(async () => {
      const project = await window.tessera.invoke('projects:import');
      if (!project) return;
      store.replace(project);
      await navigation.openProject(project.id);
    });
  }

  async function rename(project: ProjectSummary) {
    const name = await atrium.modal.prompt({
      title: t('rename.title'),
      label: t('rename.label'),
      value: project.name,
      icon: 'pencil',
      confirmText: t('dialog.save'),
      cancelText: t('dialog.cancel'),
      validate: (value) => (ProjectNameSchema.safeParse(value).success ? null : t('error.name')),
    });
    if (name && name !== project.name) await attempt(() => store.update(project.id, { name }));
  }

  async function chooseTags(project: ProjectSummary) {
    const tags = await pickTags(ui, store.current.tags, project.tags);
    if (tags) await attempt(() => store.update(project.id, { tags }));
  }

  async function chooseCollection(project: ProjectSummary) {
    const value = await choose(ui, {
      title: t('collection.title'),
      icon: 'folder2',
      value: project.collection ?? NONE,
      cancelText: t('dialog.cancel'),
      choices: [
        { value: NONE, label: t('collection.none'), icon: 'x-circle' },
        ...store.current.collections.map((c) => ({ value: c.id, label: c.name, icon: 'folder2' })),
      ],
    });
    if (value !== null) await attempt(() => store.update(project.id, { collection: value === NONE ? null : value }));
  }

  async function chooseStatus(project: ProjectSummary) {
    const value = await choose(ui, {
      title: t('statusDialog.title'),
      icon: 'flag',
      value: project.status,
      cancelText: t('dialog.cancel'),
      choices: ProjectStatusSchema.options.map((status) => ({ value: status, label: t(`projectStatus.${status}`) })),
    });
    if (value) await attempt(() => store.update(project.id, { status: value }));
  }

  async function forget(project: ProjectSummary) {
    const ok = await atrium.modal.confirm({
      title: t('forget.title', { name: project.name }),
      message: t('forget.message'),
      confirmText: t('forget.confirm'),
      cancelText: t('dialog.cancel'),
      danger: true,
    });
    if (ok) await attempt(() => store.forget(project.id));
  }

  function projectMenu(project: ProjectSummary): MenuEntry[] {
    if (project.missing) {
      return [
        { label: t('menu.forget'), icon: 'x-circle', danger: true, onClick: () => void forget(project) },
      ];
    }
    return [
      { label: t('menu.open'), icon: 'box-arrow-in-right', onClick: () => void navigation.openProject(project.id) },
      {
        label: project.favorite ? t('menu.unfavorite') : t('menu.favorite'),
        icon: project.favorite ? 'star' : 'star-fill',
        onClick: () => void attempt(() => store.update(project.id, { favorite: !project.favorite })),
      },
      'separator',
      { label: t('menu.rename'), icon: 'pencil', onClick: () => void rename(project) },
      { label: t('menu.tags'), icon: 'tags', onClick: () => void chooseTags(project) },
      { label: t('menu.collection'), icon: 'folder2', onClick: () => void chooseCollection(project) },
      { label: t('menu.status'), icon: 'flag', onClick: () => void chooseStatus(project) },
      { label: t('menu.cover'), icon: 'image', onClick: () => void attempt(() => store.setCover(project.id)) },
      ...(project.cover
        ? [{ label: t('menu.removeCover'), icon: 'image-alt', onClick: () => void attempt(() => store.removeCover(project.id)) }]
        : []),
      'separator',
      { label: t('menu.reveal'), icon: 'folder2-open', onClick: () => void attempt(() => window.tessera.invoke('projects:reveal', { id: project.id })) },
      { label: t('menu.forget'), icon: 'x-circle', danger: true, onClick: () => void forget(project) },
    ];
  }

  async function createTag() {
    const values = await editTag(ui);
    if (values) await attempt(() => store.upsertTag(values));
  }

  async function createCollection() {
    const name = await atrium.modal.prompt({
      title: t('collection.newTitle'),
      label: t('collection.name'),
      icon: 'folder-plus',
      confirmText: t('dialog.create'),
      cancelText: t('dialog.cancel'),
      validate: (value) => (value.trim().length > 48 ? t('error.required') : null),
    });
    if (name) await attempt(() => store.upsertCollection({ name: name.trim() }));
  }

  function tagMenu(tag: Tag): MenuEntry[] {
    return [
      {
        label: t('menu.editTag'),
        icon: 'pencil',
        onClick: async () => {
          const values = await editTag(ui, tag);
          if (values) await attempt(() => store.upsertTag({ id: tag.id, ...values }));
        },
      },
      {
        label: t('menu.deleteTag'),
        icon: 'trash3',
        danger: true,
        onClick: async () => {
          const ok = await atrium.modal.confirm({
            title: t('deleteTag.title', { name: tag.name }),
            message: t('deleteTag.message'),
            confirmText: t('delete.confirm'),
            cancelText: t('dialog.cancel'),
            danger: true,
          });
          if (ok) await attempt(() => store.deleteTag(tag.id));
        },
      },
    ];
  }

  function collectionMenu(collection: Collection): MenuEntry[] {
    return [
      {
        label: t('menu.renameCollection'),
        icon: 'pencil',
        onClick: async () => {
          const name = await atrium.modal.prompt({
            title: t('collection.renameTitle'),
            label: t('collection.name'),
            value: collection.name,
            icon: 'pencil',
            confirmText: t('dialog.save'),
            cancelText: t('dialog.cancel'),
          });
          if (name) await attempt(() => store.upsertCollection({ id: collection.id, name: name.trim() }));
        },
      },
      {
        label: t('menu.deleteCollection'),
        icon: 'trash3',
        danger: true,
        onClick: async () => {
          const ok = await atrium.modal.confirm({
            title: t('deleteCollection.title', { name: collection.name }),
            message: t('deleteCollection.message'),
            confirmText: t('delete.confirm'),
            cancelText: t('dialog.cancel'),
            danger: true,
          });
          if (ok) await attempt(() => store.deleteCollection(collection.id));
        },
      },
    ];
  }

  return { newProject, fromGamebanana, importProject, projectMenu, createTag, createCollection, tagMenu, collectionMenu };
}

export type ProjectActions = ReturnType<typeof createProjectActions>;
