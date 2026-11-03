import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  archive,
  ready,
  submit,
  capture,
  panel,
  code,
  folder,
  observeCaseSetExecution,
} from './notebook-helpers';
import {
  openIndependentRepair as openAnswer,
  confirmCurrentLesson as confirm,
} from './current-course-helpers';
const marksStatus = (page: Page) => page.getByTestId('knowledge-marks-status');
const variableMark = (page: Page) => page.locator('[data-knowledge-mark="knowledge.c6.s2.1"]');
const mistake = (page: Page, id: string) =>
  page.locator('.c6-mistake-list > li').filter({
    has: page.locator(
      `a[href="#/${id.startsWith('exercise.cpp.') ? 'bugs/memory' : 'practice'}/${id}"]`,
    ),
  });
const errorRow = (page: Page) => mistake(page, 'exercise.c.bug-parenthesis');
const unfamiliarRows = (page: Page) => page.locator('.c6-knowledge-list > li');
const emptyMistakes = (page: Page) => page.getByText('暂无已保存的错题。', { exact: true });

test('15.2 formal stale mark retry cannot overwrite a peer command and re-reading enables a fresh explicit action', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const c = { armed: false };
    Object.assign(window, { __staleMark: c });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'knowledgeMarks' && c.armed) {
        c.armed = false;
        throw new DOMException('held old mark', 'QuotaExceededError');
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await lesson(page);
  await page.evaluate(() => {
    (window as unknown as { __staleMark: { armed: boolean } }).__staleMark.armed = true;
  });
  await variableMark(page).click();
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'unsaved');
  const other = await context.newPage();
  await lesson(other);
  await variableMark(other).click();
  await expect(variableMark(other)).toHaveAttribute('aria-pressed', 'true');
  const saved = ((await archive(other)) as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks;
  await marksStatus(page).getByRole('button', { name: '重试陌生标记', exact: true }).click();
  await test.info().attach('actual-peer-mark-and-stale-retry-status', {
    body: JSON.stringify({
      saved,
      after: ((await archive(page)) as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks,
      status: await marksStatus(page).getAttribute('data-state'),
      text: await marksStatus(page).textContent(),
    }),
    contentType: 'application/json',
  });
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'failed');
  await expect(marksStatus(page)).toContainText('S_REVISION_CONFLICT');
  expect(
    ((await archive(page)) as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks,
  ).toEqual(saved);
  await marksStatus(page).getByRole('button', { name: '重新读取陌生标记', exact: true }).click();
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'ready');
  await variableMark(page).click();
  await expect(variableMark(page)).toHaveAttribute('aria-pressed', 'false');
});

