import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ContentPackage } from '../../web/src/content/types';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { showPracticeBlocks, openBlockKeyboardEditor } from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';

const course = JSON.parse(
  readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
) as ContentPackage;
const references = JSON.parse(
  readFileSync('tests/fixtures/p05-reference-solutions.json', 'utf8'),
) as { solutions: { exerciseRef: { id: string }; source: string }[] };
const panel = (page: Page) => page.getByTestId('practice-execution');
const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const permission = (page: Page, kind: string) =>
  page.getByTestId('block-permissions').locator(`[data-block-kind="${kind}"]`);
const localReady = (page: Page) =>
  expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    p05CourseRelease.registered ? 'ready' : /^(ready|unsaved)$/,
  );
async function archive(page: Page): Promise<StorageSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const names = Array.from(db.objectStoreNames),
        tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const rows = await Promise.all(
        names.map(async (name) => [
          name,
          await new Promise<unknown>((resolve, reject) => {
            const s = tx.objectStore(name),
              r = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
                ? s.get('current')
                : s.getAll();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
        ]),
      );
      await done;
      return Object.fromEntries(rows) as unknown as StorageSnapshot;
    } finally {
      db.close();
    }
  });
}
function answer(id: string) {
  const subject = course.exercises.find((e) => e.id === id)!;
  const program = course.programs.find((p) => p.id === subject.programRef.id)!;
  const catalog = {
    packageRef: { id: course.packageId, version: course.packageVersion },
    subject,
    program: {
      ...program,
      sourceExample: references.solutions.find((s) => s.exerciseRef.id === id)!.source,
    },
    inputSpec: course.inputSpecs.find((s) => s.id === program.inputRef.id)!,
    judgeProfile: course.judgeProfiles.find((j) => j.id === subject.judgeRef.id)!,
  };
  const input = Object.fromEntries(
    Object.entries(subject.tests[0].input).sort(([a], [b]) => a.localeCompare(b)),
  );
  return (
    JSON.parse(
      new TextDecoder().decode(
        prepare_input(
          JSON.stringify(catalog),
          new TextEncoder().encode(JSON.stringify(input)),
          1000,
        ),
      ),
    ) as { source: { text: string } }
  ).source.text;
}
async function open(page: Page, id = 'exercise.c.first-output') {
  await page.goto(`/#/practice/${id}`);
  await expect(panel(page)).toHaveAttribute('data-state', 'ready');
  await localReady(page);
  await expect(code(page)).toBeEditable();
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
}
async function fill(page: Page, id: string) {
  await code(page).fill(answer(id));
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
}
async function confirm(page: Page, id: string) {
  const lesson = course.lessons.find((l) => l.requiredExerciseRefs.some((e) => e.id === id))!;
  await page.goto(`/#/lessons/${lesson.id}`);
  await localReady(page);
  await expect(page.getByTestId('lesson-reading')).toHaveAttribute('data-state', 'ready');
  const start = page.getByRole('button', { name: '开始本节学习', exact: true });
  if (await start.isEnabled()) {
    await start.click();
    await localReady(page);
  }
  await page.getByRole('button', { name: /^(确认已学习|确认今日复习)$/ }).click();
  await localReady(page);
  await expect(page.getByTestId('lesson-confirmation-check')).toHaveAttribute('data-saved', 'yes');
}
async function submit(page: Page, status = 'saved') {
  await panel(page).getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await expect(page.getByTestId('practice-pass-save')).toHaveAttribute('data-save-state', status);
  if (status === 'saved') await localReady(page);
}
test.beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));

test('13.3 fresh learner: locked toolbox and keyboard, code/hidden-block guard, repair and unconfirmed pass', async ({
  page,
}, info) => {
  await observeCaseSetExecution(page);
  await open(page);
  await expect(permission(page, 'while')).toHaveAttribute('data-access', '未解锁');
  await expect(permission(page, 'print')).toHaveAttribute('data-access', '本节可用');
  await showPracticeBlocks(page, { readOnly: false });
  await openBlockKeyboardEditor(page);
  await expect(
    page
      .getByRole('combobox', { name: '添加积木类型', exact: true })
      .locator('option[value="while"]'),
  ).toHaveAttribute('disabled', '');
  await page.getByRole('treeitem', { name: '条件与循环', exact: true }).click();
  await expect(page.locator('.blocklyFlyout .blocklyDisabled')).toHaveCount(5);
  const bad = answer('exercise.c.first-output').replace('printf(', 'while (0) {}\n    printf(');
  await code(page).fill(bad);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await expect(page.getByTestId('block-permission-blocked')).toContainText('while 循环');
  await expect(panel(page).getByRole('button', { name: '运行本组', exact: true })).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeDisabled();
  const pref = page.getByRole('combobox', { name: '积木显示', exact: true });
  await pref.selectOption('hide');
  await expect(code(page)).toHaveValue(bad);
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.__verticalObservation.workers.filter((r) => r.kind === 'execute').length,
    ),
  ).toBe(0);
  await fill(page, 'exercise.c.first-output');
  await submit(page, p05CourseRelease.registered ? 'saved' : 'unavailable');
  const saved = await archive(page);
  expect(saved.progress.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(
    p05CourseRelease.registered ? 1 : 0,
  );
  expect(saved.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(0);
  await expect(page.getByTestId('block-permissions').locator('summary')).toContainText(
    '已永久解锁 0 / 20',
  );
  await page.getByTestId('block-permissions').locator('summary').click();
  const dir = join('.artifacts/13.3/visual', process.env.TASK_EVIDENCE_LABEL ?? 'default');
  await mkdir(dir, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('block-permissions').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: join(dir, `${info.project.name}-${width}.png`), fullPage: true });
    await page
      .getByTestId('block-permissions')
      .screenshot({ path: join(dir, `${info.project.name}-${width}-permissions.png`) });
  }
});

