import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/config/config.js?raw';
const { addToConfig, configDirOf } = new Function(`${source}; return { addToConfig, configDirOf };`)();

describe('config plugin', () => {
  it('picks the dir info from the path', () => {
    expect(configDirOf('fighter/mario/model/body/c08/model.numdlb')).toBe('fighter/mario/c08');
    expect(configDirOf('fighter/kirby/model/copy_mario_cap/c03/model.numdlb')).toBe('fighter/kirby/c03');
    expect(configDirOf('camera/fighter/mario/c08/j02_win1.nuanmb')).toBe('fighter/mario/c08/camera');
    expect(configDirOf('effect/fighter/mario/ef_mario_c08.eff')).toBe('fighter/mario/c08');
    expect(configDirOf('sound/bank/fighter_voice/vc_pikachu_c04.nus3audio')).toBe('fighter/pikachu/c04');
    expect(configDirOf('ui/layout/menu/custom/layout.arc')).toBe('ui/layout/menu/custom');
    expect(() => configDirOf('info.toml')).toThrow('no-dir');
  });

  it('creates the config when there is none', () => {
    const { added, text } = addToConfig('', 'fighter/mario/model/body/c08/model.numdlb');
    expect(added).toBe(true);
    expect(text).toBe('{\n    "new-dir-files": {\n        "fighter/mario/c08": [\n            "fighter/mario/model/body/c08/model.numdlb"\n        ]\n    }\n}\n');
  });

  it('merges into the existing structure and keeps its indentation', () => {
    const existing = '{\r\n  "share-to-vanilla": {\r\n    "a": "b"\r\n  },\r\n  "new-dir-files": {\r\n    "fighter/mario/c08": [\r\n      "fighter/mario/model/body/c08/a.nutexb"\r\n    ]\r\n  }\r\n}';
    const { added, text } = addToConfig(existing, 'fighter/mario/model/body/c08/b.nutexb');
    expect(added).toBe(true);
    expect(text).not.toMatch(/\r?\n$/);
    expect(text.split('\r\n')[1]).toBe('  "share-to-vanilla": {');
    expect(JSON.parse(text)).toEqual({
      'share-to-vanilla': { a: 'b' },
      'new-dir-files': { 'fighter/mario/c08': ['fighter/mario/model/body/c08/a.nutexb', 'fighter/mario/model/body/c08/b.nutexb'] },
    });
  });

  it('does nothing for a duplicate, whatever its key or case', () => {
    const existing = JSON.stringify({ 'new-dir-files': { other: ['Fighter/Mario/model/body/c08/a.nutexb'] } }, null, 4);
    expect(addToConfig(existing, 'fighter/mario/model/body/c08/a.nutexb')).toEqual({ added: false, dir: 'fighter/mario/c08', text: existing });
  });

  it('refuses to overwrite a broken config', () => {
    expect(() => addToConfig('{ "new-dir-files": ', 'fighter/mario/model/body/c08/a.nutexb')).toThrow('invalid-config');
    expect(() => addToConfig('{ "new-dir-files": [] }', 'fighter/mario/model/body/c08/a.nutexb')).toThrow('invalid-config');
  });
});
