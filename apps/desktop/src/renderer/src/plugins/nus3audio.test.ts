import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/nus3audio/nus3audio.js?raw';
const { parseNus3audio, writeNus3audio, nus3Format, pcm16Wav } = new Function(`${source}; return { parseNus3audio, writeNus3audio, nus3Format, pcm16Wav };`)();

const files = [
  { id: 0, name: 'bgm_mario', data: new Uint8Array([0x01, 0x00, 0x00, 0x80, 1, 2, 3]) },
  { id: 7, name: 'se_é', data: new Uint8Array([0x49, 0x44, 0x53, 0x50, ...new Array(30).fill(9)]) },
];

describe('nus3audio', () => {
  it('round-trips tracks', () => {
    const bytes = writeNus3audio({ files });
    expect(new DataView(bytes.buffer).getUint32(4, true)).toBe(bytes.length - 8);
    const parsed = parseNus3audio(bytes);
    expect(parsed.files.map((f: { id: number; name: string }) => [f.id, f.name])).toEqual([[0, 'bgm_mario'], [7, 'se_é']]);
    expect([...parsed.files[1].data]).toEqual([...files[1]!.data]);
    expect(parsed.files.map((f: { data: Uint8Array }) => nus3Format(f.data))).toEqual(['lopus', 'idsp']);
    expect(writeNus3audio(parsed)).toEqual(bytes);
  });

  it('aligns track data to 16 bytes', () => {
    const view = new DataView(writeNus3audio({ files }).buffer);
    const adof = 8 + 16 + (8 + 8) * 2 + 8;
    expect(view.getUint32(adof, true) % 16).toBe(0);
    expect(view.getUint32(adof + 8, true) % 16).toBe(0);
  });

  it('writes an empty file and rejects garbage', () => {
    expect(parseNus3audio(writeNus3audio({ files: [] })).files).toEqual([]);
    expect(() => parseNus3audio(new Uint8Array(16))).toThrow('not-nus3audio');
  });

  it('writes 16-bit PCM wav', () => {
    const wav = pcm16Wav([new Float32Array([0, 1, -2]), new Float32Array([0.5, -1, 0])], 48000);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect([view.getUint16(22, true), view.getUint32(24, true), view.getUint32(40, true)]).toEqual([2, 48000, 12]);
    expect([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 16384, 32767, -32767, -32767, 0]);
  });
});
