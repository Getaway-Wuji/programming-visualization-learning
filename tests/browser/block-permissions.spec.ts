import { editorValue, expectEditorValue } from './editor-value';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { StorageSnapshot } from '../../web/src/storage/model';
import { initSync } from '../../web/src/generated/c_viz_wasm';
import { setBlockPreference, showPracticeBlocks, openBlockKeyboardEditor } from './block-ui';
import { observeCaseSetExecution } from './case-set-observation';
import { routeHistoricalApp } from './legacy-app';
import {
  confirm as confirmLegacy,
  openAnswer as answerLegacy,
  submit as submitLegacy,
} from './notebook-helpers';
import {
  completeCurrentFirstGroup,
  confirmCurrentLesson,
  openCurrentAnswer,
  openIndependentRepair,
} from './current-course-helpers';
import { installC6Packets, observedC6Packet } from './c6-observation';
import { decodeC6Response, type C6JudgeRequest } from '../../web/src/engine/c6-protocol';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';

const panel = (page: Page) => page.getByTestId('practice-execution');
const code = (page: Page) => page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
const permission = (page: Page, kind: string) =>
  page.getByTestId('block-permissions').locator(`[data-block-kind="${kind}"]`);
const localReady = (page: Page) =>
  expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
const sources = new WeakMap<Page, string>();
test.beforeEach(async ({ context }) => {
  await context.addInitScript(installC6Packets);
});
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
async function open(page: Page) {
  await openIndependentRepair(page, 'exercise.c.bug-semicolon');
  await showPracticeBlocks(page, { readOnly: false });
  await localReady(page);
  await expect(code(page)).toBeEditable();
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  sources.set(page, await editorValue(code(page)));
}
async function fill(page: Page) {
  if (!sources.has(page)) throw new Error('Original public repair source required');
  await code(page).fill(sources.get(page)!);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
}
async function captureCurrent(page: Page) {
  const captured = await observedC6Packet(page);
  expect(captured).toMatchObject({ moduleSeen: true, terminated: true });
  // Retained repair preparation also constructs workers; count actual judge IPC
  // rather than treating every worker in this mixed-language route as a judge.
  expect(
    await page.evaluate(
      () =>
        window.c6CurrentPackets.filter(
          (p) => p.request && 'judgeVersion' in JSON.parse(new TextDecoder().decode(p.request)),
        ).length,
    ),
  ).toBe(1);
  const requestBytes = Buffer.from(captured.request!, 'base64');
  const resultBytes = Buffer.from(captured.response!, 'base64');
  const request = JSON.parse(requestBytes.toString('utf8')) as C6JudgeRequest;
  const exercise = (
    JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
      chapters: {
        exercises: {
          ref: { id: string };
          referenceSource: string;
          profileRef: unknown;
          tests: { expectedStdout: string }[];
        }[];
      }[];
    }
  ).chapters
    .flatMap((c) => c.exercises)
    .find((e) => e.ref.id === 'exercise.c6.s2.1')!;
  expect(request.source).toBe(exercise.referenceSource);
  expect(request.profileRef).toEqual(exercise.profileRef);
  const result = await decodeC6Response(
    Uint8Array.from(resultBytes).buffer,
    request,
    engineBuild.wasmSha256,
  );
  if (!('cases' in result)) throw new Error('Current four-case response required');
  expect(result.status).toBe('passed');
  expect(result.cases).toHaveLength(4);
  for (const [i, c] of result.cases.entries()) {
    expect(c.stdoutMatches && c.returnMatches && c.observationMatches).toBe(true);
    expect(c.packet.terminal.status).toBe('completed');
    const output =
      c.packet.trace!.initialState.output +
      c.packet
        .trace!.steps.flatMap((s) =>
          s.changes.flatMap((v) => (v.op === 'output' ? [v.append] : [])),
        )
        .join('');
    expect(output).toBe(exercise.tests[i].expectedStdout);
  }
  await test
    .info()
    .attach('current-permissions-request', { body: requestBytes, contentType: 'application/json' });
  await test
    .info()
    .attach('current-permissions-result', { body: resultBytes, contentType: 'application/json' });
}
async function noPermanent(page: Page) {
  if (!page.url().includes('/practice/exercise.c.bug-')) await open(page);
  else await showPracticeBlocks(page, { readOnly: false });
  await expect(page.getByTestId('block-permissions').locator('summary')).toContainText(
    '已永久解锁 0 / 20',
  );
  await expect(permission(page, 'scope')).toHaveAttribute('data-access', '未解锁');
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
  const bad = sources.get(page)!.replace('printf(', 'while (0) {}\n    printf(');
  await code(page).fill(bad);
  await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  await expect(page.getByTestId('block-permission-blocked')).toContainText('while 循环');
  await expect(panel(page).getByRole('button', { name: '运行本组', exact: true })).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeDisabled();
  await setBlockPreference(page, 'hide');
  await expectEditorValue(code(page), bad);
  await expect(panel(page).getByRole('button', { name: '提交练习', exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      () => window.__verticalObservation.workers.filter((r) => r.kind === 'execute').length,
    ),
  ).toBe(0);
  await fill(page);
  await submit(page);
  const saved = await archive(page);
  expect(saved.progress.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(1);
  expect(saved.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(0);
  await showPracticeBlocks(page, { readOnly: false });
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
  await observeCaseSetExecution(page);
  await open(page);
  const other = await context.newPage();
  await open(other);
  await completeCurrentFirstGroup(page);
  await captureCurrent(page);
  await noPermanent(other);
  await open(page);
  await noPermanent(page);
  await submit(page);
  const saved = await archive(page);
  expect(saved.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(2);
  expect(saved.ledger.reduce((s, r) => s + (r.points ?? 0), 0)).toBe(45);
  await submit(page);
  expect((await archive(page)).ledger).toEqual(saved.ledger);
  const executions = await page.evaluate(
    () => window.__verticalObservation.workers.filter((r) => r.kind === 'execute').length,
  );
  await page.goto('/#/practice/exercise.c.bug-semicolon/review');
  await expect(panel(page)).toHaveAttribute('data-state', 'passed');
  expect(
    await page.evaluate(
      () => window.__verticalObservation.workers.filter((r) => r.kind === 'execute').length,
    ),
  ).toBe(executions);
  await open(page);
  await noPermanent(page);
  await expect(permission(page, 'while')).toHaveAttribute('data-access', '未解锁');
  await page.reload();
  await localReady(page);
  await noPermanent(page);
  await page.goto('/#/settings?panel=data');
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认清除本地数据', exact: true })
    .getByRole('button', { name: '确认清除', exact: true })
    .click();
  await localReady(page);
  // The peer must consume the clear generation before a new display choice;
  // its old visible canvas can otherwise disappear after the helper returns.
  await expect(other.getByRole('region', { name: '积木工作区', exact: true })).toHaveCount(0);
  await localReady(other);
  await showPracticeBlocks(other, { readOnly: false });
  await expect(permission(other, 'scope')).toHaveAttribute('data-access', '未解锁');
  expect((await archive(other)).progress).toEqual([]);
  await other.close();
});

test('13.3 failed save grants no permanent access; original real pass retry grants once', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    const state = { armed: false, attempted: [] as unknown[] };
    Object.assign(window, { __permissionQuota: state });
    for (const method of ['add', 'put'] as const) {
      const native = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value, key) {
        if (
          state.armed &&
          this.name === 'receipts' &&
          (value as { eventType?: string })?.eventType === 'exercise.passed'
        ) {
          state.armed = false;
          state.attempted.push(structuredClone(value));
          throw new DOMException('13.3 quota injection', 'QuotaExceededError');
        }
        return key === undefined ? native.call(this, value) : native.call(this, value, key);
      };
    }
  });
  await confirmCurrentLesson(page, 'lesson.c6.s2.1');
  await confirmCurrentLesson(page, 'lesson.c6.s2.2.1');
  await openCurrentAnswer(page, 'exercise.c6.s2.1');
  const before = await archive(page);
  await page.evaluate(() => {
    (window as unknown as { __permissionQuota: { armed: boolean } }).__permissionQuota.armed = true;
  });
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict').filter({ hasText: /^通过$/ })).toBeVisible();
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toHaveCount(0);
  await captureCurrent(page);
  const failed = await archive(page);
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'] as const)
    expect(failed[store]).toEqual(before[store]);
  await page.goto('/#/');
  await page
    .getByTestId('learning-save-status')
    .getByRole('button', { name: '重试未保存操作', exact: true })
    .click();
  await localReady(page);
  const saved = await archive(page);
  expect(saved.progress.filter((r) => r.eventType === 'lesson.completed')).toHaveLength(2);
  expect(saved.receipts.filter((r) => r.eventType === 'exercise.passed')).toHaveLength(1);
  expect(saved.ledger.reduce((s, r) => s + (r.points ?? 0), 0)).toBe(35);
  expect(saved.ledger.filter((r) => r.sourceId === 'reward.lesson.first-completion')).toHaveLength(
    1,
  );
  const fault = await page.evaluate(
    () =>
      (window as unknown as { __permissionQuota: { armed: boolean; attempted: unknown[] } })
        .__permissionQuota,
  );
  expect(fault.armed).toBe(false);
  expect(fault.attempted).toHaveLength(1);
  await open(page);
  await noPermanent(page);
  await expect(permission(page, 'print')).toHaveAttribute('data-access', '本节可用');
});

