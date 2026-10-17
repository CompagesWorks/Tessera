import { describe, expect, it } from 'vitest';
import { parseH264 } from './h264-stream';

const nal = (...bytes: number[]) => [0, 0, 0, 1, ...bytes];
const sps = nal(0x67, 0x64, 0x00, 0x1f, 0xac);
const pps = nal(0x68, 0xee);
const idr = (first: boolean) => nal(0x65, first ? 0x88 : 0x08, 0x01);
const slice = (first: boolean) => nal(0x41, first ? 0x9a : 0x1a, 0x02);

describe('parseH264', () => {
  it('groups NAL units into frames and reads the codec', () => {
    const stream = parseH264(new Uint8Array([...nal(0x41, 0x9a), ...sps, ...pps, ...idr(true), ...idr(false), ...nal(0x09, 0xf0), ...slice(true), ...slice(true), ...slice(false)]));
    expect(stream.codec).toBe('avc1.64001f');
    expect(stream.units.map((unit) => unit.key)).toEqual([true, false, false]);
    expect(stream.units[0]!.data.length).toBe(sps.length + pps.length + idr(true).length * 2);
    expect(stream.units[2]!.data.length).toBe(slice(true).length * 2);
  });

  it('returns nothing without a keyframe', () => {
    expect(parseH264(new Uint8Array([...slice(true), ...slice(true)])).units).toEqual([]);
  });
});
