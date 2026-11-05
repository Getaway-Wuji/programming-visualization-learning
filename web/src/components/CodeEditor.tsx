import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from '@codemirror/view';
import { cpp } from '@codemirror/lang-cpp';
import {
  defaultHighlightStyle,
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  insertNewlineAndIndent,
  isolateHistory,
} from '@codemirror/commands';
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionKeymap,
} from '@codemirror/autocomplete';
import { codeCompletions, type CodeDialect } from './code-completions';
import './code-editor.css';
import editorStyles from './code-editor.css?url';

const codeColors = HighlightStyle.define(
  defaultHighlightStyle.specs.map((style) => ({
    ...style,
    ...(style.color
      ? {
          color:
            'light-dark(' +
            style.color +
            ', ' +
            (['#708', '#219', '#00f'].includes(style.color)
              ? 'var(--p05-accent)'
              : 'var(--p05-text)') +
            ')',
        }
      : {}),
  })),
);

export interface CodeEditorHandle {
  select(start: number, end: number, scroll?: boolean): void;
  focus(): void;
}
export function CodeEditor({
  value,
  onChange,
  onSelect,
  label,
  dialect = 'c6',
  ref,
}: {
  value: string;
  onChange(text: string, changedRange?: { start: number; end: number }): void;
  onSelect?(range: { start: number; end: number }): void;
  label: string;
  dialect?: CodeDialect;
  ref?: Ref<CodeEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSelect });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onSelect };
  });
  const initial = useRef(value);
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editor.current?.focus();
      },
      select(start, end, scroll = true) {
        const view = editor.current;
        if (!view) return;
        view.dispatch({
          selection: {
            anchor: Math.min(start, view.state.doc.length),
            head: Math.min(end, view.state.doc.length),
          },
          scrollIntoView: scroll,
        });
        view.focus();
      },
    }),
    [],
  );
  useLayoutEffect(() => {
    if (!host.current) return;
    let external = false;
    // Constructed stylesheets in an open shadow root keep CodeMirror's own
    // layout under the existing strict CSP, without permitting inline styles.
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    const styles = document.createElement('link');
    styles.rel = 'stylesheet';
    styles.href = editorStyles;
    root.append(styles);
    const indent = (command: typeof indentMore) => (view: EditorView) =>
      command({
        state: view.state,
        dispatch: (transaction) =>
          view.dispatch(
            transaction.startState.update({
              changes: transaction.changes,
              selection: transaction.selection,
              effects: transaction.effects,
              scrollIntoView: true,
              annotations: isolateHistory.of('full'),
            }),
          ),
      });
    const view = new EditorView({
      parent: root,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          cpp(),
          lineNumbers(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentUnit.of('    '),
          syntaxHighlighting(codeColors),
          EditorView.contentAttributes.of({
            'aria-label': label,
            'aria-multiline': 'true',
            spellcheck: 'false',
            autocapitalize: 'off',
            autocorrect: 'off',
          }),
          EditorView.theme({
            '&': {
              height: 'var(--code-editor-height, 360px)',
              fontSize: '14px',
              lineHeight: '1.7',
            },
            '.cm-scroller': { overflow: 'auto' },
            '.cm-gutters': {
              backgroundColor: 'var(--p05-surface)',
              color: 'var(--p05-muted)',
              borderRightColor: 'var(--p05-border)',
            },
            '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--p05-active)' },
            '.cm-tooltip': {
              backgroundColor: 'var(--p05-surface)',
              color: 'var(--p05-text)',
              borderColor: 'var(--p05-border)',
            },
            '.cm-tooltip-autocomplete ul li[aria-selected=true]': {
              backgroundColor: 'var(--p05-accent)',
              color: 'var(--p05-accent-on)',
            },
            '.cm-cursor': { borderLeftColor: 'var(--p05-accent)' },
            '&.cm-focused': { outline: '2px solid var(--p05-accent)' },
          }),
          autocompletion({
            override: [codeCompletions(dialect)],
            defaultKeymap: false,
            activateOnTyping: true,
            interactionDelay: 0,
          }),
          Prec.highest(
            keymap.of([
              {
                key: 'Tab',
                run: (v) => acceptCompletion(v) || indent(indentMore)(v),
                shift: indent(indentLess),
              },
              { key: 'Enter', run: (v) => acceptCompletion(v) || insertNewlineAndIndent(v) },
              { key: 'Escape', run: closeCompletion },
              ...completionKeymap,
              ...historyKeymap,
              ...defaultKeymap,
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (external) return;
            if (update.docChanged) {
              let start = update.startState.doc.length,
                end = 0;
              update.changes.iterChangedRanges((a, b) => {
                start = Math.min(start, a);
                end = Math.max(end, b);
              });
              const before = update.startState.doc.toString();
              callbacks.current.onChange(update.state.doc.toString(), {
                start: new TextEncoder().encode(before.slice(0, start)).length,
                end: new TextEncoder().encode(before.slice(0, end)).length,
              });
            }
            if (update.selectionSet && callbacks.current.onSelect) {
              const { from, to } = update.state.selection.main,
                text = update.state.doc.toString();
              callbacks.current.onSelect({
                start: new TextEncoder().encode(text.slice(0, from)).length,
                end: new TextEncoder().encode(text.slice(0, to)).length,
              });
            }
          }),
        ],
      }),
    });
    editor.current = view;
    // Programmatic replacements use one editor transaction and remain undoable.
    const synchronize = (event: Event) => {
      const text = (event as CustomEvent<string>).detail;
      if (view.state.doc.toString() === text) return;
      external = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      external = false;
    };
    const element = host.current;
    element.addEventListener('code-replace', synchronize);
    return () => {
      element.removeEventListener('code-replace', synchronize);
      view.destroy();
      styles.remove();
      editor.current = null;
    };
  }, [label, dialect]);
  useLayoutEffect(() => {
    host.current?.dispatchEvent(new CustomEvent('code-replace', { detail: value }));
  }, [value]);
  return <div className="code-editor" ref={host} data-testid="code-editor" />;
}
