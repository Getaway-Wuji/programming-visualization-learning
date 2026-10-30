import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { expect, type Page } from '@playwright/test';
import {
  archive,
  ready,
  openAnswer,
  submit,
  confirm,
  code,
  panel,
  observeCaseSetExecution,
} from './notebook-helpers';
import { observedCaseSetExecute } from './case-set-observation';
import type { ReviewCard } from '../../web/src/review-scheduler/model';
import type { KnowledgeMark } from '../../web/src/storage/knowledge-marks';
export { ready, openAnswer, submit, confirm, code, panel, observeCaseSetExecution };
export const folder = `.artifacts/15.3/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
export const status = (p: Page) => p.getByTestId('review-save-status');
export async function native(p: Page) {
  return (await archive(p)) as Awaited<ReturnType<typeof archive>> & {
    reviewCards: ReviewCard[];
    knowledgeMarks: KnowledgeMark[];
  };
}
export async function reviewReady(p: Page) {
  await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await expect(p.locator('.app-shell')).toHaveAttribute('data-review-storage-status', 'ready');
  await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
}
export async function reviews(p: Page) {
  await p.goto('/#/reviews');
  await expect(p.getByRole('heading', { level: 1, name: '今日复习', exact: true })).toBeVisible();
  await reviewReady(p);
}
export async function mark(p: Page) {
  await p.goto('/#/lessons/lesson.c.variables-output');
  await ready(p);
  await expect(p.getByTestId('knowledge-marks-status')).toHaveAttribute('data-state', 'ready');
  await reviewReady(p);
  await p.locator('[data-knowledge-mark="knowledge.c.variables"]').click();
  await expect(p.locator('[data-knowledge-mark="knowledge.c.variables"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await reviews(p);
  await expect.poll(async () => (await native(p)).reviewCards.length).toBe(1);
}
export async function changePrint(p: Page, expression: string) {
  const source = await code(p).inputValue();
  await code(p).fill(source.replace(/printf\([^;]+;/, `printf("%d\\n", ${expression});`));
  await expect(p.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
}
export async function fail(p: Page) {
  await panel(p).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(p)).toHaveAttribute('data-state', 'unmet');
  await expect(p.getByTestId('practice-attempt-save')).toHaveAttribute('data-save-state', 'saved');
  await reviewReady(p);
}
export async function capture(p: Page, name: string) {
  const actual = await observedCaseSetExecute(p);
  expect(actual.moduleSeen).toBe(true);
  expect(actual.responseOk).toBe(true);
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/${name}.json.gz`, gzipSync(JSON.stringify(actual)), { flag: 'wx' });
}
export function sameLearning(
  before: Awaited<ReturnType<typeof native>>,
  after: Awaited<ReturnType<typeof native>>,
) {
  for (const key of [
    'progress',
    'receipts',
    'dailyFacts',
    'ledger',
    'goals',
    'aliases',
    'settings',
    'avatar',
    'appearance',
    'appearanceAssets',
  ] as const)
    expect(after[key]).toEqual(before[key]);
}
export async function quota(p: Page) {
  await p.addInitScript(() => {
    const c = { armed: false, ids: [] as string[] };
    Object.assign(window, { __reviewQuota: c });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        this.name === 'reviewCards' &&
        (value as { lastCommand?: { mode: string; commandId: string } }).lastCommand?.mode ===
          'rate'
      ) {
        c.ids.push((value as { lastCommand: { commandId: string } }).lastCommand.commandId);
        if (c.armed) {
          c.armed = false;
          throw new DOMException('15.3 native review quota', 'QuotaExceededError');
        }
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
}
export async function arm(p: Page) {
  await p.evaluate(() => {
    (window as unknown as { __reviewQuota: { armed: boolean } }).__reviewQuota.armed = true;
  });
}
export async function clear(p: Page) {
  await p.goto('/#/settings?panel=data');
  // Full clear is also valid for an unsaved/partially unavailable archive.
  await expect(p.getByRole('button', { name: '清除本地数据', exact: true })).toBeEnabled();
  await p.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await p
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
}
