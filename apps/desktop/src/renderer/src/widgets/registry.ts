import { explorerWidget } from './builtin/explorer/explorer';
import { notesWidget } from './builtin/notes/notes';
import { projectInfoWidget } from './builtin/project-info/project-info';
import type { WidgetDefinition } from './types';

const definitions = new Map<string, WidgetDefinition>();

export function registerWidget(definition: WidgetDefinition) {
  definitions.set(definition.type, definition);
}

export function widgetDefinition(type: string): WidgetDefinition | undefined {
  return definitions.get(type);
}

export function allWidgets(): WidgetDefinition[] {
  return [...definitions.values()];
}

[explorerWidget, notesWidget, projectInfoWidget].forEach(registerWidget);
