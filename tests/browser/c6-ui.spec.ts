import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import { isUtcTime, isUuid } from '../../web/src/storage/validation';
import { existsSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import {
  confirm as confirmLegacy,
  openAnswer as legacyAnswer,
  submit as legacySubmit,
  archive as readCoreArchive,
} from './notebook-helpers';
import { initSync } from '../../web/src/generated/c_viz_wasm';
import { observeCaseSetExecution, observedCaseSetExecute } from './case-set-observation';
import { decodeResult, type ExecuteRequest } from '../../web/src/engine/protocol';

const source = JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8'));
const independentC = JSON.parse(
  readFileSync('content/c/bugs/questions-1.0.0.json', 'utf8'),
).questions;
const independentCpp = JSON.parse(
  readFileSync('content/cpp/bugs/questions-1.0.0.json', 'utf8'),
).questions;

for (const question of independentC) {
  test(`independent C ${question.exerciseRef.id}: review uses only a live run and refresh keeps durable rights without restoring its trace`, async ({
    page,
  }, info) => {
    await observeCaseSetExecution(page);
    const route = `/#/practice/${question.exerciseRef.id}`;
    await page.goto(route + '/review');
    await expect(page.locator('[data-mode="exercise-review"]')).toBeVisible();
    await expect(
      page.getByText('还没有可复盘的运行。返回练习工作区完成真实提交后再查看。'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '提交练习', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
    await page.getByRole('link', { name: '返回练习工作区', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
    await expect.poll(() => editor.inputValue()).toContain(question.brokenBody);
    const broken = await editor.inputValue();
    await editor.fill(broken.replace(question.brokenBody, question.solutionBody));
    await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
    await page.getByRole('button', { name: '提交练习', exact: true }).click();
    await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'passed');
    await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    const raw = await observedCaseSetExecute(page);
    const request = JSON.parse(Buffer.from(raw.requestBytes!).toString('utf8')) as ExecuteRequest;
    const result = await decodeResult(Uint8Array.from(raw.responseBytes!).buffer, request);
    expect(result.producer).toBe('rust');
    expect(result.terminal.status).toBe('completed');
    expect(result.judgeResult?.status).toBe('met');
    const executions = await page.evaluate(
      () => window.__verticalObservation.workers.filter((w) => w.kind === 'execute').length,
    );
    expect(executions).toBe(4);
    const before = await readCoreArchive(page);
    await page.getByRole('link', { name: '查看本次复盘', exact: true }).click();
    await expect(page.locator('[data-mode="exercise-review"]')).toBeVisible();
    await expect(page.getByRole('textbox', { name: '当前执行的 C 代码', exact: true })).toHaveValue(
      request.source.text,
    );
    await expect(page.getByTestId('practice-retained-case')).toContainText(
      request.identity.testCaseKey!,
    );
    await expect(page.getByRole('button', { name: '提交练习', exact: true })).toHaveCount(0);
    await expect(editor).toHaveCount(0);
    expect(
      await page.evaluate(
        () => window.__verticalObservation.workers.filter((w) => w.kind === 'execute').length,
      ),
    ).toBe(executions);
    expect((await readCoreArchive(page)).ledger).toEqual(before.ledger);
    await page.reload();
    await expect(
      page.getByText('还没有可复盘的运行。返回练习工作区完成真实提交后再查看。'),
    ).toBeVisible();
    await expect(page.getByTestId('trace-view')).toHaveCount(0);
    expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
    const after = await readCoreArchive(page);
    expect(after.progress).toEqual(before.progress);
    expect(after.ledger).toEqual(before.ledger);
    await info.attach('actual-last-judge-and-durable-after-review-refresh', {
      body: JSON.stringify({ request, result, before, after }),
      contentType: 'application/json',
    });
  });
}

test('an actual old app pass resets atomically to the new book once, with no BroadcastChannel or old-tab resurrection', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await context.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true });
  });
  const root = resolve('.artifacts/21.5/legacy-production');
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(test.info().project.use.baseURL as string).origin)
      return route.continue();
    const file = resolve(
      root,
      '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
    );
    if (!file.startsWith(root + sep) || !existsSync(file)) return route.abort();
    await route.fulfill({
      body: readFileSync(file),
      contentType: mime[extname(file)] ?? 'application/octet-stream',
    });
  });
  initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') });
  await confirmLegacy(page, 'lesson.c.variables-output');
  await legacyAnswer(page, 'exercise.c.echo');
  await legacySubmit(page);
  const old = await readCoreArchive(page);
  expect(old.progress.some((p) => p.eventType === 'lesson.completed')).toBe(true);
  expect(old.ledger.some((l) => (l.points ?? 0) > 0)).toBe(true);
  const current = await context.newPage();
  await current.goto('/#/');
  await expect(current.getByText('0 / 404 个小节已完成', { exact: true })).toBeVisible();
  await expect(current.getByRole('heading', { name: '已入账 0 分' })).toBeVisible();
  const reset = await readCoreArchive(current);
  expect(reset.meta.generation).not.toBe(old.meta.generation);
  expect(reset.meta.schemaVersion).toBe('10.0.0');
  expect(reset.progress).toEqual([]);
  expect(reset.ledger).toEqual([]);
  expect(reset.settings.theme).toBe(old.settings.theme);
  const initial = reset.meta.generation;
  await current.goto('/#/lessons/lesson.c6.s2.1');
  await current.getByRole('button', { name: '我已读完本节' }).click();
  await current.getByRole('link', { name: '完成配套执行练习' }).click();
  await current.getByLabel('完整 C 源码 · main.c').fill(exercise.referenceSource);
  await current.getByRole('button', { name: '判定全部四组' }).click();
  await expect(current.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  await current.reload();
  await expect(
    current.getByText('已保存首次通过记录。当前代码的运行和判题结果显示在下方。', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '提交练习', exact: true })
    .click({ force: true })
    .catch(() => undefined);
  const after = await readCoreArchive(current);
  expect(after.meta.generation).toBe(initial);
  expect(after.progress.every((p) => p.packageRef.id === 'content.c.primer6')).toBe(true);
  expect(after.progress.some((p) => p.eventType === 'lesson.completed')).toBe(true);
  await current.close();
});

