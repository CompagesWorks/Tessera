import { explorerWidget } from './builtin/explorer/explorer';
import { backupsWidget } from './builtin/backups/backups';
import { notesWidget } from './builtin/notes/notes';
import { previewWidget } from './builtin/preview/preview';
import { projectInfoWidget } from './builtin/project-info/project-info';
import type { WidgetDefinition } from './types';

const definitions = new Map<string, WidgetDefinition>();
const listeners = new Set<() => void>();

export function registerWidget(definition: WidgetDefinition) {
  definitions.set(definition.type, definition);
}

export function replacePluginWidgets(list: WidgetDefinition[]) {
  for (const [type, definition] of definitions) if (definition.trust === 'plugin') definitions.delete(type);
  list.forEach(registerWidget);
  listeners.forEach((listener) => listener());
}

export function onWidgetsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function widgetDefinition(type: string): WidgetDefinition | undefined {
  return definitions.get(type);
}

export function allWidgets(): WidgetDefinition[] {
  return [...definitions.values()];
}

[explorerWidget, previewWidget, notesWidget, projectInfoWidget, backupsWidget].forEach(registerWidget);