test('13.3 saved completion: permanent access, cross-tab refresh, review, repeat rewards and clear barrier', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await open(page);
  const other = await context.newPage();
  await open(other);
  await confirm(page, 'exercise.c.shadowed-values');
  await open(page, 'exercise.c.shadowed-values');
  await fill(page, 'exercise.c.shadowed-values');
  await submit(page);
  await expect(permission(page, 'scope')).toHaveAttribute('data-access', '已永久解锁');
  await expect(permission(other, 'scope')).toHaveAttribute('data-access', '已永久解锁');
  const saved = await archive(page);
  expect(saved.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(1);
  await submit(page);
  expect((await archive(page)).ledger).toEqual(saved.ledger);
  await page.goto('/#/practice/exercise.c.shadowed-values/review');
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  await open(page);
  await expect(permission(page, 'scope')).toHaveAttribute('data-access', '已永久解锁');
  await expect(permission(page, 'while')).toHaveAttribute('data-access', '未解锁');
  await page.reload();
  await localReady(page);
  await expect(permission(page, 'scope')).toHaveAttribute('data-access', '已永久解锁');
  await page.goto('/#/settings?panel=data');
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await expect(permission(other, 'scope')).toHaveAttribute('data-access', '未解锁');
  expect((await archive(other)).progress).toEqual([]);
  await other.close();
});

test('13.3 failed save grants no permanent access; original real pass retry grants once', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    const state = { armed: false };
    Object.assign(window, { __permissionQuota: state });
    const native = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (
        state.armed &&
        this.name === 'receipts' &&
        (value as { eventType?: string })?.eventType === 'exercise.passed'
      ) {
        state.armed = false;
        throw new DOMException('13.3 quota injection', 'QuotaExceededError');
      }
      return key === undefined ? native.call(this, value) : native.call(this, value, key);
    };
  });
  await confirm(page, 'exercise.c.shadowed-values');
  await open(page, 'exercise.c.shadowed-values');
  await fill(page, 'exercise.c.shadowed-values');
  await page.evaluate(() => {
    (window as unknown as { __permissionQuota: { armed: boolean } }).__permissionQuota.armed = true;
  });
  await submit(page, 'unsaved');
  await expect(permission(page, 'scope')).toHaveAttribute('data-access', '本节可用');
  expect((await archive(page)).progress.filter((r) => r.eventType === 'lesson.completed')).toEqual(
    [],
  );
  await page.goto('/#/courses');
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重试未保存操作', exact: true })
    .click();
  await localReady(page);
  await open(page);
  await expect(permission(page, 'scope')).toHaveAttribute('data-access', '已永久解锁');
  const saved = await archive(page);
  expect(saved.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(1);
  expect(saved.ledger.filter((r) => r.sourceId === 'reward.lesson.first-completion')).toHaveLength(
    1,
  );
});

test('13.3 legacy first completion keeps only its original grants after the 32-lesson upgrade', async ({
  page,
}) => {
  const pattern = `**/${p05CourseRelease.file}`;
  await page.route(pattern, (route) =>
    route.fulfill({ status: 404, body: 'Explicit original-course fallback' }),
  );
  await confirm(page, 'exercise.c.echo');
  await open(page, 'exercise.c.echo');
  await fill(page, 'exercise.c.echo');
  await submit(page);
  const old = await archive(page);
  expect(old.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(1);
  await expect(permission(page, 'arithmetic')).toHaveAttribute('data-access', '未解锁');
  await page.getByTestId('block-permissions').locator('summary').click();
  await expect(permission(page, 'scope').getByRole('link')).toHaveAttribute(
    'href',
    /#\/lessons\/lesson\.c\.loops$/,
  );
  await page.unroute(pattern);
  await page.goto('/#/courses');
  await page.reload();
  await localReady(page);
  await expect(page.locator('[data-course-lesson]')).toHaveCount(32);
  await open(page);
  await expect(page.getByTestId('block-permissions').locator('summary')).toContainText(
    '已永久解锁 8 / 20',
  );
  await expect(permission(page, 'arithmetic')).toHaveAttribute('data-access', '未解锁');
  await expect(permission(page, 'while')).toHaveAttribute('data-access', '未解锁');
  await expect(permission(page, 'scope')).toHaveAttribute('data-access', '未解锁');
  await page.getByTestId('block-permissions').locator('summary').click();
  await expect(permission(page, 'scope').getByRole('link')).toHaveAttribute(
    'href',
    /#\/lessons\/lesson\.c\.scope-shadowing$/,
  );
  const upgraded = await archive(page);
  expect(upgraded.progress).toEqual(old.progress);
  expect(upgraded.ledger).toEqual(old.ledger);
});