test('advanced preparation uses the new book instead of an empty legacy reward group', async ({
  page,
}) => {
  await page.goto('/#/advanced/lesson.c.adjacent-order');
  await expect(page.getByTestId('c6-foundation')).toContainText('基础准备尚未完成');
  await expect(page.getByTestId('c6-foundation').getByRole('link')).toHaveCount(2);
  await page
    .getByTestId('c6-foundation')
    .getByRole('link', { name: /6\.3\.5/ })
    .click();
  await expect(page.getByRole('heading', { name: /6\.3\.5/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '我已读完本节' }).click();
  await page.goto('/#/advanced/lesson.c.adjacent-order');
  await expect(page.getByTestId('c6-foundation')).toContainText('基础准备尚未完成');
});
test('new C achievements require their actual new exercise and keep the three-badge budget', async ({
  page,
}) => {
  const arrayExercise = source.chapters
    .flatMap((c: { exercises: unknown[] }) => c.exercises)
    .find((e: { ref: { id: string } }) => e.ref.id === 'exercise.c6.s10.1.1');
  await page.goto('/#/achievements');
  await expect(page.getByTestId('achievement-total')).toHaveText('0 / 3');
  await expect(page.getByRole('link', { name: /10\.1\.1 初始化数组/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '冒泡排序通关', exact: true })).toHaveCount(0);
  await page.goto('/#/practice/exercise.c6.s10.1.1');
  await page.getByLabel('完整 C 源码 · main.c').fill(arrayExercise.referenceSource);
  await page.getByRole('button', { name: '判定全部四组' }).click();
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  await page.goto('/#/achievements');
  await expect(
    page.locator('[data-badge-id="badge.c6.array-initialization-pass"]'),
  ).toHaveAttribute('data-unlocked', 'true');
  await expect(page.getByTestId('achievement-total')).toHaveText('1 / 3');
  await page.reload();
  await expect(page.getByTestId('achievement-total')).toHaveText('1 / 3');
});

for (const q of independentC)
  test(`new generation retains independent C repair ${q.exerciseRef.id}`, async ({ page }) => {
    await page.goto(`/#/practice/${q.exerciseRef.id}`);
    const panel = page.getByTestId('practice-execution');
    const editor = page.getByRole('textbox', { name: '编辑 C 代码', exact: true });
    await expect(panel).toHaveAttribute('data-state', 'ready');
    await expect.poll(() => editor.inputValue()).toContain(q.brokenBody);
    const broken = await editor.inputValue();
    await editor.fill(broken.replace(q.brokenBody, q.solutionBody));
    await panel.getByRole('button', { name: '提交练习', exact: true }).click();
    await expect(panel).toHaveAttribute('data-state', 'passed');
    await expect(page.getByTestId('practice-pass-save')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.goto('/#/');
    await expect(page.getByText('0 / 404 个小节已完成', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '已入账 10 分' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '已入账 10 分' })).toBeVisible();
  });

for (const q of independentCpp)
  test(`new generation retains independent C++ repair ${q.exerciseRef.id}`, async ({ page }) => {
    await page.goto(`/#/bugs/memory/${q.exerciseRef.id}`);
    const editor = page.getByRole('textbox', { name: '编辑关卡 C++ 代码', exact: true });
    await expect(editor).toHaveValue(q.brokenSource);
    await editor.fill(q.solutionSource);
    await page.getByRole('button', { name: '提交全部4组', exact: true }).click();
    await expect(page.getByTestId('memory-bug-session')).toHaveAttribute('data-state', 'passed');
    await expect(page.getByTestId('memory-bug-session')).toHaveAttribute(
      'data-save-state',
      'saved',
    );
    await page.goto('/#/');
    await expect(page.getByText('0 / 404 个小节已完成', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '已入账 10 分' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '已入账 10 分' })).toBeVisible();
  });

