import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { bugQuestions } from '../../web/src/bugs/content';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
import { observeCaseSetExecution } from './case-set-observation';
import type { EditorSnapshot } from '../../web/src/storage/editor-history';
import type { LedgerEntry, Progress } from '../../web/src/storage/model';
import { openCurrentAnswer, submitCurrent } from './current-course-helpers';
import { installC6Packets } from './c6-observation';
import { assertCurrentJudge } from './current-practice-observation';

const text = (p: Page) =>
  p
    .locator('.code-editor .cm-line')
    .allTextContents()
    .then((lines) => lines.join('\n'));
const panel = (p: Page) => p.getByTestId('practice-execution');
const code = (p: Page) => p.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const action = (p: Page, name: string) => panel(p).getByRole('button', { name, exact: true });
const history = (p: Page) => p.getByTestId('editor-history');
const dir = `.artifacts/${process.env.TASK_EVIDENCE_TASK ?? '14.3'}/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const saved = p05CourseRelease.registered ? 'saved' : 'unavailable';
async function rows(p: Page) {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const names = ['editHistory', 'progress', 'ledger', 'receipts'];
      const tx = db.transaction(names);
      return Object.fromEntries(
        await Promise.all(
          names.map(
            (name) =>
              new Promise<[string, unknown[]]>((resolve) => {
                const r = tx.objectStore(name).getAll();
                r.onsuccess = () => resolve([name, r.result]);
              }),
          ),
        ),
      ) as {
        editHistory: EditorSnapshot[];
        progress: Progress[];
        ledger: LedgerEntry[];
        receipts: { eventId: string; eventType: string }[];
      };
    } finally {
      db.close();
    }
  });
}
async function open(p: Page, id = bugQuestions[0].exerciseRef.id) {
  await p.goto(`/#/practice/${id}`);
  await expect(panel(p)).toHaveAttribute('data-state', 'ready');
  await expect(code(p)).toBeVisible();
  const q = bugQuestions.find((q) => q.exerciseRef.id === id)!;
  await expect.poll(() => text(p)).toContain(q.brokenBody);
  await expect(p.getByTestId('draft-code-editor')).toHaveAttribute(
    'data-sync',
    q.category === 'syntax' ? 'invalid' : 'synced',
  );
  await expect(history(p)).toHaveAttribute('data-save-state', 'ready');
  return text(p);
}
async function repair(p: Page, broken: string, from: string, to: string) {
  await code(p).fill(broken.replace(from, to));
  await expect(p.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await expect(action(p, '提交')).toBeEnabled();
}
async function submit(p: Page) {
  await action(p, '提交').click();
  await expect(panel(p)).toHaveAttribute('data-state', 'passed');
  await expect(panel(p)).toHaveAttribute('data-save-state', saved);
}
test.beforeEach(async ({ page }) => observeCaseSetExecution(page));

for (const q of bugQuestions)
  test(`real repair and independent durable pass: ${q.exerciseRef.id}`, async ({ page }) => {
    const broken = await open(page, q.exerciseRef.id);
    if (q.category === 'syntax') {
      await expect(panel(page).getByTestId('diagnostic-item')).toHaveAttribute(
        'data-code',
        'E_PARSE_INVALID',
      );
      await expect(action(page, '提交')).toBeDisabled();
    } else {
      await action(page, '提交').click();
      await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
    }
    expect(
      (await rows(page)).progress.filter((r) => r.eventType === 'exercise.passed'),
    ).toHaveLength(0);
    await page.getByRole('button', { name: '查看第 1 层提示', exact: true }).click();
    await expect(page.getByRole('region', { name: '关卡提示与解析' })).toContainText(q.hints[0]);
    await repair(page, broken, q.brokenBody, q.solutionBody);
    await submit(page);
    const first = await rows(page);
    const earned = first.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass');
    expect(earned).toHaveLength(p05CourseRelease.registered ? 1 : 0);
    if (earned.length) expect(earned[0].points).toBe(10);
    expect(first.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(0);
    await submit(page);
    expect((await rows(page)).ledger).toEqual(first.ledger);
    const captures = await page.evaluate(() =>
      window.__verticalObservation.workers
        .filter((w) => w.kind === 'execute' && w.responseOk)
        .map((w) => ({
          request: JSON.parse(new TextDecoder().decode(Uint8Array.from(w.requestBytes!))),
          result: JSON.parse(new TextDecoder().decode(Uint8Array.from(w.responseBytes!))),
          moduleSeen: w.moduleSeen,
        })),
    );
    const passes = captures.filter((c) => c.result.judgeResult?.status === 'met');
    expect(new Set(passes.map((c) => c.request.identity.testCaseKey)).size).toBe(4);
    expect(
      captures.every(
        (c) => c.moduleSeen && c.result.producer === 'rust' && c.request.remainingMs <= 1000,
      ),
    ).toBe(true);
    await mkdir(dir, { recursive: true });
    await writeFile(
      `${dir}/${q.exerciseRef.id}.json`,
      JSON.stringify({ first, captures }, null, 2),
    );
    await page.reload();
    await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
    if (p05CourseRelease.registered) {
      await page.goto('/#/bugs');
      await expect(
        page
          .locator('article')
          .filter({ has: page.getByRole('heading', { name: q.title, exact: true }) }),
      ).toContainText('已保存通过');
      expect((await rows(page)).ledger).toEqual(first.ledger);
    }
  });

test('saved broken and repaired drafts restore exactly after refresh without restoring execution', async ({
  page,
}) => {
  const q = bugQuestions[0],
    broken = await open(page);
  await repair(page, broken, q.brokenBody, q.solutionBody);
  const fixed = await text(page);
  await submit(page);
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  const versions = (await rows(page)).editHistory.filter(
    (r) => r.scope.exerciseRef.id === q.exerciseRef.id,
  );
  const bad = versions.find((r) => r.state === 'invalid' && r.codeText === broken)!,
    good = versions.find((r) => r.state === 'synced' && r.codeText === fixed)!;
  expect(bad).toBeDefined();
  expect(good).toBeDefined();
  await page.reload();
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  await history(page).locator('summary').click();
  for (const [record, text, status] of [
    [good, fixed, 'synced'],
    [bad, broken, 'invalid'],
  ] as const) {
    await history(page)
      .getByRole('combobox', { name: '历史版本', exact: true })
      .selectOption(record.entryId);
    await history(page).getByRole('button', { name: '恢复所选版本', exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator('.code-editor .cm-line')
          .allTextContents()
          .then((lines) => lines.join('\n')),
      )
      .toBe(text);
    await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', status);
    if (status === 'synced') {
      await expect(page.getByTestId('player-controls')).toHaveCount(0);
    } else await expect(page.getByTestId('player-controls')).toHaveCount(0);
  }
  await expect(action(page, '提交')).toBeDisabled();
});

test('catalog and editor remain operable at three widths and reveal the authored explanation explicitly', async ({
  page,
}) => {
  await page.goto('/#/courses');
  await page.getByRole('link', { name: 'Bug 修复闯关', exact: true }).click();
  await expect(page.locator('[data-page-id="PAGE-14-3"] article')).toHaveCount(8);
  await page.getByRole('link', { name: `修复：${bugQuestions[2].title}`, exact: true }).click();
  await expect(code(page)).toBeVisible();
  await page
    .getByRole('region', { name: '关卡提示与解析' })
    .getByText('查看修复解析与一种参考写法', { exact: true })
    .click();
  await expect(page.getByRole('region', { name: '关卡提示与解析' })).toContainText(
    bugQuestions[2].explanation,
  );
  await mkdir(dir, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const show = page.getByRole('tab', { name: '编辑代码', exact: true });
    if (await show.isVisible()) await show.click();
    await page.screenshot({ path: `${dir}/bugs-${width}.png` });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
  }
});

test('missing composite content does not authorize supplementary levels', async ({ page }) => {
  const currentManifest = '**/content/c/primer6-teaching/manifest-2.0.0.json';
  await page.route(currentManifest, (route) => route.abort());
  await page.goto('/#/bugs');
  await expect(page.getByRole('link', { name: /^修复：/ })).toHaveCount(0);
  await expect(page.locator('[data-page-id="PAGE-14-3"]')).toContainText(
    '旧版课程不会授权这些新关卡',
  );
  expect(
    (await page.evaluate(() => indexedDB.databases())).some((d) => d.name === 'c-viz-learning'),
  ).toBe(false);
  await page.unroute(currentManifest);
  await page.goto('/#/courses');
  await page.getByRole('button', { name: '重试读取', exact: true }).click();
  await expect(page.locator('.c6-node-list > li')).toHaveCount(19);
  await page.getByRole('link', { name: 'Bug 修复闯关', exact: true }).click();
  await expect(page.getByRole('link', { name: /^修复：/ })).toHaveCount(8);
});

if (p05CourseRelease.registered) {
  test('quota failure preserves one real event and explicit retry awards once', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const fault = { armed: false, eventId: '', hits: 0 };
      Object.assign(window, { __bugFault: fault });
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
        const row = value as { eventType?: string; eventId?: string };
        if (fault.armed && this.name === 'receipts' && row.eventType === 'exercise.passed') {
          fault.hits++;
          fault.eventId = row.eventId!;
          throw new DOMException('14.3 test quota', 'QuotaExceededError');
        }
        return key === undefined ? add.call(this, value) : add.call(this, value, key);
      };
    });
    const q = bugQuestions[1],
      broken = await open(page, q.exerciseRef.id);
    await repair(page, broken, q.brokenBody, q.solutionBody);
    await page.evaluate(() => {
      (window as unknown as { __bugFault: { armed: boolean } }).__bugFault.armed = true;
    });
    await action(page, '提交').click();
    await expect(panel(page)).toHaveAttribute('data-state', 'passed');
    await expect(panel(page)).toHaveAttribute('data-save-state', 'unsaved');
    expect((await rows(page)).ledger).toHaveLength(0);
    const fault = await page.evaluate(() => {
      const f = (
        window as unknown as { __bugFault: { armed: boolean; eventId: string; hits: number } }
      ).__bugFault;
      f.armed = false;
      return { ...f };
    });
    expect(fault.hits).toBeGreaterThan(0);
    await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute(
      'data-learning-storage-status',
      'ready',
    );
    await expect(page.getByTestId('learning-save-status')).toHaveCount(0);
    const savedRows = await rows(page);
    expect(savedRows.receipts.some((r) => r.eventId === fault.eventId)).toBe(true);
    expect(savedRows.ledger).toHaveLength(1);
    await submit(page);
    expect((await rows(page)).ledger).toEqual(savedRows.ledger);
    await mkdir(dir, { recursive: true });
    await writeFile(
      `${dir}/quota-retry.json`,
      JSON.stringify({ fault, savedRows, after: await rows(page) }, null, 2),
    );
  });
  test('an existing original-course pass stays independent of the new Bug entitlement', async ({
    page,
  }) => {
    test.info().annotations.push({
      type: 'current-course-carrier',
      description:
        'Retired ordinary echo is explicitly replaced by actual current 2.1 four-case pass; retained Bug entitlement remains separate.',
    });
    await page.addInitScript(installC6Packets);
    const subject = await openCurrentAnswer(page, 'exercise.c6.s2.1');
    await submitCurrent(page);
    await assertCurrentJudge(page, subject, 'passed');
    const old = await rows(page);
    expect(old.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass')).toHaveLength(1);
    const q = bugQuestions[0],
      broken = await open(page);
    await repair(page, broken, q.brokenBody, q.solutionBody);
    await submit(page);
    const both = await rows(page);
    expect(both.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass')).toHaveLength(2);
    expect(
      both.ledger.filter((r) =>
        old.ledger.some((o) => o.sourceId === r.sourceId && o.subjectId === r.subjectId),
      ),
    ).toEqual(old.ledger);
    await page.reload();
    await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
    expect((await rows(page)).ledger).toEqual(both.ledger);
  });
}
