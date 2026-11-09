import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import { ChangeSet, EditorState, Prec, Transaction } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from '@codemirror/view';
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
import { codeLanguage } from './code-languages';
import './code-editor.css';
import editorStyles from './code-editor.css?url';

const colorPairs: Record<string, [string, string]> = {
  '#708': ['#7a2794', '#ddb3f4'],
  '#219': ['#7042a5', '#ccb5f6'],
  '#164': ['#126b40', '#8fd6a8'],
  '#a11': ['#a12634', '#ffb5ae'],
  '#e40': ['#98420c', '#ffc08b'],
  '#00f': ['#175bb4', '#a9caff'],
  '#30a': ['#5940a2', '#c4baff'],
  '#085': ['#0b6b66', '#83d5cf'],
  '#167': ['#17667d', '#92d4e9'],
  '#256': ['#245c72', '#a4d8e9'],
  '#00c': ['#2457ad', '#a9caff'],
  '#940': ['#735d43', '#c5b79f'],
  '#f00': ['#b52230', '#ffb0b9'],
};
const codeColors = HighlightStyle.define(
  defaultHighlightStyle.specs.map((style) => ({
    ...style,
    ...(style.color
      ? {
          color: `light-dark(${(colorPairs[style.color] ?? [style.color, '#d7e2ed']).join(', ')})`,
        }
      : {}),
  })),
);