test('independent repair mistakes remain linked to their own exercise and the new-book foundation', async ({
  page,
}) => {
  const q = independentC.find(
    (q: { exerciseRef: { id: string } }) => q.exerciseRef.id === 'exercise.c.bug-zero-branch',
  );
  await page.goto(`/#/practice/${q.exerciseRef.id}`);
  const panel = page.getByTestId('practice-execution');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await panel.getByRole('button', { name: '提交练习', exact: true }).click();
  await expect(panel).toHaveAttribute('data-state', 'unmet');
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  await page.goto('/#/notebook');
  await expect(page.getByRole('heading', { name: '错题记录 · 1 题' })).toBeVisible();
  await expect(page.getByRole('heading', { name: new RegExp(q.title) })).toBeVisible();
  await page.goto('/#/reviews');
  await expect(page.getByRole('link', { name: /复习：7\.1/ })).toBeVisible();
  await page.goto('/#/weaknesses');
  await expect(page.locator('[data-weakness-id="knowledge.c6.s7.1"]')).toContainText(
    '真实练习错误',
  );
});
const exercise = source.chapters
  .flatMap((c: { exercises: unknown[] }) => c.exercises)
  .find((e: { ref: { id: string } }) => e.ref.id === 'exercise.c6.s2.1');

test('normal directory and reading use the new book; A/B remain reference and full source is visible', async ({
  page,
}) => {
  await page.goto('/#/courses');
  await expect(page.getByRole('heading', { name: '课程目录', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '参考资料', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('14.3.1');
  await page
    .getByRole('link', { name: /14\.3\.1/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /14\.3\.1.*初始化结构/ }).first()).toBeVisible();
  await expect(page.locator('.c6-teaching-reading pre').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '我已读完本节' })).toBeEnabled();
  await expect(page.locator('.c6-teaching-reading')).not.toContainText(
    '修改已有成员，属于赋值，不是重新初始化',
  );
  await page.goto('/#/courses/c6.appB');
  await expect(page.getByText('课程内容已更新', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '我已读完本节' })).toHaveCount(0);
});
test('reading and an actual judged state remain usable at desktop, tablet and mobile widths', async ({
  page,
}, info) => {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/lessons/lesson.c6.s14.3.1');
    await expect(page.locator('.c6-teaching-reading pre').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: info.outputPath(`reading-${width}.jpg`),
      type: 'jpeg',
      quality: 85,
      fullPage: true,
    });
  }
  await page.goto('/#/practice/exercise.c6.s2.1');
  await page.getByLabel('完整 C 源码 · main.c').fill(exercise.referenceSource);
  await page.getByRole('button', { name: '判定全部四组' }).click();
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await expect(page.getByRole('button', { name: '判定全部四组' })).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`judged-${width}.jpg`),
      type: 'jpeg',
      quality: 85,
      fullPage: true,
    });
  }
});
test('two tabs without broadcast retain conflicting raw drafts and cannot save them after another tab clears', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true });
  });
  await page.goto('/#/practice/exercise.c6.s2.1');
  const editor = page.getByLabel('完整 C 源码 · main.c');
  await editor.fill('int main( { initial raw draft\n');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('完整草稿已保存在此浏览器。', { exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/#/practice/exercise.c6.s2.1');
  const otherEditor = other.getByLabel('完整 C 源码 · main.c');
  await expect(otherEditor).toHaveValue('int main( { initial raw draft\n');
  await editor.fill('int main( { first tab saved revision two\n');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('完整草稿已保存在此浏览器。', { exact: true })).toBeVisible();
  await otherEditor.fill('int main( { second tab raw text must survive conflict\n');
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByText(/S_REVISION_CONFLICT.*原稿已保留/)).toBeVisible();
  await expect(otherEditor).toHaveValue('int main( { second tab raw text must survive conflict\n');
  const before = await readCoreArchive(page);
  await page.goto('/#/settings?panel=data');
  await page.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await page.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect
    .poll(async () => (await readCoreArchive(page)).meta.generation)
    .not.toBe(before.meta.generation);
  await other.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(other.getByText(/S_GENERATION_STALE.*原稿已保留/)).toBeVisible();
  const after = await readCoreArchive(page);
  expect(after.progress).toEqual([]);
  expect(after.ledger).toEqual([]);
  await other.close();
});

