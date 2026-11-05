import { openCurrentAnswer, submitCurrent } from './current-course-helpers';
import { assertCurrentJudge } from './current-practice-observation';
import { installC6Packets } from './c6-observation';
import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { memoryBugQuestions } from '../../web/src/memory-bugs/content';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
import { observeCaseSetExecution } from './case-set-observation';
import type { EditorSnapshot } from '../../web/src/storage/editor-history';
import type { LedgerEntry, Progress } from '../../web/src/storage/model';

const folder = `.artifacts/14.4/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
const root = (p: Page) => p.getByTestId('memory-bug-session');
const editor = (p: Page) => p.getByRole('textbox', { name: '编辑关卡 C++ 代码', exact: true });
const history = (p: Page) => p.getByTestId('memory-bug-history');
const sourceText = (p: Page) =>
  p
    .locator('.code-editor .cm-line')
    .allTextContents()
    .then((lines) => lines.join('\n'));
async function rows(p: Page) {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((yes, no) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => yes(request.result);
      request.onerror = () => no(request.error);
    });
    try {
      const names = ['progress', 'ledger', 'receipts', 'editHistory'],
        tx = db.transaction(names);
      return Object.fromEntries(
        await Promise.all(
          names.map(
            (name) =>
              new Promise<[string, unknown[]]>((yes) => {
                const r = tx.objectStore(name).getAll();
                r.onsuccess = () => yes([name, r.result]);
              }),
          ),
        ),
      ) as {
        progress: Progress[];
        ledger: LedgerEntry[];
        receipts: { eventId: string; eventType: string }[];
        editHistory: EditorSnapshot[];
      };
    } finally {
      db.close();
    }
  });
}
async function open(p: Page, index = 0) {
  const q = memoryBugQuestions[index];
  await p.goto(`/#/bugs/memory/${q.exerciseRef.id}`);
  await expect.poll(() => sourceText(p)).toBe(q.brokenSource);
  await expect(p.getByRole('button', { name: '提交', exact: true })).toBeEnabled();
  await expect(history(p)).toHaveAttribute('data-save-state', 'ready');
  return q;
}
async function submit(p: Page) {
  await p.getByRole('button', { name: '提交', exact: true }).click();
  await expect(root(p)).toHaveAttribute('data-state', 'passed');
  await expect(root(p)).toHaveAttribute(
    'data-save-state',
    p05CourseRelease.registered ? 'saved' : 'unavailable',
  );
}
async function capture(p: Page, label: string, observations: Record<string, unknown> = {}) {
  const records = await p.evaluate(() =>
    window.__verticalObservation.workers
      .filter((w) => w.moduleSeen && w.responseOk)
      .map((w) => ({
        moduleSeen: w.moduleSeen,
        operationId: w.operationId,
        timing: (w as unknown as { timing: unknown }).timing,
        ...(
          w as unknown as {
            captureEncoded: () => { requestBase64: string | null; responseBase64: string | null };
          }
        ).captureEncoded(),
      })),
  );
  const budgets = await p.evaluate(
    () => (window as unknown as { __memoryBudgets: unknown[] }).__memoryBudgets,
  );
  await mkdir(folder, { recursive: true });
  const captures = [];
  for (const [i, r] of records.entries()) {
    if (!r.requestBase64 || !r.responseBase64) continue;
    const request = JSON.parse(Buffer.from(r.requestBase64, 'base64').toString());
    if (!request.bug) continue;
    const raw = Buffer.from(r.responseBase64, 'base64'),
      result = JSON.parse(raw.toString());
    const gzip = `${label}-${i}.json.gz`;
    await writeFile(`${folder}/${gzip}`, gzipSync(raw));
    captures.push({
      request,
      moduleSeen: r.moduleSeen,
      operationId: r.operationId,
      timing: r.timing,
      terminal: result.terminal,
      verdict: result.bugJudgement,
      stats: result.stats,
      steps: result.trace?.steps.length,
      completeness: result.trace?.completeness,
      raw: {
        file: gzip,
        bytes: raw.length,
        sha256: createHash('sha256').update(raw).digest('hex'),
      },
    });
  }
  const proof = { captures, budgets, observations, rows: await rows(p) };
  await writeFile(`${folder}/${label}.json`, JSON.stringify(proof, null, 2) + '\n');
  return proof;
}
test.beforeEach(async ({ page }) => {
  await observeCaseSetExecution(page);
  await page.addInitScript(() => {
    const budgets: {
      operationId: unknown;
      remainingMs: unknown;
      at: number;
      wasmPages: number | null;
    }[] = [];
    Object.assign(window, { __memoryBudgets: budgets });
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      options: Transferable[] | StructuredSerializeOptions = [],
    ) {
      const value = message as { operationId?: unknown; remainingMs?: unknown; module?: unknown };
      if (value?.module instanceof WebAssembly.Module) {
        const entry = {
          operationId: value.operationId,
          remainingMs: value.remainingMs,
          at: performance.now(),
          wasmPages: null as number | null,
        };
        budgets.push(entry);
        this.addEventListener(
          'message',
          (event: MessageEvent) => {
            const data = event.data as { wasmPages?: unknown };
            if (typeof data?.wasmPages === 'number') entry.wasmPages = data.wasmPages;
          },
          { once: true },
        );
      }
      return post.call(this, message, Array.isArray(options) ? { transfer: options } : options);
    };
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  await capture(
    page,
    'failure-' + createHash('sha256').update(info.title).digest('hex').slice(0, 10),
    {
      title: info.title,
      status: info.status,
      root: await root(page).evaluate((element) => element.outerHTML.slice(0, 1800)),
      native: await rows(page),
    },
  );
});
// The OJ interface intentionally exposes no runtime player. Inspect actual
// worker packets for execution evidence, while testing the public submission flow.
for (const [index, q] of memoryBugQuestions.entries())
  test(`real pointer/loop failure and durable repair: ${q.exerciseRef.id}`, async ({ page }) => {
    await open(page, index);
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(root(page)).toHaveAttribute('data-state', 'unmet');
    await expect(page.getByTestId('oj-verdict')).toHaveText('未通过');
    expect((await rows(page)).ledger).toHaveLength(0);
    const code = ['E_UNINITIALIZED', 'E_DANGLING_POINTER', 'E_STEP_LIMIT', 'E_STEP_LIMIT'][index];
    const failed = await capture(page, q.exerciseRef.id + '-broken');
    expect(failed.captures[0].terminal.code).toBe(code);
    expect(failed.captures[0].completeness).toBe('prefix');
    await editor(page).fill(q.solutionSource);
    await expect(page.getByTestId('oj-verdict')).toHaveCount(0);
    await submit(page);
    await expect(page.getByTestId('oj-verdict')).toHaveText('通过');
    const first = await rows(page);
    expect(first.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass')).toHaveLength(
      p05CourseRelease.registered ? 1 : 0,
    );
    await submit(page);
    expect((await rows(page)).ledger).toEqual(first.ledger);
    const proof = await capture(page, q.exerciseRef.id);
    expect(proof.captures.filter((r) => r.verdict.status === 'met')).toHaveLength(8);
    expect(proof.captures.every((r) => r.moduleSeen && r.request.language === 'cpp')).toBe(true);
    expect(
      (proof.budgets as { remainingMs: number }[]).every(
        (row) => row.remainingMs > 0 && row.remainingMs <= 1000,
      ),
    ).toBe(true);
    await expect(page.getByTestId('player-controls')).toHaveCount(0);
    await expect(page.locator('.blocklySvg')).toHaveCount(0);
    await page.reload();
    await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
    expect((await rows(page)).ledger).toEqual(first.ledger);
  });

test('native code history restores broken and repaired text while old verdict expires', async ({
  page,
}) => {
  const q = await open(page, 1);
  const broken = (await rows(page)).editHistory.find((r) => r.codeText === q.brokenSource)!;
  await editor(page).fill(q.solutionSource);
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  await submit(page);
  const fixed = (await rows(page)).editHistory.find((r) => r.codeText === q.solutionSource)!;
  expect(broken).toBeDefined();
  expect(fixed).toBeDefined();
  await page.reload();
  await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
  await history(page).locator('summary').click();
  for (const row of [fixed, broken]) {
    await page
      .getByRole('combobox', { name: '内存关卡历史版本', exact: true })
      .selectOption(row.entryId);
    await page.getByRole('button', { name: '恢复所选版本', exact: true }).click();
    await expect.poll(() => sourceText(page)).toBe(row.codeText);
    await expect(page.getByTestId('oj-verdict')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText('未通过');
});

test('real held replies cannot survive source edits or explicit cancellation', async ({ page }) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    const state = { hold: true, held: [] as (() => void)[] };
    Object.assign(window, { __heldMemoryBug: state });
    window.Worker = class extends Native {
      override set onmessage(handler: Worker['onmessage']) {
        super.onmessage = handler
          ? (event) => {
              const deliver = () => handler.call(this, event);
              if (state.hold) state.held.push(deliver);
              else deliver();
            }
          : null;
      }
      override get onmessage() {
        return super.onmessage;
      }
    };
  });
  const q = await open(page);
  await editor(page).fill(q.solutionSource);
  const held = () =>
    page.waitForFunction(
      () =>
        (window as unknown as { __heldMemoryBug: { held: unknown[] } }).__heldMemoryBug.held
          .length === 1,
    );
  const release = (hold: boolean) =>
    page.evaluate((hold) => {
      const state = (
        window as unknown as { __heldMemoryBug: { hold: boolean; held: (() => void)[] } }
      ).__heldMemoryBug;
      state.hold = hold;
      state.held.splice(0).forEach((fn) => fn());
    }, hold);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await held();
  await editor(page).fill(q.alternativeSource);
  await release(true);
  await expect(root(page)).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await held();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await release(false);
  await expect(root(page)).toHaveAttribute('data-state', 'ready');
  expect((await rows(page)).ledger).toHaveLength(0);
  await submit(page);
});