export interface CodeEditorHandle {
  select(start: number, end: number, scroll?: boolean): void;
  focus(): void;
  text(): string;
}
export function CodeEditor({
  value,
  onChange,
  onSelect,
  label,
  dialect = 'c6',
  readOnly = false,
  identifiers = [],
  ref,
}: {
  value: string;
  onChange(text: string, changedRange?: { start: number; end: number }): void;
  onSelect?(range: { start: number; end: number }): void;
  label: string;
  dialect?: CodeDialect;
  readOnly?: boolean;
  identifiers?: readonly string[];
  ref?: Ref<CodeEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSelect, value, identifiers });
  useLayoutEffect(() => {
    callbacks.current = { onChange, onSelect, value, identifiers };
  });
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editor.current?.focus();
      },
      text() {
        return editor.current?.state.doc.toString() ?? callbacks.current.value;
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
    let alive = true;
    let composition: {
      before: string;
      changes: ChangeSet;
      active: boolean;
      cancelled: boolean;
      historyStarted: boolean;
    } | null = null;
    const compositionMeasureKey = {};
    const changed = (before: string, text: string, changes: ChangeSet) => {
      if (before === text) return;
      let start = before.length,
        end = 0;
      changes.iterChangedRanges((a, b) => {
        start = Math.min(start, a);
        end = Math.max(end, b);
      });
      callbacks.current.onChange(text, {
        start: new TextEncoder().encode(before.slice(0, start)).length,
        end: new TextEncoder().encode(before.slice(0, end)).length,
      });
    };
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
        doc: callbacks.current.value,
        extensions: [
          codeLanguage(dialect),
          EditorState.readOnly.of(readOnly),
          // Firefox may label the first DOM edit as a continuing composition,
          // which otherwise absorbs an earlier independent undo operation.
          EditorState.transactionFilter.of((transaction) => {
            if (
              !external &&
              composition &&
              !composition.cancelled &&
              !composition.historyStarted &&
              transaction.docChanged &&
              (transaction.isUserEvent('input') || transaction.isUserEvent('delete'))
            )
              return [
                {
                  annotations: [
                    Transaction.userEvent.of('input.type.compose.start'),
                    isolateHistory.of('before'),
                  ],
                },
                transaction,
              ];
            return transaction;
          }),
          EditorView.domEventHandlers({
            beforeinput(event, view) {
              if (
                !event.cancelable ||
                event.defaultPrevented ||
                event.inputType !== 'insertText' ||
                event.data === null ||
                event.isComposing ||
                view.composing ||
                view.compositionStarted ||
                view.state.readOnly
              )
                return false;
              const selectionRoot = view.root as (Document | ShadowRoot) & {
                getSelection?(): Selection | null;
              };
              const nativeSelection =
                selectionRoot.getSelection?.() ?? view.dom.ownerDocument.getSelection();
              if (
                !nativeSelection?.anchorNode ||
                !nativeSelection.focusNode ||
                !view.contentDOM.contains(nativeSelection.anchorNode) ||
                !view.contentDOM.contains(nativeSelection.focusNode)
              )
                return false;
              const anchor = view.posAtDOM(
                nativeSelection.anchorNode,
                nativeSelection.anchorOffset,
              );
              const head = view.posAtDOM(nativeSelection.focusNode, nativeSelection.focusOffset);
              // Browser select-all/replacement can precede selectionchange.
              // Read its real selection before inserting, including in shadow DOM.
              if (
                anchor !== view.state.selection.main.anchor ||
                head !== view.state.selection.main.head
              )
                view.dispatch({ selection: { anchor, head }, userEvent: 'select' });
              // Native contenteditable replacement may briefly synthesize an
              // inline color style from the highlighted text. A normal editor
              // transaction inserts plain text under the unchanged strict CSP.
              // Native IME composition retains its separate atomic path below.
              event.preventDefault();
              view.dispatch({
                ...view.state.replaceSelection(event.data),
                scrollIntoView: true,
                userEvent: 'input.type',
              });
              return true;
            },
          }),
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
            'aria-description': readOnly
              ? '只读示例。可用方向键阅读，Tab 移到下一项。'
              : 'Tab 补全或缩进；先按 Esc，再按 Tab 可离开编辑区；Ctrl 加空格显示提示。',
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
            override: [codeCompletions(dialect, () => callbacks.current.identifiers)],
            defaultKeymap: false,
            activateOnTyping: !readOnly,
            interactionDelay: 0,
          }),
          Prec.highest(
            keymap.of([
              {
                key: 'Tab',
                run: (v) => !readOnly && (acceptCompletion(v) || indent(indentMore)(v)),
                shift: (v) => !readOnly && indent(indentLess)(v),
              },
              { key: 'Enter', run: (v) => acceptCompletion(v) || insertNewlineAndIndent(v) },
              {
                key: 'Escape',
                run: (v) => {
                  closeCompletion(v);
                  v.setTabFocusMode(10000);
                  return true;
                },
              },
              ...completionKeymap,
              ...historyKeymap,
              ...defaultKeymap,
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (external) return;
            if (update.docChanged) {
              if (composition) {
                composition.historyStarted = true;
                if (!composition.cancelled)
                  composition.changes = composition.changes.compose(update.changes);
              } else
                changed(
                  update.startState.doc.toString(),
                  update.state.doc.toString(),
                  update.changes,
                );
            }
            if (!composition && update.selectionSet && callbacks.current.onSelect) {
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
    // Firefox removes a multiline selection when composition starts, before
    // inserting its text. Publish the completed edit once, so a rejected input
    // cannot replace the accepted draft with that temporary empty document.
    const beginComposition = () => {
      if (composition && !composition.active) composition.historyStarted = false;
      composition ??= {
        before: view.state.doc.toString(),
        changes: ChangeSet.empty(view.state.doc.length),
        active: true,
        cancelled: false,
        historyStarted: false,
      };
      composition.active = true;
    };
    const endComposition = () => {
      if (!composition) return;
      composition.active = false;
      // Measurement flushes pending native DOM changes first. Publish outside
      // the measurement phase, after CodeMirror has read the final IME text.
      view.requestMeasure({
        key: compositionMeasureKey,
        read: () => null,
        write: () => {
          queueMicrotask(() => {
            if (!alive || !composition || composition.active) return;
            const completed = composition;
            composition = null;
            if (completed.cancelled) {
              synchronizeText(callbacks.current.value);
              return;
            }
            const text = view.state.doc.toString();
            changed(completed.before, text, completed.changes);
            const { from, to } = view.state.selection.main;
            callbacks.current.onSelect?.({
              start: new TextEncoder().encode(text.slice(0, from)).length,
              end: new TextEncoder().encode(text.slice(0, to)).length,
            });
          });
        },
      });
    };
    view.contentDOM.addEventListener('compositionstart', beginComposition, true);
    view.contentDOM.addEventListener('compositionend', endComposition);
    // Programmatic replacements use one editor transaction and remain undoable.
    const synchronizeText = (text: string) => {
      if (composition) {
        if (!composition.cancelled && text === composition.before) return;
        composition.cancelled = true;
      }
      if (view.state.doc.toString() === text) return;
      external = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      external = false;
    };
    const synchronize = (event: Event) => synchronizeText((event as CustomEvent<string>).detail);
    const element = host.current;
    element.addEventListener('code-replace', synchronize);
    return () => {
      alive = false;
      composition = null;
      view.contentDOM.removeEventListener('compositionstart', beginComposition, true);
      view.contentDOM.removeEventListener('compositionend', endComposition);
      element.removeEventListener('code-replace', synchronize);
      view.destroy();
      styles.remove();
      editor.current = null;
    };
  }, [label, dialect, readOnly]);
  useLayoutEffect(() => {
    host.current?.dispatchEvent(new CustomEvent('code-replace', { detail: value }));
  });
  return (
    <>
      <div className="code-editor" ref={host} data-testid="code-editor" data-dialect={dialect} />
      <p className="code-editor-help">
        {readOnly ? '只读示例' : 'Tab 补全或缩进 · Esc 后按 Tab 离开编辑区 · Ctrl + 空格查看提示'}
      </p>
    </>
  );
}
