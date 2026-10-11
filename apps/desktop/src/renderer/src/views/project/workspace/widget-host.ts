import type { ProjectSummary } from '@tessera/protocol';
import type { DockWidgets } from '../../../components/dock/dock';
import { t } from '../../../i18n';
import type { UiProvider } from '../../../ui/provider';
import { widgetDefinition } from '../../../widgets/registry';
import type { WidgetHandle } from '../../../widgets/types';

interface Options {
  project: ProjectSummary;
  ui: UiProvider;
  instance(widgetId: string): { type: string; state: Record<string, unknown> } | undefined;
  saveState(widgetId: string, state: Record<string, unknown>): void;
}

function missingWidget(type: string): WidgetHandle {
  const element = document.createElement('div');
  element.className = 'tessera-widget-missing';
  element.innerHTML = '<i class="bi bi-puzzle"></i>';
  const title = document.createElement('b');
  title.textContent = t('dock.missingWidget');
  const code = document.createElement('code');
  code.textContent = type;
  element.append(title, code);
  return { element };
}

export function createWidgetHost(options: Options): DockWidgets & { prune(alive: Set<string>): void; dispose(): void } {
  const mounted = new Map<string, WidgetHandle>();

  const dispose = (widgetId: string) => {
    const handle = mounted.get(widgetId);
    if (!handle) return;
    try {
      handle.dispose?.();
    } catch (error) {
      console.error('[widget] dispose failed', error);
    }
    handle.element.remove();
    mounted.delete(widgetId);
  };

  return {
    element(widgetId) {
      const existing = mounted.get(widgetId);
      if (existing) return existing.element;
      const instance = options.instance(widgetId);
      const definition = instance && widgetDefinition(instance.type);
      let handle: WidgetHandle;
      if (!instance || !definition) {
        handle = missingWidget(instance?.type ?? widgetId);
      } else {
        try {
          handle = definition.create({
            project: options.project,
            ui: options.ui,
            state: structuredClone(instance.state),
            setState: (state) => options.saveState(widgetId, state),
          });
        } catch (error) {
          console.error('[widget] create failed', error);
          handle = missingWidget(instance.type);
        }
      }
      mounted.set(widgetId, handle);
      return handle.element;
    },

    label(widgetId) {
      const instance = options.instance(widgetId);
      const definition = instance && widgetDefinition(instance.type);
      return definition ? { title: t(definition.title), icon: definition.icon } : { title: t('dock.missingWidget'), icon: 'puzzle' };
    },

    prune(alive) {
      for (const widgetId of [...mounted.keys()]) if (!alive.has(widgetId)) dispose(widgetId);
    },

    dispose() {
      for (const widgetId of [...mounted.keys()]) dispose(widgetId);
    },
  };
}
