import type { ProjectSummary, WidgetCategory } from '@tessera/protocol';
import type { UiProvider } from '../ui/provider';

export interface WidgetContext {
  widgetId: string;
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
  title(): string;
  description(): string;
  icon: string;
  category: WidgetCategory;
  source: string;
  trust: 'builtin' | 'plugin';
  create(ctx: WidgetContext): WidgetHandle;
}
