import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/prc/prc.js?raw';
const { parsePrc, writePrc, prcValue, hash40 } = new Function(`${source}; return { parsePrc, writePrc, prcValue, hash40 };`)();

const sample = {
  type: 'struct',
  children: [
    { hash: hash40('walk_speed_max'), param: { type: 'float', value: Math.fround(1.5) } },
    { hash: hash40('jump_count'), param: { type: 'i32', value: 2 } },
    {
      hash: hash40('fighter_param_table'),
      param: {
        type: 'list',
        children: [
          {
            type: 'struct',
            children: [
              { hash: hash40('fighter_kind'), param: { type: 'hash40', value: hash40('fighter_kind_mario') } },
              { hash: hash40('name'), param: { type: 'string', value: 'Mario é' } },
              { hash: hash40('is_ok'), param: { type: 'bool', value: true } },
              { hash: hash40('slot'), param: { type: 'u8', value: 7 } },
              { hash: hash40('offset'), param: { type: 'i16', value: -300 } },
            ],
          },
        ],
      },
    },
  ],
};

const byHash = (node: { type: string; children?: { hash: number }[] }) =>
  node.type === 'struct' ? { ...node, children: [...node.children!].sort((a, b) => a.hash - b.hash) } : node;

describe('prc', () => {
  it('hashes like the game', () => {
    expect(hash40('-1')).toBe(0x02302d482a);
  });

  it('round-trips every param type', () => {
    const parsed = parsePrc(writePrc(sample));
    expect(parsed.children.map((c: { hash: number }) => c.hash)).toEqual(byHash(sample).children!.map((c) => c.hash));
    expect(writePrc(parsed)).toEqual(writePrc(sample));
    const entry = parsed.children.find((c: { hash: number }) => c.hash === hash40('fighter_param_table')).param.children[0];
    expect(entry.children.find((c: { hash: number }) => c.hash === hash40('name')).param.value).toBe('Mario é');
  });

  it('validates typed values', () => {
    expect(prcValue('u8', '255')).toBe(255);
    expect(() => prcValue('u8', '256')).toThrow('invalid-value');
    expect(() => prcValue('i32', '1.5')).toThrow('invalid-value');
    expect(prcValue('float', '0.3')).toBe(Math.fround(0.3));
    expect(prcValue('hash40', '0x02302d482a')).toBe(hash40('-1'));
    expect(prcValue('hash40', 'fighter_kind_mario')).toBe(hash40('fighter_kind_mario'));
  });

  it('refuses other files', () => {
    expect(() => parsePrc(new Uint8Array(32))).toThrow('not-prc');
    expect(() => parsePrc(writePrc(sample).slice(0, 40))).toThrow();
  });
});
