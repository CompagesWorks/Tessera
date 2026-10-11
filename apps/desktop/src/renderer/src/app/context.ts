import type { AppInfo, ProjectSummary } from '@tessera/protocol';
import type { Statusbar } from 'atrium-ui';
import type { HomeStore } from '../state/home-store';
import type { UiProvider } from '../ui/provider';

export interface Navigation {
  readonly current: ProjectSummary | null;
  openProject(id: string): Promise<void>;
  closeProject(): void;
  onChange(listener: (project: ProjectSummary | null) => void): () => void;
}

export interface AppContext {
  ui: UiProvider;
  info: AppInfo;
  store: HomeStore;
  status: Statusbar;
  navigation: Navigation;
}
