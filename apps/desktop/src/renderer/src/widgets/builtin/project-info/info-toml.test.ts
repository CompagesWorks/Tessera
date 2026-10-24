import { describe, expect, it } from 'vitest';
import { readInfo, writeInfo } from './info-toml';

describe('info.toml', () => {
  it('reads and rewrites only the known keys', () => {
    const text = 'display_name = "Old"\n# keep me\nother = 3\nversion = "1.0"\n';
    expect(readInfo(text)).toEqual({ display_name: 'Old', version: '1.0' });
    const out = writeInfo(text, { display_name: 'Mario "Classic"', version: '', description: 'a\nb' });
    expect(out).toBe('display_name = "Mario \\"Classic\\""\n# keep me\nother = 3\ndescription = "a\\nb"\n');
    expect(readInfo(out)).toEqual({ display_name: 'Mario "Classic"', description: 'a\nb' });
  });

  it('refuses syntax the form cannot keep', () => {
    expect(readInfo("display_name = 'literal'")).toBeNull();
    expect(readInfo('description = """\nmulti\n"""')).toBeNull();
  });
});
