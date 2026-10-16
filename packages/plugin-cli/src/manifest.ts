import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PluginManifestSchema, type PluginManifest } from '@tessera/protocol';
import { CliError } from './log';

const MAX_MANIFEST_BYTES = 64 * 1024;

export function readManifest(plugin: string): PluginManifest {
  const file = join(plugin, 'manifest.json');
  if (!existsSync(file)) throw new CliError(`no manifest.json in ${plugin}`);
  if (statSync(file).size > MAX_MANIFEST_BYTES) throw new CliError('manifest.json is larger than 64 KB');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    throw new CliError(`manifest.json is not valid JSON (${(error as Error).message})`);
  }
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.') || 'manifest'}: ${issue.message}`);
    throw new CliError(`manifest.json is invalid:\n${lines.join('\n')}`);
  }
  const manifest = parsed.data;
  const entries = [...manifest.contributes.widgets.map((widget) => widget.entry), ...(manifest.contributes.uiProvider ? [manifest.contributes.uiProvider.entry] : [])];
  for (const entry of entries) {
    const path = join(plugin, ...entry.split('/'));
    if (!existsSync(path) || !statSync(path).isFile()) throw new CliError(`${entry} is declared in manifest.json but does not exist`);
  }
  return manifest;
}
