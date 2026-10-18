import { describe, expect, it } from 'vitest';
import source from '../../../../plugins/layouts/bflyt.js?raw';
const { readBflyt, writeBflyt } = new Function(`${source}; return { readBflyt, writeBflyt };`)();

function section(magic: string, body: number[]) {
  const out = new Uint8Array(8 + body.length);
  out.set([...magic].map((c) => c.charCodeAt(0)));
  new DataView(out.buffer).setUint32(4, out.length, true);
  out.set(body, 8);
  return [...out];
}

function pane(name: string, x: number, width: number, height: number, extra: number[] = []) {
  const body = new Uint8Array(0x4c + extra.length);
  const view = new DataView(body.buffer);
  body.set([1, 0, 255, 0]);
  body.set([...name].map((c) => c.charCodeAt(0)), 4);
  view.setFloat32(36, x, true);
  view.setFloat32(60, 1, true);
  view.setFloat32(64, 1, true);
  view.setFloat32(68, width, true);
  view.setFloat32(72, height, true);
  body.set(extra, 0x4c);
  return [...body];
}

function file() {
  const lyt = new Uint8Array(24);
  new DataView(lyt.buffer).setFloat32(4, 1920, true);
  new DataView(lyt.buffer).setFloat32(8, 1080, true);
  const txt = new Uint8Array(0x54 + 12);
  const view = new DataView(txt.buffer);
  view.setUint16(0, 6, true);
  view.setUint16(2, 6, true);
  view.setUint32(0x10, 0xa8, true);
  view.setFloat32(0x20, 32, true);
  view.setUint32(0x2c, 0xb0, true);
  txt.set([255, 0, 0, 255], 0x14);
  txt.set([0x48, 0, 0x69, 0, 0, 0], 0x54);
  txt.set([0x69, 0x64, 0], 0x5c);
  const sections = [section('lyt1', [...lyt]), section('pan1', pane('RootPane', 0, 1920, 1080)), section('pas1', []), section('txt1', pane('txt_name', -10, 200, 40, [...txt])), section('pae1', [])];
  const header = new Uint8Array(0x14);
  header.set([0x46, 0x4c, 0x59, 0x54, 0xff, 0xfe, 0x14, 0]);
  new DataView(header.buffer).setUint32(8, 0x09000000, true);
  new DataView(header.buffer).setUint16(0x10, sections.length, true);
  new DataView(header.buffer).setUint32(0x0c, 0x14 + sections.flat().length, true);
  return new Uint8Array([...header, ...sections.flat()]);
}

describe('bflyt', () => {
  it('reads the layout size and the pane tree', () => {
    const layout = readBflyt(file());
    expect([layout.width, layout.height]).toEqual([1920, 1080]);
    expect(layout.root).toMatchObject({ type: 'pane', name: 'RootPane', width: 1920 });
    expect(layout.root.children).toHaveLength(1);
    expect(layout.root.children[0]).toMatchObject({ type: 'text', name: 'txt_name', x: -10, width: 200, height: 40, text: 'Hi', visible: true, topColor: [255, 0, 0, 255], fontHeight: 32, textId: 'id' });
  });

  it('saves edited pane fields and keeps the rest', () => {
    const bytes = file();
    const layout = readBflyt(bytes);
    expect([...writeBflyt(layout)]).toEqual([...bytes]);
    Object.assign(layout.root.children[0], { name: 'txt_new', x: 12.5, y: -3, width: 64, rotation: 90, alpha: 128, visible: false });
    const saved = readBflyt(writeBflyt(layout));
    expect(saved.root.children[0]).toMatchObject({ name: 'txt_new', x: 12.5, y: -3, width: 64, height: 40, rotation: 90, alpha: 128, visible: false, text: 'Hi' });
    const text = layout.root.children[0];
    text.text = 'Hello world, a much longer text';
    const grown = readBflyt(writeBflyt(layout));
    expect(grown.root.children[0]).toMatchObject({ text: 'Hello world, a much longer text', textId: 'id', name: 'txt_new', fontHeight: 32 });
    expect(new DataView(writeBflyt(layout).buffer).getUint32(0x0c, true)).toBe(writeBflyt(layout).length);
    grown.root.children[0].text = 'Yo';
    expect(readBflyt(writeBflyt(grown)).root.children[0]).toMatchObject({ text: 'Yo', textId: 'id' });
    layout.root.children[0].name = 'x'.repeat(25);
    expect(() => writeBflyt(layout)).toThrow('name-too-long');
  });

  it('removes a pane with its section', () => {
    const layout = readBflyt(file());
    layout.root.children[0].removed = true;
    const out = writeBflyt(layout);
    const saved = readBflyt(out);
    expect(saved.panes.map((pane: { name: string }) => pane.name)).toEqual(['RootPane']);
    expect(new DataView(out.buffer).getUint16(0x10, true)).toBe(4);
    expect(new DataView(out.buffer).getUint32(0x0c, true)).toBe(out.length);
  });

  it('refuses other files', () => {
    expect(() => readBflyt(new Uint8Array(32))).toThrow('not-bflyt');
  });
});
