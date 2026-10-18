import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/archives/sarc.js?raw';
const { readArchive, writeArchive, sarcHash } = new Function(`${source}; return { readArchive, writeArchive, sarcHash };`)();

const bytes = (text: string) => new TextEncoder().encode(text);
const files = [
  { name: 'blyt/main.bflyt', data: bytes('FLYT layout'), align: 4 },
  { name: 'timg/__Combined.bntx', data: bytes('BNTX texture'), align: 0x1000 },
  { name: '@0029856c', data: bytes('no name'), align: 8 },
];

describe('sarc', () => {
  it('hashes names like the game', () => {
    expect(sarcHash('a', 0x65)).toBe(0x61);
    expect(sarcHash('ab', 0x65)).toBe((0x61 * 0x65 + 0x62) >>> 0);
  });

  it.each([
    [true, false],
    [false, false],
    [true, true],
  ])('round-trips files, names and alignment (little %s, yaz0 %s)', (little, yaz0) => {
    const out = writeArchive({ little, yaz0, files });
    if (yaz0) expect(String.fromCharCode(...out.subarray(0, 4))).toBe('Yaz0');
    const read = readArchive(out);
    expect(read).toMatchObject({ little, yaz0, key: 0x65 });
    for (const file of files) {
      const found = read.files.find((f: { name: string }) => f.name === file.name);
      expect([...found.data]).toEqual([...file.data]);
      expect(found.align).toBeGreaterThanOrEqual(file.align);
    }
  });

  it('refuses other files', () => {
    expect(() => readArchive(new Uint8Array(64))).toThrow('not-sarc');
    expect(() => readArchive(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0]))).toThrow('zstd');
  });
});
