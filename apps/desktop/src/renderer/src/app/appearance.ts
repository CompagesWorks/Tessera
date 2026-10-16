import type { ThemeMode } from '@tessera/protocol';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return media.matches ? 'dark' : 'light';
  return mode;
}

export function onSystemThemeChange(listener: () => void): () => void {
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

function mix(hex: string, target: number, amount: number): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${channels.map((c) => Math.round(c + (target - c) * amount).toString(16).padStart(2, '0')).join('')}`;
}

export function accentTokens(accent: string | null): Record<string, string> {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return {};
  const rgb = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16)).join(', ');
  return {
    '--atrium-accent-color': accent,
    '--atrium-accent-rgb': rgb,
    '--atrium-accent-hover': mix(accent, 255, 0.15),
    '--atrium-accent-gradient-start': accent,
    '--atrium-accent-gradient-end': mix(accent, 255, 0.3),
    '--atrium-bg-accent-subtle': `rgba(${rgb}, 0.12)`,
  };
}
