import { indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type LanguageSupport, type StreamParser } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';

const stream = (parser: StreamParser<unknown>) => StreamLanguage.define(parser);

const LANGUAGES: [RegExp, string, () => LanguageSupport | StreamLanguage<unknown>][] = [
  [/\.jsonc?$/i, 'JSON', () => json()],
  [/\.(xml|prcxml|msbtxml|html)$/i, 'XML', () => xml()],
  [/\.toml$/i, 'TOML', () => stream(toml)],
  [/\.ya?ml$/i, 'YAML', () => stream(yaml)],
  [/\.lua$/i, 'Lua', () => stream(lua)],
];

const color = (name: string) => `var(--tessera-code-${name})`;

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.bool, tags.null, tags.atom, tags.tagName], color: color('keyword') },
  { tag: [tags.string, tags.special(tags.string)], color: color('string') },
  { tag: [tags.number, tags.integer, tags.float], color: color('number') },
  { tag: [tags.propertyName, tags.attributeName, tags.definition(tags.propertyName)], color: color('property') },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: color('comment'), fontStyle: 'italic' },
  { tag: [tags.heading, tags.typeName, tags.className], color: color('type') },
  { tag: [tags.punctuation, tags.bracket, tags.angleBracket], color: color('punctuation') },
  { tag: tags.invalid, color: color('invalid') },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', color: 'var(--atrium-text-primary)', backgroundColor: color('background') },
  '.cm-scroller': { fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace", lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--atrium-accent-color)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--atrium-accent-color)' },
  '.cm-gutters': { backgroundColor: color('background'), color: 'var(--atrium-text-muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: color('active-line') },
  '.cm-activeLineGutter': { backgroundColor: color('active-line'), color: 'var(--atrium-text-primary)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: color('selection') },
  '.cm-matchingBracket': { backgroundColor: color('selection'), outline: '1px solid var(--atrium-border-color)' },
  '.cm-panels': { backgroundColor: 'var(--atrium-bg-secondary)', color: 'var(--atrium-text-primary)' },
  '.cm-tooltip': { backgroundColor: 'var(--atrium-bg-secondary)', border: '1px solid var(--atrium-border-color)' },
});

export const languageName = (path: string) => LANGUAGES.find(([pattern]) => pattern.test(path))?.[1] ?? 'Text';

export interface CodeEditor {
  element: HTMLElement;
  value: () => string;
  focus: () => void;
  destroy: () => void;
}

export function createCodeEditor(path: string, content: string, handlers: { change: () => void; cursor: (line: number, col: number) => void; save: () => void }): CodeEditor {
  const element = document.createElement('div');
  element.className = 'tessera-code-editor';
  const language = LANGUAGES.find(([pattern]) => pattern.test(path))?.[2]();
  const extensions: Extension[] = [
    basicSetup,
    keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => (handlers.save(), true) }]),
    theme,
    syntaxHighlighting(highlight),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.change();
      if (update.docChanged || update.selectionSet) {
        const head = update.state.selection.main.head;
        const line = update.state.doc.lineAt(head);
        handlers.cursor(line.number, head - line.from + 1);
      }
    }),
  ];
  if (language) extensions.push(language);
  const view = new EditorView({ doc: content, extensions, parent: element });
  return { element, value: () => view.state.doc.toString(), focus: () => view.focus(), destroy: () => view.destroy() };
}
