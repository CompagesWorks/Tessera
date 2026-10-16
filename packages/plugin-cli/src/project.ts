import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { CliError } from './log';

export const CONFIG_FILE = 'tessera-plugin.json';

const ConfigSchema = z
  .object({
    plugin: z.string().min(1).default('plugin'),
    rust: z.string().min(1).optional(),
  })
  .strict();

export interface Project {
  root: string;
  plugin: string;
  rust: string | null;
}

export function loadProject(dir = '.'): Project {
  const root = resolve(dir);
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) return { root, plugin: root, rust: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CliError(`${CONFIG_FILE} is not valid JSON`);
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) throw new CliError(`${CONFIG_FILE}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  return { root, plugin: resolve(root, parsed.data.plugin), rust: parsed.data.rust ? resolve(root, parsed.data.rust) : null };
}
