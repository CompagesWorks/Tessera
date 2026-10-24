import { describe, expect, it } from 'vitest';
import { PluginManifestSchema, permissionKey } from './plugins';

const sha = 'a'.repeat(64);
const manifest = (url: string, programs: string[]) => ({
  id: 'test.plugin',
  name: 'Test',
  version: '1.0.0',
  author: 'Me',
  engines: { tessera: '^0.1.0' },
  permissions: [
    { id: 'exec.system', programs },
    { id: 'exec.install', programs: { tool: { windows: { url, sha256: sha, file: 'bin/tool.exe' }, linux: { url, sha256: sha, file: 'tool' } } } },
  ],
});

describe('exec.install', () => {
  it('parses downloads and builds the same key as the host', () => {
    const parsed = PluginManifestSchema.parse(manifest('https://example.com/tool.zip', ['tool']));
    expect(parsed.installs.tool?.windows?.file).toBe('bin/tool.exe');
    expect(permissionKey(parsed, 'exec.install')).toBe(`exec.install[tool:linux@${sha},tool:windows@${sha}]`);
  });

  it('refuses http and programs missing from exec.system', () => {
    expect(PluginManifestSchema.safeParse(manifest('http://example.com/tool.zip', ['tool'])).success).toBe(false);
    expect(PluginManifestSchema.safeParse(manifest('https://example.com/tool.zip', ['other'])).success).toBe(false);
  });
});
