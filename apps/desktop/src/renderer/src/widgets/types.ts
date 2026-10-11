import type { ProjectSummary } from '@tessera/protocol';
import type { MessageKey } from '../i18n';
import type { UiProvider } from '../ui/provider';

export interface WidgetContext {
  project: ProjectSummary;
  ui: UiProvider;
  state: Record<string, unknown>;
  setState(state: Record<string, unknown>): void;
}

export interface WidgetHandle {
  element: HTMLElement;
  dispose?(): void;
}

export interface WidgetDefinition {
  type: string;
  title: MessageKey;
  description: MessageKey;
  icon: string;
  source: string;
  create(ctx: WidgetContext): WidgetHandle;
}
