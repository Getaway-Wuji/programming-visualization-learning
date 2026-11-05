import { expect, type Page } from '@playwright/test';
import { C6Player } from '../../web/src/engine/c6-player';
import type { C6Result } from '../../web/src/engine/c6-types';
import { editorValue } from './editor-value';

export const currentProgramPath = '/#/c6/program/teach.c6.ch01.welcome?node=c6.ch01';

/** Exercise the visible discard confirmation when leaving a temporary program. */
export async function discardCurrentDraft(page: Page, url: string) {
  const handler = (dialog: import('@playwright/test').Dialog) => dialog.accept();
  page.on('dialog', handler);
  try {
    await page.goto(url);
    await expect(page).toHaveURL(new URL(url, page.url()).href);
    await expect(currentSource(page)).toBeEditable();
  } finally {
    page.off('dialog', handler);
  }
}

export const currentSource = (page: Page) =>
  page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true });

export const currentSourceText = (page: Page) => editorValue(currentSource(page));

export async function finishCurrentReading(page: Page) {
  const end = page.getByTestId('reading-end');
  await expect(end).toBeAttached();
  await page.keyboard.press('End');
  await expect(end).toHaveAttribute('data-read-today', 'true');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}

export async function expectCurrentSource(page: Page, source: string | RegExp) {
  const actual = expect.poll(() => currentSourceText(page));
  if (typeof source === 'string') await actual.toBe(source);
  else await actual.toMatch(source);
}

/** Wait for the actual native progress row, rather than a removed save banner. */
export async function expectCurrentSaved(page: Page) {
  const id = new URL(page.url()).hash.split('/').at(-1)!;
  const eventType =
    (await page.getByTestId('oj-verdict').textContent()) === '未通过'
      ? 'exercise.attempt-evaluated'
      : 'exercise.passed';
  await expect
    .poll(() =>
      page.evaluate(
        async ({ id, eventType }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('c-viz-learning');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const rows = await new Promise<{ eventType: string; subjectRef: { id: string } }[]>(
              (resolve, reject) => {
                const request = db
                  .transaction('progress', 'readonly')
                  .objectStore('progress')
                  .getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              },
            );
            return rows.some((row) => row.eventType === eventType && row.subjectRef.id === id);
          } finally {
            db.close();
          }
        },
        { id, eventType },
      ),
    )
    .toBe(true);
}

/** Current exercises expose an OJ verdict; full trace facts remain in the real
 * worker packet and are replayed by the same production projector below. */
export async function submitCurrentVerdict(page: Page, passed = true) {
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText(passed ? '通过' : '未通过');
  await expect(page.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}

export function assertCompleteC6Replay(packet: C6Result, stdout: string) {
  const player = new C6Player(packet);
  const initial = structuredClone(player.state);
  expect(packet.trace?.completeness).toBe('complete');
  player.seek(packet.terminal.cursor);
  expect(player.cursor).toBe(packet.trace!.steps.length);
  expect(player.state.output).toBe(stdout);
  player.seek(0);
  expect(player.state).toEqual(initial);
}

export function assertEveryC6State(packet: C6Result, stdout: string) {
  const player = new C6Player(packet);
  const states = [structuredClone(player.state)];
  for (let cursor = 1; cursor <= packet.trace!.steps.length; cursor++) {
    player.seek(cursor);
    states.push(structuredClone(player.state));
  }
  expect(player.state.output).toBe(stdout);
  for (let cursor = packet.trace!.steps.length - 1; cursor >= 0; cursor--) {
    player.seek(cursor);
    expect(player.state).toEqual(states[cursor]);
  }
  return states;
}
