import { expect, test } from '@playwright/test';
import { openIndependentEchoRepair } from './current-course-helpers';
import { editorValue, expectEditorValue } from './editor-value';

test('native composition edits multiline code once and oversized input preserves the accepted draft', async ({
  page,
  context,
  browser,
}, info) => {
  await openIndependentEchoRepair(page);
  const code = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
  const draft = page.getByTestId('draft-code-editor');
  const original = await editorValue(code);
  const revision = Number(await draft.getAttribute('data-document-revision'));
  expect(Number.isSafeInteger(revision)).toBe(true);
  await code.evaluate((element) => {
    const events: { type: string; trusted: boolean }[] = [];
    (window as unknown as { codeCompositionEvents: typeof events }).codeCompositionEvents = events;
    for (const type of ['compositionstart', 'compositionend'])
      element.addEventListener(type, (event) =>
        events.push({ type: event.type, trusted: event.isTrusted }),
      );
  });
  const cdp =
    browser.browserType().name() === 'chromium' ? await context.newCDPSession(page) : null;
  const compose = async (text: string) => {
    await code.focus();
    await code.press('Control+End');
    if (cdp) {
      await cdp.send('Input.imeSetComposition', {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
      await cdp.send('Input.insertText', { text });
    } else {
      // Firefox's native text insertion uses its real composition lifecycle.
      await page.keyboard.insertText(text);
    }
  };
  const accepted = `${original}/* composed */`;
  await compose('/* composed */');
  await expectEditorValue(code, accepted);
  await expect(draft).toHaveAttribute('data-sync', 'synced');
  await expect(draft).toHaveAttribute('data-document-revision', String(revision + 1));
  // Fill a valid boundary-sized program, then use a normal one-character IME
  // edit to cross the limit. IME candidate strings are words, not pasted files.
  const bounded = `${accepted}/*${'p'.repeat(32768 - new TextEncoder().encode(accepted).length - 4)}*/`;
  expect(new TextEncoder().encode(bounded)).toHaveLength(32768);
  await code.fill(bounded);
  await expectEditorValue(code, bounded);
  await expect(draft).toHaveAttribute('data-sync', 'synced');
  await expect(draft).toHaveAttribute('data-document-revision', String(revision + 2));
  await compose('x');
  await expect(draft.getByRole('alert')).toContainText('32 KiB');
  await expectEditorValue(code, bounded);
  await expect(draft).toHaveAttribute('data-document-revision', String(revision + 2));
  await expect(draft).toHaveAttribute('data-sync', 'synced');
  const events = await page.evaluate(
    () =>
      (window as unknown as { codeCompositionEvents: { type: string; trusted: boolean }[] })
        .codeCompositionEvents,
  );
  const starts = events.filter((event) => event.type === 'compositionstart');
  expect(starts.length).toBeGreaterThanOrEqual(2);
  expect(events.filter((event) => event.type === 'compositionend')).toHaveLength(starts.length);
  await info.attach('actual-browser-composition-events', {
    body: JSON.stringify({ browser: info.project.name, version: browser.version(), events }),
    contentType: 'application/json',
  });
  expect(
    starts.every((event) => event.trusted),
    JSON.stringify(events),
  ).toBe(true);
  await cdp?.detach();
});
