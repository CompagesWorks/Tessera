import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/msbt/msbt.js?raw';
const { parseMsbt, writeMsbt, parseXmsbt, writeXmsbt } = new Function(`${source}; return { parseMsbt, writeMsbt, parseXmsbt, writeXmsbt };`)();

function sample(texts: string[]) {
  const header = new Uint8Array(0x20);
  header.set([...'MsgStdBn'].map((c) => c.charCodeAt(0)));
  header.set([0xff, 0xfe, 0, 0, 1, 3, 2, 0], 8);
  const names = texts.map((_, i) => `label_${i}`);
  const lbl = new Uint8Array(12 + names.reduce((sum, n) => sum + 5 + n.length, 0));
  const view = new DataView(lbl.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, names.length, true);
  view.setUint32(8, 12, true);
  let at = 12;
  names.forEach((name, i) => {
    lbl[at] = name.length;
    lbl.set([...name].map((c) => c.charCodeAt(0)), at + 1);
    view.setUint32(at + 1 + name.length, i, true);
    at += 5 + name.length;
  });
  const file = {
    little: true,
    header,
    sections: [{ magic: 'LBL1', data: lbl }, { magic: 'TXT2', data: new Uint8Array() }],
    entries: texts.map((text, index) => ({ index, label: names[index], text })),
  };
  return writeMsbt(file);
}

describe('msbt', () => {
  it('round-trips labels, tags and brackets', () => {
    const texts = ['Hello [0.3:0a00]Mario[/0.3]', 'a [[b] é', ''];
    const bytes = sample(texts);
    const parsed = parseMsbt(bytes);
    expect(parsed.entries.map((e: { label: string; text: string }) => [e.label, e.text])).toEqual(texts.map((t, i) => [`label_${i}`, t]));
    expect(writeMsbt(parsed)).toEqual(bytes);
  });

  it('applies edits and keeps the file size field right', () => {
    const parsed = parseMsbt(sample(['one', 'two']));
    const out = writeMsbt(parsed, new Map([[1, 'a much longer second text']]));
    expect(new DataView(out.buffer).getUint32(0x12, true)).toBe(out.length);
    expect(parseMsbt(out).entries[1].text).toBe('a much longer second text');
  });

  it('refuses other files and bad tags', () => {
    expect(() => parseMsbt(new Uint8Array(64))).toThrow('not-msbt');
    expect(() => writeMsbt(parseMsbt(sample(['x'])), new Map([[0, '[1.2:abc]']]))).toThrow('bad-tag');
  });

  it('edits xmsbt and keeps UTF-16LE with BOM', () => {
    const xml = `<?xml version="1.0" encoding="utf-16"?>
<xmsbt>
  <entry label="nam_chr1_00_mario">
    <text>Mario</text>
  </entry>
  <entry label="b"><text>a &amp; b</text></entry>
</xmsbt>`;
    const bytes = new Uint8Array(2 + xml.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < xml.length; i++) new DataView(bytes.buffer).setUint16(2 + i * 2, xml.charCodeAt(i), true);
    const parsed = parseXmsbt(bytes);
    expect(parsed.entries.map((e: { label: string; text: string }) => [e.label, e.text])).toEqual([['nam_chr1_00_mario', 'Mario'], ['b', 'a & b']]);
    const out = writeXmsbt(parsed, new Map([[0, 'Mario <Dr>']]));
    expect([...out.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    const text = new TextDecoder('utf-16le').decode(out.subarray(2));
    expect(text.startsWith('<?xml version="1.0" encoding="utf-16"?>')).toBe(true);
    expect(parseXmsbt(out).entries.map((e: { text: string }) => e.text)).toEqual(['Mario <Dr>', 'a & b']);
    expect(() => parseXmsbt(new TextEncoder().encode('<nope/>'))).toThrow('not-xmsbt');
  });
});