test('normal app reads, actually judges four cases, saves an invalid draft and restores new progress after refresh', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c6.s2.1');
  await page.getByRole('button', { name: '我已读完本节' }).click();
  await expect(page.getByRole('button', { name: '已确认阅读' })).toBeDisabled();
  await page.getByRole('link', { name: '完成配套执行练习' }).click();
  await page.getByLabel('完整 C 源码 · main.c').fill(exercise.referenceSource);
  await page.getByRole('button', { name: '判定全部四组' }).click();
  await expect(page.getByRole('heading', { name: '四组全部通过' })).toBeVisible();
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '到本次末尾' }).click();
  await expect(page.getByLabel('当前游标标准输出')).not.toContainText('（暂无输出）');
  await page.getByRole('button', { name: '回到开始' }).click();
  await expect(page.getByLabel('当前游标标准输出')).toHaveText('（暂无输出）');
  await page.getByLabel('完整 C 源码 · main.c').fill('int main( { invalid saved draft\n');
  await expect(page.getByRole('heading', { name: '四组全部通过' })).toHaveCount(0);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page.getByText('完整草稿已保存在此浏览器。', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('完整 C 源码 · main.c')).toHaveValue(
    'int main( { invalid saved draft\n',
  );
  await expect(
    page.getByText('已保存首次通过记录。当前代码的运行和判题结果显示在下方。', { exact: true }),
  ).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByText('1 / 404 个小节已完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已入账 15 分' })).toBeVisible();
});

test('old lesson URLs have explicit new related reading or directory guidance', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c.first-program');
  await expect(page.getByRole('heading', { name: '课程内容已更新' })).toBeVisible();
  await expect(page.getByRole('link', { name: /阅读相关章节/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '打开课程目录' })).toBeVisible();
});

