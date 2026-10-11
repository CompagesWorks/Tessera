import { access } from 'node:fs/promises';
import { join } from 'node:path';

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function folderName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  if (!cleaned || RESERVED.test(cleaned)) return 'projet';
  return cleaned;
}

export async function uniqueFolder(parent: string, base: string): Promise<string> {
  for (let i = 1; i < 1000; i++) {
    const candidate = join(parent, i === 1 ? base : `${base}-${i}`);
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new Error('No free folder name');
}