test('eight-level catalog and OJ editor remain usable at three widths', async ({ page }) => {
  await page.goto('/#/bugs');
  await expect(page.locator('[data-page-id="PAGE-14-3"] article')).toHaveCount(8);
  await page
    .getByRole('link', { name: `修复：${memoryBugQuestions[0].title}`, exact: true })
    .click();
  await expect(editor(page)).toBeEditable();
  await page.getByText('提示与解析', { exact: true }).click();
  await page.getByRole('button', { name: '查看提示', exact: true }).click();
  await expect(root(page)).toContainText(memoryBugQuestions[0].hints[0]);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await editor(page).scrollIntoViewIfNeeded();
    await expect(editor(page)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  }
  await expect(page.getByRole('button', { name: /下载/ })).toHaveCount(0);
});

test('missing atomic content disables memory submission and grants no progress', async ({
  page,
}) => {
  await page.route('**/content/c/primer6-teaching/manifest-2.0.0.json', (route) => route.abort());
  await page.goto(`/#/bugs/memory/${memoryBugQuestions[0].exerciseRef.id}`);
  await expect(page.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
  await expect(root(page)).toContainText('题目暂时无法读取');
});

if (p05CourseRelease.registered) {
  test('quota retry keeps the same real event and awards once', async ({ page }) => {
    await page.addInitScript(() => {
      const fault = { armed: false, eventId: '', hits: 0 };
      Object.assign(window, { __memoryBugFault: fault });
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) {
        const row = value as { eventType?: string; eventId?: string };
        if (fault.armed && this.name === 'receipts' && row.eventType === 'exercise.passed') {
          fault.hits++;
          fault.eventId = row.eventId!;
          throw new DOMException('OJ quota test', 'QuotaExceededError');
        }
        return key === undefined ? add.call(this, value) : add.call(this, value, key);
      };
    });
    const q = await open(page, 1);
    await editor(page).fill(q.solutionSource);
    await page.evaluate(() => {
      (window as unknown as { __memoryBugFault: { armed: boolean } }).__memoryBugFault.armed = true;
    });
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(root(page)).toHaveAttribute('data-state', 'passed');
    await expect(root(page)).toHaveAttribute('data-save-state', 'unsaved');
    expect((await rows(page)).ledger).toHaveLength(0);
    const id = await page.evaluate(() => {
      const f = (
        window as unknown as { __memoryBugFault: { armed: boolean; eventId: string; hits: number } }
      ).__memoryBugFault;
      f.armed = false;
      return f.eventId;
    });
    await page.getByRole('button', { name: '重试未保存操作', exact: true }).click();
    await expect(root(page)).toHaveAttribute('data-save-state', 'saved');
    const first = await rows(page);
    expect(first.receipts.some((r) => r.eventId === id)).toBe(true);
    expect(first.ledger).toHaveLength(1);
    await submit(page);
    expect((await rows(page)).ledger).toEqual(first.ledger);
  });
  test('current C, C repair and C++ repair keep three separate rewards after refresh', async ({
    page,
  }) => {
    await page.addInitScript(installC6Packets);
    const exercise = await openCurrentAnswer(page, 'exercise.c6.s2.1');
    await submitCurrent(page);
    await assertCurrentJudge(page, exercise, 'passed');
    await page.goto('/#/practice/exercise.c.bug-semicolon');
    const c = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
    await expect(c).toBeEditable();
    await c.fill((await sourceText(page)).replace('printf("%d\\n", x)', 'printf("%d\\n", x);'));
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await expect(page.getByTestId('practice-execution')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    const previous = await rows(page);
    const q = await open(page);
    await editor(page).fill(q.solutionSource);
    await submit(page);
    const all = await rows(page);
    expect(all.ledger.filter((r) => r.sourceId === 'reward.exercise.first-pass')).toHaveLength(3);
    expect(
      all.ledger.filter((r) =>
        previous.ledger.some((p) => r.subjectId === p.subjectId && r.sourceId === p.sourceId),
      ),
    ).toEqual(previous.ledger);
    await page.reload();
    await expect(history(page)).toHaveAttribute('data-save-state', 'ready');
    expect((await rows(page)).ledger).toEqual(all.ledger);
  });
}
