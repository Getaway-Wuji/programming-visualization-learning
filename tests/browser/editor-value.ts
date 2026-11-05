import { expect, type Locator } from '@playwright/test';

/** Read or select the real editor selection; never replace application data. */
export async function editorSelection(editor: Locator, range?: { start: number; end: number }) {
  return editor.evaluate((element, range) => {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      if (range) {
        element.focus();
        element.setSelectionRange(range.start, range.end);
        element.dispatchEvent(new Event('select', { bubbles: true }));
      }
      return { start: element.selectionStart!, end: element.selectionEnd! };
    }
    const view = (
      element as HTMLElement & {
        cmTile?: {
          root?: {
            view?: {
              state: { selection: { main: { from: number; to: number } } };
            } & {
              dispatch(transaction: {
                selection: { anchor: number; head: number };
                scrollIntoView: boolean;
              }): void;
              focus(): void;
            };
          };
        };
      }
    ).cmTile?.root?.view;
    if (!view) throw Error('Actual CodeMirror selection required');
    if (range) {
      view.dispatch({ selection: { anchor: range.start, head: range.end }, scrollIntoView: true });
      view.focus();
    }
    return { start: view.state.selection.main.from, end: view.state.selection.main.to };
  }, range);
}

/** Read actual UI text, preserving CodeMirror line breaks and native values. */
export function editorValue(editor: Locator, options?: { timeout?: number }) {
  return editor.evaluate(
    (element) => {
      if ('value' in element) return String(element.value);
      if (element instanceof HTMLElement && element.isContentEditable) {
        // Mirrors EditorView.findFromDOM for the pinned CodeMirror version.
        // Reading the live document also includes lines outside its viewport.
        const tile = (
          element as HTMLElement & {
            cmTile?: { root?: { view?: { state: { doc: { toString(): string } } } } };
          }
        ).cmTile;
        const text = tile?.root?.view?.state.doc.toString();
        if (typeof text === 'string') return text;
      }
      throw new Error('Expected an actual native input or editable CodeMirror surface');
    },
    undefined,
    options,
  );
}

export async function expectEditorValue(
  editor: Locator,
  value: string | RegExp,
  options: { not?: boolean; timeout?: number } = {},
) {
  const poll = expect.poll(() => editorValue(editor), { timeout: options.timeout });
  const check = options.not ? poll.not : poll;
  if (typeof value === 'string') await check.toBe(value);
  else await check.toMatch(value);
}