test('13.3 legacy first completion keeps only its original grants after the 32-lesson upgrade', async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await routeHistoricalApp(page, new URL(test.info().project.use.baseURL as string).origin);
  const pattern = '**/content/course/course-bundle-*.json';
  await page.route(pattern, (route) =>
    route.fulfill({ status: 404, body: 'Explicit original-course fallback' }),
  );
  await confirmLegacy(page, 'lesson.c.variables-output');
  await answerLegacy(page, 'exercise.c.echo');
  await submitLegacy(page);
  const old = await archive(page);
  expect(old.progress.filter((row) => row.eventType === 'lesson.completed')).toHaveLength(1);
  await expect(page.getByTestId('block-permissions').locator('summary')).toContainText(
    '已永久解锁 8 / 20',
  );
  await expect(permission(page, 'arithmetic')).toHaveAttribute('data-access', '未解锁');
  await page.getByTestId('block-permissions').locator('summary').click();
  await expect(permission(page, 'scope').getByRole('link')).toHaveAttribute(
    'href',
    /#\/lessons\/lesson\.c\.loops$/,
  );
  const current = await context.newPage();
  await open(current);
  const reset = await archive(current);
  expect(reset.meta.generation).not.toBe(old.meta.generation);
  expect(reset.progress).toEqual([]);
  expect(reset.ledger).toEqual([]);
  await noPermanent(current);
  await expect(permission(current, 'arithmetic')).toHaveAttribute('data-access', '未解锁');
  await expect(permission(current, 'while')).toHaveAttribute('data-access', '未解锁');
  await completeCurrentFirstGroup(current);
  await captureCurrent(current);
  await open(current);
  await noPermanent(current);
  expect((await archive(current)).ledger.reduce((s, r) => s + (r.points ?? 0), 0)).toBe(35);
  await current.close();
});
