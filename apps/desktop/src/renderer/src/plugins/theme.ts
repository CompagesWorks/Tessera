import type { InstalledPlugin, PluginTheme } from '@tessera/protocol';

let applied: string[] = [];

export function themeKey(pluginId: string, themeId: string) {
  return `${pluginId}/${themeId}`;
}

export function findTheme(plugins: InstalledPlugin[], key: string | null): PluginTheme | null {
  if (!key) return null;
  for (const plugin of plugins) {
    if (!plugin.enabled || !plugin.granted.includes('ui.theme')) continue;
    const theme = plugin.manifest.contributes.themes.find((t) => themeKey(plugin.manifest.id, t.id) === key);
    if (theme) return theme;
  }
  return null;
}

export function applyThemeTokens(tokens: Record<string, string>) {
  const style = document.documentElement.style;
  for (const name of applied) style.removeProperty(name);
  applied = [];
  for (const [name, value] of Object.entries(tokens)) {
    if (!name.startsWith('--atrium-')) continue;
    style.setProperty(name, value);
    applied.push(name);
  }
}
