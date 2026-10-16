import type { InstalledPlugin } from '@tessera/protocol';
import { providerUrl } from '../bridge/schemes';
import type { UiProvider } from '../ui/provider';

const FUNCTIONS = ['toast', 'modal', 'registerCommands', 'setTheme', 'setMotion'] as const;

export interface ProviderResult {
  ui: UiProvider;
  plugin: InstalledPlugin | null;
  error: string | null;
}

export async function loadUiProvider(base: UiProvider, id: string | null, plugins: InstalledPlugin[]): Promise<ProviderResult> {
  if (!id) return { ui: base, plugin: null, error: null };
  const plugin = plugins.find((p) => p.manifest.id === id && p.enabled && p.granted.includes('ui.provider'));
  const entry = plugin?.manifest.contributes.uiProvider?.entry;
  if (!plugin || !entry) return { ui: base, plugin: null, error: 'provider unavailable' };
  try {
    const module = (await import(/* @vite-ignore */ providerUrl(id, entry))) as { default?: unknown };
    if (typeof module.default !== 'function') throw new Error('the module has no default export function');
    const result = (await module.default({ base, atrium: base.atrium })) as Partial<UiProvider> | null;
    if (!result || typeof result !== 'object') throw new Error('the factory must return an object');
    const ui: UiProvider = { ...base, name: typeof result.name === 'string' ? result.name : plugin.manifest.name };
    for (const name of FUNCTIONS) {
      const fn = result[name];
      if (typeof fn === 'function') Object.assign(ui, { [name]: fn.bind(result) });
    }
    if (result.atrium && typeof result.atrium === 'object') Object.assign(ui, { atrium: result.atrium });
    return { ui, plugin, error: null };
  } catch (error) {
    console.error('[ui-provider] failed', error);
    return { ui: base, plugin, error: error instanceof Error ? error.message : String(error) };
  }
}