test('the preserved independent C case executes C, records only its own viewing reward and leaves new C lessons incomplete', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/#/visualize/case.c.assignment');
  const panel = page.getByTestId('case-execution');
  await expect(panel).toHaveAttribute('data-state', 'ready');
  await panel.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(panel.getByTestId('player-controls')).toHaveAttribute('data-cursor', '0');
  await expect(panel.getByRole('textbox', { name: '当前执行的 C 代码', exact: true })).toHaveValue(
    /main/u,
  );
  await panel.getByRole('combobox', { name: '播放速度' }).selectOption('4');
  await panel.getByTestId('trace-view').scrollIntoViewIfNeeded();
  await panel.getByRole('button', { name: '播放', exact: true }).click();
  await expect(panel.getByTestId('case-view-coverage')).toContainText('完整观看已就绪', {
    timeout: 15_000,
  });
  await panel.getByRole('button', { name: '确认已观看', exact: true }).click();
  await expect(
    panel.getByText('本次观看已保存；同一案例的首次奖励只入账一次。', { exact: true }),
  ).toBeVisible();
  await page.goto('/#/');
  await expect(page.getByText('0 / 404 个小节已完成', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '已入账 5 分' })).toBeVisible();
});

test('new knowledge marks and actual failed judges feed notebook, scheduled review and weakness evidence', async ({
  page,
}) => {
  await page.goto('/#/lessons/lesson.c6.s2.1');
  await page.getByRole('button', { name: '标记陌生', exact: true }).click();
  await expect(page.getByRole('button', { name: '已标陌生，改为熟悉' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('link', { name: '完成配套执行练习' }).click();
  await page.getByRole('button', { name: '判定全部四组' }).click();
  await expect(page.getByRole('heading', { name: '本次尚未通过' })).toBeVisible();
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  await page.goto('/#/notebook');
  await expect(page.getByRole('heading', { name: '错题记录 · 1 题' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '陌生知识 · 1 项' })).toBeVisible();
  await page.goto('/#/reviews');
  await expect(page.getByTestId('review-counts')).toContainText('到期 2');
  await expect(page.getByText(/复习：2\.1/)).toBeVisible();
  await page.goto('/#/weaknesses');
  await expect(page.locator('[data-weakness-id="knowledge.c6.s2.1"]')).toContainText('2.1');
  await expect(page.locator('[data-weakness-id="knowledge.c6.s2.1"]')).toContainText(
    '真实练习错误',
  );
  await page.goto('/#/');
  await expect(page.getByTestId('c6-knowledge-map')).toContainText('0 / 421 已点亮');
});

test('current C6 snapshots download actual typed state, complete source and the selected real judge input as JSON and PNG', async ({
  page,
}, testInfo) => {
  await page.goto('/#/practice/exercise.c6.s2.1');
  await page.getByLabel('完整 C 源码 · main.c').fill(exercise.referenceSource);
  await page.getByRole('button', { name: '判定全部四组' }).click();
  await expect(page.getByText('本次判题记录已保存。', { exact: true })).toBeVisible();
  for (let i = 0; i < 3; ++i)
    await page.getByRole('button', { name: '下一步', exact: true }).click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载状态文件（JSON）' }).click();
  const jsonFile = testInfo.outputPath('c6-current.json');
  await (await jsonDownload).saveAs(jsonFile);
  const snapshot = JSON.parse(readFileSync(jsonFile, 'utf8'));
  const validate = new Ajv2020({ strict: false, allErrors: true })
    .addFormat('uuid', isUuid)
    .addFormat('date-time', isUtcTime)
    .compile(JSON.parse(readFileSync('shared/contracts/21.5-C6当前快照2.0.0.schema.json', 'utf8')));
  expect(validate(snapshot), JSON.stringify(validate.errors)).toBe(true);
  expect(snapshot.formatVersion).toBe('2.0.0');
  expect(snapshot.runtime.domain).toBe('c6');
  expect(snapshot.position.cursor).toBe(3);
  expect(snapshot.input).toMatchObject({ kind: 'stdin-ascii', text: '-9', caseKey: 'case-1' });
  expect(snapshot.source.text).toBe(exercise.referenceSource);
  expect(snapshot.currentState.frames.length).toBeGreaterThan(0);
  const pngDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载快照图片（PNG）' }).click();
  const pngFile = testInfo.outputPath('c6-current.png');
  await (await pngDownload).saveAs(pngFile);
  const png = readFileSync(pngFile);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let embedded: typeof snapshot | null = null;
  for (let offset = 8; offset + 12 <= png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'iTXt') {
      const content = png.subarray(offset + 8, offset + 8 + size);
      const header = Buffer.from('c-viz.snapshot\0\0\0\0\0');
      if (content.subarray(0, header.length).equals(header))
        embedded = JSON.parse(content.subarray(header.length).toString('utf8'));
    }
    offset += size + 12;
  }
  expect(embedded?.formatVersion).toBe('2.0.0');
  expect(embedded?.source).toEqual(snapshot.source);
  expect(embedded?.currentState).toEqual(snapshot.currentState);
  await page.getByRole('button', { name: '加入本次笔记' }).click();
  await expect(page.getByText('当前快照已加入本次笔记。', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '查看学习笔记', exact: true }).click();
  await page.getByRole('checkbox', { name: '快照', exact: true }).check();
  await page.locator('[data-note-kind="snapshot"] input[type="checkbox"]').check();
  await page.getByRole('button', { name: '生成所选内容预览' }).click();
  await expect(page.getByRole('heading', { name: '捕获时的完整源码' })).toBeVisible();
  const capturedSource = page.getByLabel('笔记源码', { exact: true });
  await expect(capturedSource.locator('.note-code-line')).toHaveCount(
    snapshot.source.text.split('\n').length,
  );
  const capturedRange = snapshot.position.executedRange;
  await expect(capturedSource.locator('.note-code-highlight')).toHaveCount(
    capturedRange ? capturedRange.end.line - capturedRange.start.line + 1 : 0,
  );
  if (capturedRange) {
    expect(
      await capturedSource.locator('.note-code-highlight .note-line-number').allTextContents(),
    ).toEqual(
      Array.from({ length: capturedRange.end.line - capturedRange.start.line + 1 }, (_, i) =>
        String(capturedRange.start.line + i),
      ),
    );
  }
  await page.getByRole('button', { name: '预览完整状态图片', exact: true }).click();
  await expect(page.locator('.note-picture img')).toBeVisible();
  const archiveDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Markdown 压缩包' }).click();
  const archiveFile = testInfo.outputPath('c6-notes.zip');
  await (await archiveDownload).saveAs(archiveFile);
  const zip = readFileSync(archiveFile),
    files = new Map<string, Buffer>();
  for (let offset = 0; offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50;) {
    expect(zip.readUInt16LE(offset + 8)).toBe(0);
    const size = zip.readUInt32LE(offset + 18),
      nameLength = zip.readUInt16LE(offset + 26),
      extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.toString('utf8', offset + 30, offset + 30 + nameLength),
      start = offset + 30 + nameLength + extraLength;
    files.set(name, zip.subarray(start, start + size));
    offset = start + size;
  }
  expect([...files.keys()].sort()).toEqual(
    [
      'assets/snapshot-01.png',
      'notes.json',
      'snapshots/snapshot-01.json',
      '笔记.md',
      '说明.txt',
    ].sort(),
  );
  const metadata = JSON.parse(files.get('notes.json')!.toString('utf8'));
  expect(metadata.formatVersion).toBe('2.0.0');
  expect(metadata.entries).toHaveLength(1);
  expect(metadata.entries[0].snapshot.source.text).toBe(exercise.referenceSource);
  expect(metadata.entries[0].snapshot.currentState).toEqual(snapshot.currentState);
  expect(metadata).not.toHaveProperty('lease');
  expect(files.get('笔记.md')!.toString('utf8')).toContain('assets/snapshot-01.png');
});