test('15.2 formal actual C++ pointer errors collect while loop resource or deadline termination is excluded', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/#/bugs/memory/exercise.cpp.bug-uninitialized-pointer');
  await ready(page);
  await expect(page.getByRole('button', { name: '提交全部4组', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
  await expect(page.getByTestId('memory-bug-session')).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('memory-bug-session')).toHaveAttribute('data-save-state', 'saved');
  await notebook(page);
  await expect(mistake(page, 'exercise.cpp.bug-uninitialized-pointer')).toContainText('程序错误');
  const before = await archive(page);
  await page.goto('/#/bugs/memory/exercise.cpp.bug-missing-update');
  await ready(page);
  await expect(page.getByRole('button', { name: '提交全部4组', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
  await expect(page.getByTestId('memory-bug-session')).toHaveAttribute(
    'data-state',
    /^(unmet|failed)$/,
  );
  await expect(page.getByTestId('memory-bug-session')).toContainText(/E_STEP_LIMIT|E_DEADLINE/);
  await notebook(page);
  await expect(mistake(page, 'exercise.cpp.bug-missing-update')).toHaveCount(0);
  expect((await archive(page)).receipts).toEqual(before.receipts);
});
async function notebook(page: Page) {
  await page.goto('/#/notebook');
  await expect(page.getByRole('heading', { name: '错题与陌生点', exact: true })).toBeVisible();
  await ready(page);
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'ready');
}
async function lesson(page: Page) {
  await page.goto('/#/lessons/lesson.c6.s2.1');
  await expect(page.locator('.c6-teaching-reading')).toBeVisible();
  await ready(page);
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'ready');
}
async function failed(page: Page) {
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('practice-attempt-save')).toHaveAttribute(
    'data-save-state',
    'saved',
  );
  await ready(page);
}
async function changePrint(page: Page, expression: string) {
  const source = await code(page).inputValue();
  const changed = source.replace(/printf\([^;]+;/, `printf("%d\\n", ${expression});`);
  await code(page).clear();
  await expect(code(page)).toHaveValue('');
  await code(page).fill(changed);
  await expect(code(page)).toHaveValue(changed);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
}
async function prepareArithmeticRepair(page: Page) {
  await confirm(page, 'lesson.c6.s5.1');
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  await submit(page);
}

test('15.2 common empty notebook is honest, navigation and refresh never write learning or marks', async ({
  page,
}) => {
  await notebook(page);
  const before = await archive(page);
  await expect(emptyMistakes(page)).toBeVisible();
  await expect(unfamiliarRows(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'C 语言课程', exact: true }).click();
  await expect(page.getByRole('heading', { name: '课程目录', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '错题与陌生点', exact: true })).toBeVisible();
  await page.reload();
  await ready(page);
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'ready');
  expect(await archive(page)).toEqual(before);
});
test('15.2 common three widths keep notebook navigation and meaningful empty actions usable', async ({
  page,
}) => {
  await notebook(page);
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    const action = page.getByRole('link', { name: '打开复习队列', exact: true });
    await action.focus();
    await expect(action).toBeFocused();
    await page.screenshot({ path: `${folder}/empty-${width}.png`, fullPage: true });
  }
});
test('15.2 formal three genuine error categories merge, repair and reopen without read rewards', async ({
  page,
}) => {
  test.setTimeout(90000);
  await observeCaseSetExecution(page);
  await prepareArithmeticRepair(page);
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  const before = await archive(page);
  for (const [index, expression, category] of [
    [0, 'x * 2 + 4', 'wrong-answer'],
    [1, 'x + x + 3', 'teaching-goal-unmet'],
    [2, 'x / (x - x)', 'program-error'],
  ] as const) {
    await openAnswer(page, 'exercise.c.bug-parenthesis');
    // Repeated addition has the exact expected outputs, while Rust's actual
    // provenance judgement still requires the stated multiplication target.
    await changePrint(page, expression);
    await failed(page);
    await capture(page, `error-${category}`);
    await notebook(page);
    await expect(errorRow(page)).toContainText(`${index + 1} 次有效错误`);
    expect(
      (await archive(page)).receipts
        .filter((r) => r.eventType === 'exercise.attempt-evaluated')
        .sort((a, b) => a.committedRevision - b.committedRevision)
        .at(-1),
    ).toMatchObject({ resultCategory: category });
  }
  const failedArchive = await archive(page);
  expect(failedArchive.ledger).toEqual(before.ledger);
  expect(failedArchive.dailyFacts).toEqual(before.dailyFacts);
  await page.reload();
  await ready(page);
  expect(await archive(page)).toEqual(failedArchive);
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  await submit(page);
  await notebook(page);
  await expect(errorRow(page)).toContainText('已修复');
  const repaired = await archive(page);
  await errorRow(page)
    .getByRole('link', { name: /重新练习/ })
    .click();
  await ready(page);
  const revisited = await archive(page);
  // Opening the editor legitimately captures its independent initial history.
  // Every learning/appearance/mark partition must remain unchanged.
  for (const key of Object.keys(repaired) as (keyof typeof repaired)[])
    if (String(key) !== 'editHistory') expect(revisited[key]).toEqual(repaired[key]);
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  await changePrint(page, 'x + 1');
  await failed(page);
  await notebook(page);
  await expect(errorRow(page)).toContainText('待复习');
  await expect(errorRow(page)).toContainText('4 次有效错误');
  expect((await archive(page)).ledger).toEqual(repaired.ledger);
  await page.screenshot({ path: `${folder}/actual-errors.png`, fullPage: true });
  await writeFile(`${folder}/actual-errors.json`, JSON.stringify(await archive(page), null, 2));
});
test('15.2 formal failed attempt transaction retries its original event once and preserves rewards', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const control = { armed: false, ids: [] as string[] };
    Object.assign(window, { __notebookQuota: control });
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (
        this.name === 'receipts' &&
        (value as { eventType: string }).eventType === 'exercise.attempt-evaluated'
      ) {
        control.ids.push((value as { eventId: string }).eventId);
        if (control.armed) {
          control.armed = false;
          throw new DOMException('15.2 native attempt quota', 'QuotaExceededError');
        }
      }
      return key === undefined ? add.call(this, value) : add.call(this, value, key);
    };
  });
  await prepareArithmeticRepair(page);
  const before = await archive(page);
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  await changePrint(page, 'x + 1');
  await page.evaluate(() => {
    (window as unknown as { __notebookQuota: { armed: boolean } }).__notebookQuota.armed = true;
  });
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(page.getByTestId('practice-attempt-save')).toHaveAttribute(
    'data-save-state',
    'unsaved',
  );
  expect(
    (await archive(page)).receipts.filter((r) => r.eventType === 'exercise.attempt-evaluated'),
  ).toEqual([]);
  await page.goto('/#/notebook');
  await expect(emptyMistakes(page)).toBeVisible();
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重试未保存操作', exact: true })
    .click();
  await ready(page);
  await expect(errorRow(page)).toContainText('1 次有效错误');
  const ids = await page.evaluate(
    () => (window as unknown as { __notebookQuota: { ids: string[] } }).__notebookQuota.ids,
  );
  expect(ids.length).toBeGreaterThanOrEqual(2);
  expect(new Set(ids).size).toBe(1);
  const saved = await archive(page);
  expect(saved.ledger).toEqual(before.ledger);
  await page.reload();
  await ready(page);
  expect((await archive(page)).receipts).toEqual(saved.receipts);
});
test('15.2 formal double mark, refresh, source review and familiar tombstone have no learning side effects', async ({
  page,
  context,
}) => {
  await lesson(page);
  const before = await archive(page);
  await variableMark(page).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'ready');
  await expect(variableMark(page)).toHaveAttribute('aria-pressed', 'true');
  const marked = await archive(page);
  expect((marked as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks).toHaveLength(1);
  expect(marked.receipts).toEqual(before.receipts);
  expect(marked.ledger).toEqual(before.ledger);
  await page.reload();
  await ready(page);
  await expect(variableMark(page)).toHaveAttribute('aria-pressed', 'true');
  const other = await context.newPage();
  await notebook(other);
  await expect(unfamiliarRows(other)).toHaveCount(1);
  await other.screenshot({ path: `${folder}/actual-mark.png`, fullPage: true });
  await writeFile(`${folder}/actual-mark.json`, JSON.stringify(await archive(other), null, 2));
  await other.getByRole('link', { name: '2.1 简单的C程序示例', exact: true }).click();
  await ready(other);
  expect((await archive(other)).receipts).toEqual(before.receipts);
  await variableMark(page).click();
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'ready');
  await notebook(other);
  await expect(unfamiliarRows(other)).toHaveCount(0);
  const row = (
    (await archive(page)) as unknown as {
      knowledgeMarks: { marked: boolean; revision: number; firstAt: string }[];
    }
  ).knowledgeMarks[0];
  expect(row).toMatchObject({ marked: false, revision: 2 });
  expect(row.firstAt).toBe(
    (marked as unknown as { knowledgeMarks: { firstAt: string }[] }).knowledgeMarks[0].firstAt,
  );
});
test('15.2 formal native mark rollback and exact retry preserve the original command identity', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const control = { armed: false, ids: [] as string[] };
    Object.assign(window, { __markQuota: control });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'knowledgeMarks') {
        control.ids.push((value as { commandId: string }).commandId);
        if (control.armed) {
          control.armed = false;
          throw new DOMException('15.2 mark quota', 'QuotaExceededError');
        }
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await lesson(page);
  const before = await archive(page);
  await page.evaluate(() => {
    (window as unknown as { __markQuota: { armed: boolean } }).__markQuota.armed = true;
  });
  await variableMark(page).click();
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'unsaved');
  expect(await archive(page)).toEqual(before);
  await marksStatus(page).getByRole('button', { name: '重试陌生标记', exact: true }).click();
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'ready');
  await expect(variableMark(page)).toHaveAttribute('aria-pressed', 'true');
  const ids = await page.evaluate(
    () => (window as unknown as { __markQuota: { ids: string[] } }).__markQuota.ids,
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await notebook(page);
  await expect(unfamiliarRows(page)).toHaveCount(1);
});
test('15.2 formal peer clear discards pending marks and stored error summaries without resurrection', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const control = { armed: false };
    Object.assign(window, { __clearMark: control });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'knowledgeMarks' && control.armed) {
        control.armed = false;
        throw new DOMException('15.2 held mark', 'QuotaExceededError');
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await lesson(page);
  await variableMark(page).click();
  await expect(variableMark(page)).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    (window as unknown as { __clearMark: { armed: boolean } }).__clearMark.armed = true;
  });
  await variableMark(page).click();
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'unsaved');
  const other = await context.newPage();
  await other.goto('/#/settings?panel=data');
  await ready(other);
  await other.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await other
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(variableMark(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(
    marksStatus(page).getByRole('button', { name: '重试陌生标记', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await notebook(page);
  await expect(unfamiliarRows(page)).toHaveCount(0);
  expect(
    ((await archive(page)) as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks,
  ).toEqual([]);
  await page.reload();
  await ready(page);
  expect((await archive(page)).receipts).toEqual([]);
});
test('15.2 formal corrupt mark partition stays preserved and visibly unavailable until an explicit full clear', async ({
  page,
}) => {
  await lesson(page);
  await variableMark(page).click();
  await expect(variableMark(page)).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('knowledgeMarks', 'readwrite');
    const r = tx.objectStore('knowledgeMarks').openCursor();
    r.onsuccess = () => {
      if (r.result) r.result.update({ ...r.result.value, unexpected: 'malformed controlled test' });
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await ready(page);
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'failed');
  await expect(variableMark(page)).toBeDisabled();
  const rows = ((await archive(page)) as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks;
  expect(rows).toHaveLength(1);
  await marksStatus(page).getByRole('button', { name: '重新读取陌生标记', exact: true }).click();
  await expect(marksStatus(page)).toHaveAttribute('data-state', 'failed');
  expect(
    ((await archive(page)) as unknown as { knowledgeMarks: unknown[] }).knowledgeMarks,
  ).toEqual(rows);
});

test('15.2 formal damaged core attempt receipts show unknown instead of a false empty notebook', async ({
  page,
}) => {
  await prepareArithmeticRepair(page);
  await openAnswer(page, 'exercise.c.bug-parenthesis');
  await changePrint(page, 'x + 1');
  await failed(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('receipts', 'readwrite');
    const req = tx.objectStore('receipts').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        if (c.value.eventType === 'exercise.attempt-evaluated')
          c.update({ ...c.value, unexpected: 'controlled corruption' });
        else c.continue();
      }
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  const before = await archive(page);
  await page.goto('/#/notebook');
  await page.reload();
  await expect(page.getByRole('heading', { name: '错题与陌生点', exact: true })).toBeVisible();
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'readonly',
  );
  await expect(
    page.getByText('学习记录暂不能确认，请恢复本地档案。', { exact: true }),
  ).toBeVisible();
  await expect(emptyMistakes(page)).toHaveCount(0);
  expect((await archive(page)).receipts).toEqual(before.receipts);
});
