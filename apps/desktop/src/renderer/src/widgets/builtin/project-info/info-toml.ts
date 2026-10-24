export const INFO_KEYS = ['display_name', 'authors', 'version', 'category', 'description'] as const;
export type InfoKey = (typeof INFO_KEYS)[number];
export type Info = Partial<Record<InfoKey, string>>;

const LINE = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/;
const keyOf = (line: string) => LINE.exec(line)?.[1] as InfoKey | undefined;
const isInfoKey = (key: string | undefined): key is InfoKey => INFO_KEYS.includes(key as InfoKey);

export function readInfo(text: string): Info | null {
  const info: Info = {};
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (!match || !isInfoKey(match[1])) continue;
    try {
      const value: unknown = JSON.parse(match[2]!);
      if (typeof value !== 'string') return null;
      info[match[1]] = value;
    } catch {
      return null;
    }
  }
  return info;
}

export function writeInfo(text: string, info: Info): string {
  const lines = text.split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  for (const key of INFO_KEYS) {
    const value = info[key]?.trim() ?? '';
    const index = lines.findIndex((line) => keyOf(line) === key);
    const line = `${key} = ${JSON.stringify(value)}`;
    if (value && index >= 0) lines[index] = line;
    else if (value) lines.push(line);
    else if (index >= 0) lines.splice(index, 1);
  }
  return `${lines.join('\n')}\n`;
}
