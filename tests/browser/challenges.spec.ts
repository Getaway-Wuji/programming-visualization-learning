import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { native, clear } from './achievement-helpers';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import type { ExecuteResult } from '../../web/src/engine/protocol';
const { questions } = JSON.parse(readFileSync('content/challenges/cases-1.0.0.json', 'utf8')) as {
  questions: { ref: { id: string }; caseId: string; anchorKind: string; choices: string[] }[];
};
const folder = `.artifacts/16.1/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const teach = (p: Page) => p.getByTestId('step-teaching');
const checkpoints = (p: Page) =>
  p.getByRole('group', { name: '本次挑战题目', exact: true }).getByRole('button');
const feedback = (p: Page) => p.getByTestId('challenge-feedback');
test.use({ timezoneId: 'Asia/Shanghai' });
test.beforeAll(() => mkdir(folder, { recursive: true }));
async function ready(p: Page) {
  await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}
async function run(p: Page, id = 'case.c.assignment') {
  await p.bringToFront();
  await p.goto(`/#/visualize/${id}`);
  // A same-hash visit can reuse the existing completed workspace. Reload gives
  // this helper a fresh run context while preserving the real local archive.
  await p.reload();
  await expect(p.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await p.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(p.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  await p.getByRole('button', { name: '预测挑战', exact: true }).click();
  await expect(checkpoints(p)).toHaveCount(3);
}
async function question(p: Page, index = 0) {
  await checkpoints(p).nth(index).click();
  return p.getByTestId('challenge-question').getAttribute('data-question-id');
}
async function answer(p: Page, correct = true, index = 0) {
  const id = await question(p, index),
    q = questions.find((q) => q.ref.id === id)!;
  await p
    .locator(
      `[data-answer-kind="${correct ? q.anchorKind : q.choices.find((k) => k !== q.anchorKind)}"]`,
    )
    .click();
  await expect(feedback(p)).toHaveAttribute(
    'data-answer-result',
    correct ? 'correct' : 'incorrect',
  );
  await expect(feedback(p)).toContainText('本次答案已保存');
  await ready(p);
}
async function capture(p: Page, name: string) {
  const worker = await observedCaseSetExecute(p);
  expect(worker.moduleSeen && worker.responseOk).toBe(true);
  const result = JSON.parse(Buffer.from(worker.responseBytes!).toString()) as ExecuteResult;
  expect(result.producer).toBe('rust');
  expect(result.terminal.status).toBe('completed');
  await writeFile(
    `${folder}/${name}.json.gz`,
    gzipSync(JSON.stringify({ worker, rows: await native(p) })),
    { flag: 'wx' },
  );
  return result;
}
async function quota(p: Page) {
  await p.addInitScript(() => {
    const c = { armed: false, attempts: [] as string[] };
    Object.assign(window, { __challengeQuota: c });
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (
        this.name === 'receipts' &&
        (value as { eventType?: string }).eventType === 'challenge.answered'
      ) {
        c.attempts.push(JSON.stringify(value));
        if (c.armed) throw new DOMException('16.1 native quota', 'QuotaExceededError');
      }
      return key === undefined ? add.call(this, value) : add.call(this, value, key);
    };
  });
}
async function arm(p: Page, on: boolean) {
  await p.evaluate((on) => {
    (window as unknown as { __challengeQuota: { armed: boolean } }).__challengeQuota.armed = on;
  }, on);
}
test('16.1 common seven real C traces expose21 exact checkpoints and corresponding step explanations', async ({
  page,
}) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  for (const id of [...new Set(questions.map((q) => q.caseId))]) {
    await run(page, id);
    const result = await capture(page, id);
    for (let i = 0; i < 3; i++) {
      const qid = await question(page, i),
        q = questions.find((q) => q.ref.id === qid)!;
      const cursor = Number(
        await page.getByTestId('challenge-question').getAttribute('data-cursor'),
      );
      expect(result.trace!.steps[cursor].kind).toBe(q.anchorKind);
      expect(cursor).toBe(result.trace!.steps.findIndex((s) => s.kind === q.anchorKind));
    }
    await page.getByRole('button', { name: '教学讲解', exact: true }).click();
    await expect(teach(page)).toHaveAttribute('data-mode', 'teaching');
    await expect(page.getByTestId('step-explanation')).toContainText('下一步');
    expect((await native(page)).ledger).toEqual([]);
  }
});
test('16.1 common three widths keep the actual graph, mode switch and question choices usable', async ({
  page,
}) => {
  await run(page);
  await question(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await teach(page).scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await expect(page.getByRole('group', { name: '下一步选项', exact: true })).toBeVisible();
    await page.screenshot({ path: `${folder}/challenge-${width}.png`, fullPage: true });
  }
});
test('16.1 formal correct and incorrect answers save signed ledger entries without completion or daily facts', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await run(page);
  await ready(page);
  const before = await native(page);
  await answer(page, false);
  await answer(page, true, 1);
  const after = await native(page);
  expect(after.ledger.map((e) => e.points).sort()).toEqual([-1, 2]);
  expect(after.receipts.filter((r) => r.eventType === 'challenge.answered')).toHaveLength(2);
  for (const name of [
    'progress',
    'dailyFacts',
    'achievements',
    'reviewCards',
    'knowledgeMarks',
    'settings',
    'avatar',
  ] as const)
    expect(after[name]).toEqual(before[name]);
  expect(after.goals.every((g) => g.achievedAt === null)).toBe(true);
  await capture(page, 'signed-answers');
  await page.goto('/#/?panel=points');
  await ready(page);
  await expect(page.getByRole('dialog')).toContainText('挑战首次作答');
  await expect(page.getByRole('dialog')).toContainText('-1 分');
});
test('16.1 formal replay, modes, input changes, reload and a new day cannot re-score a stable question', async ({
  page,
}) => {
  await run(page);
  await ready(page);
  await answer(page, false);
  const before = await native(page);
  await page.getByRole('button', { name: '教学讲解', exact: true }).click();
  await page.getByRole('button', { name: '重播', exact: true }).click();
  await page.getByRole('button', { name: '预测挑战', exact: true }).click();
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await page.getByRole('button', { name: '后退', exact: true }).click();
  expect((await native(page)).ledger).toEqual(before.ledger);
  await page.getByTestId('input-field-x').fill('7');
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'unprepared');
  await expect(page.getByTestId('challenge-question')).toHaveCount(0);
  await page.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'completed');
  await page.getByRole('button', { name: '预测挑战', exact: true }).click();
  await answer(page, true);
  await expect(feedback(page)).toContainText('本次不再加扣分');
  expect((await native(page)).ledger).toEqual(before.ledger);
  await page.clock.setFixedTime(new Date('2026-11-01T03:00:00.000Z'));
  await run(page);
  await ready(page);
  await answer(page, true);
  const after = await native(page);
  expect(after.ledger).toEqual(before.ledger);
  expect(after.receipts.filter((r) => r.eventType === 'challenge.answered')).toHaveLength(3);
});
test('16.1 formal native quota rolls back answer and score and retries the identical receipt', async ({
  page,
}) => {
  await quota(page);
  await run(page);
  await ready(page);
  await question(page);
  const before = await native(page);
  await arm(page, true);
  const q = questions[0];
  await page.locator(`[data-answer-kind="${q.anchorKind}"]`).click();
  await expect(feedback(page)).toContainText('本次答案未保存');
  const failed = await native(page);
  expect(failed.receipts).toEqual(before.receipts);
  expect(failed.ledger).toEqual(before.ledger);
  await arm(page, false);
  await page.getByRole('button', { name: '重试保存原答案', exact: true }).click();
  await expect(feedback(page)).toContainText('本次答案已保存');
  const attempts = await page.evaluate(
    () =>
      (window as unknown as { __challengeQuota: { attempts: string[] } }).__challengeQuota.attempts,
  );
  expect(attempts.length).toBeGreaterThanOrEqual(2);
  expect(new Set(attempts).size).toBe(1);
  expect((await native(page)).ledger).toHaveLength(1);
});
test('16.1 formal two native pages answering differently share exactly one first-answer ledger row', async ({
  page,
  context,
}) => {
  const peer = await context.newPage();
  await run(page);
  await ready(page);
  await question(page);
  await run(peer);
  await ready(peer);
  await question(peer);
  const q = questions[0];
  await Promise.all([
    page.locator(`[data-answer-kind="${q.anchorKind}"]`).click(),
    peer.locator(`[data-answer-kind="${q.choices.find((k) => k !== q.anchorKind)}"]`).click(),
  ]);
  await expect(feedback(page)).toContainText('本次答案已保存');
  await expect(feedback(peer)).toContainText('本次答案已保存');
  const s = await native(page);
  expect(s.ledger).toHaveLength(1);
  const rs = s.receipts
    .filter((r) => r.eventType === 'challenge.answered')
    .sort((a, b) => a.committedRevision - b.committedRevision);
  expect(rs).toHaveLength(2);
  expect(s.ledger[0].points).toBe(rs[0].result === 'correct' ? 2 : -1);
  await writeFile(`${folder}/concurrent.json`, JSON.stringify(s, null, 2));
});
test('16.1 formal peer clear invalidates a failed answer and its retry without resurrecting the old generation', async ({
  page,
  context,
}) => {
  await quota(page);
  await run(page);
  await ready(page);
  await question(page);
  await arm(page, true);
  await page.locator(`[data-answer-kind="${questions[0].anchorKind}"]`).click();
  await expect(feedback(page)).toContainText('本次答案未保存');
  const gen = (await native(page)).meta.generation;
  const peer = await context.newPage();
  await clear(peer);
  await ready(peer);
  await page.bringToFront();
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', '');
  await expect(page.getByTestId('challenge-question')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试保存原答案', exact: true })).toHaveCount(0);
  const after = await native(page);
  expect(after.meta.generation).not.toBe(gen);
  expect(after.ledger).toEqual([]);
  expect(after.receipts).toEqual([]);
});
test('16.1 formal delayed native commit acknowledgement cannot revive a cleared challenge', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction,
      add = IDBObjectStore.prototype.add;
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')!;
    const targets = new WeakSet<IDBTransaction>(),
      control = { armed: false, held: false, release: null as (() => void) | null };
    Object.assign(window, { __challengeAck: control });
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      const tx = transaction.call(this, names, mode, options);
      if (mode === 'readwrite')
        Object.defineProperty(tx, 'oncomplete', {
          get: () => descriptor.get!.call(tx),
          set: (callback: ((e: Event) => void) | null) =>
            descriptor.set!.call(
              tx,
              callback
                ? function (e: Event) {
                    if (control.armed && targets.has(tx)) {
                      control.armed = false;
                      control.held = true;
                      control.release = () => callback.call(tx, e);
                    } else callback.call(tx, e);
                  }
                : null,
            ),
        });
      return tx;
    };
    IDBObjectStore.prototype.add = function (value, key) {
      if (
        this.name === 'receipts' &&
        (value as { eventType?: string }).eventType === 'challenge.answered' &&
        control.armed
      )
        targets.add(this.transaction);
      return key === undefined ? add.call(this, value) : add.call(this, value, key);
    };
  });
  await run(page);
  await ready(page);
  await question(page);
  const gen = (await native(page)).meta.generation;
  await page.evaluate(() => {
    (window as unknown as { __challengeAck: { armed: boolean } }).__challengeAck.armed = true;
  });
  await page.locator(`[data-answer-kind="${questions[0].anchorKind}"]`).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __challengeAck: { held: boolean } }).__challengeAck.held,
      ),
    )
    .toBe(true);
  const peer = await context.newPage();
  await clear(peer);
  await ready(peer);
  await page.evaluate(() =>
    (window as unknown as { __challengeAck: { release: () => void } }).__challengeAck.release(),
  );
  await page.bringToFront();
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', '');
  await expect(page.getByTestId('challenge-feedback')).toHaveCount(0);
  const after = await native(page);
  expect(after.meta.generation).not.toBe(gen);
  expect(after.ledger).toEqual([]);
  expect(after.receipts).toEqual([]);
});
test('16.1 formal challenge pauses at the next unanswered checkpoint and switching preserves the same view', async ({
  page,
}) => {
  await run(page);
  await ready(page);
  await page.getByRole('combobox', { name: '播放速度', exact: true }).selectOption('4');
  await page.getByRole('button', { name: '重播', exact: true }).click();
  const at = 2;
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', String(at));
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-player-status', 'paused');
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', String(at));
  const trace = await page.getByTestId('trace-view').innerText();
  await page.getByRole('button', { name: '教学讲解', exact: true }).click();
  expect(await page.getByTestId('trace-view').innerText()).toBe(trace);
  await page.getByRole('button', { name: '前进', exact: true }).click();
  await expect(page.getByTestId('player-controls')).toHaveAttribute('data-cursor', '3');
  await expect(page.getByTestId('step-explanation')).toContainText('初值');
  await page.getByRole('button', { name: '后退', exact: true }).click();
  expect(await page.getByTestId('trace-view').innerText()).toBe(trace);
  expect((await native(page)).ledger).toEqual([]);
});
test('16.1 formal saved feedback stays readable at three widths with the actual signed balance', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await run(page);
  await ready(page);
  await answer(page, false);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await teach(page).scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await expect(feedback(page)).toContainText('账本保留 -1 分');
    await teach(page).screenshot({ path: `${folder}/saved-panel-${width}.png` });
    await page.screenshot({ path: `${folder}/saved-screen-${width}.png`, fullPage: true });
  }
  await capture(page, 'saved-negative-layout');
});
