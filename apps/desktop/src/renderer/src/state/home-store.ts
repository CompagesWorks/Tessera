import type { Collection, HomeData, ProjectPatch, ProjectSummary, Tag } from '@tessera/protocol';

type Listener = (data: HomeData) => void;

const api = () => window.tessera;

export class HomeStore {
  private data: HomeData = { projects: [], tags: [], collections: [], defaultLocation: '' };
  private readonly listeners = new Set<Listener>();

  get current(): HomeData {
    return this.data;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh() {
    this.data = await api().invoke('projects:home');
    this.emit();
  }

  project(id: string): ProjectSummary | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  tag(id: string): Tag | undefined {
    return this.data.tags.find((t) => t.id === id);
  }

  collection(id: string): Collection | undefined {
    return this.data.collections.find((c) => c.id === id);
  }

  async update(id: string, patch: ProjectPatch) {
    this.replace(await api().invoke('projects:update', { id, patch }));
  }

  async setCover(id: string) {
    const project = await api().invoke('projects:set-cover', { id });
    if (project) this.replace(project);
  }

  async removeCover(id: string) {
    this.replace(await api().invoke('projects:remove-cover', { id }));
  }

  async forget(id: string) {
    await api().invoke('projects:forget', { id });
    this.data = { ...this.data, projects: this.data.projects.filter((p) => p.id !== id) };
    this.emit();
  }

  async upsertTag(tag: { id?: string; name: string; color: string }) {
    const saved = await api().invoke('tags:upsert', tag);
    await this.refresh();
    return saved;
  }

  async deleteTag(id: string) {
    await api().invoke('tags:delete', { id });
    await this.refresh();
  }

  async upsertCollection(collection: { id?: string; name: string }) {
    const saved = await api().invoke('collections:upsert', collection);
    await this.refresh();
    return saved;
  }

  async deleteCollection(id: string) {
    await api().invoke('collections:delete', { id });
    await this.refresh();
  }

  replace(project: ProjectSummary) {
    const exists = this.data.projects.some((p) => p.id === project.id);
    const projects = exists ? this.data.projects.map((p) => (p.id === project.id ? project : p)) : [...this.data.projects, project];
    this.data = { ...this.data, projects };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener(this.data);
  }
}
