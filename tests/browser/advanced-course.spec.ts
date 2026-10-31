import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { observeCaseSetExecution } from './case-set-observation';
import { waitForPhase2Archive } from './phase2-ready';
import {
  decodeAlgorithmResult,
  type AlgorithmRequest,
} from '../../web/src/engine/algorithm-protocol';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
const course = JSON.parse(readFileSync('content/advanced/course-1.0.0.json', 'utf8')) as {
  lessons: { lessonRef: { id: string }; caseRef: { id: string }; title: string }[];
};
const ready = async (page: Page, path = '/advanced') => {
  await page.goto(`/#${path}`);
  await waitForPhase2Archive(page);
  await expect(page.getByTestId('advanced-course')).toBeVisible();
};
test('directory, honest completion boundary and unknown routes', async ({ page }) => {
  await ready(page);
  await expect(page.locator('[data-advanced-chapter]')).toHaveCount(2);
  await expect(page.locator('.advanced-chapters .advanced-lesson-list li')).toHaveCount(4);
  await expect(page.locator('.advanced-rule')).toContainText('不计完成或积分');
  await expect(page.locator('.advanced-next')).toContainText('逐项开放');
  await page.goto('/#/advanced/lesson.c.fake');
  await expect(page.getByRole('heading', { name: '找不到这个进阶小节' })).toBeVisible();
  await page.getByRole('link', { name: '返回进阶课程', exact: true }).click();
  await expect(page.locator('.advanced-chapters .advanced-lesson-list li')).toHaveCount(4);
});
for (const entry of course.lessons)
  test(`real C++ source and reversible trace: ${entry.caseRef.id}`, async ({ page }, info) => {
    await observeCaseSetExecution(page);
    await ready(page, `/advanced/${entry.lessonRef.id}`);
    await expect(page.getByRole('heading', { name: '复杂度为何如此', exact: true })).toBeVisible();
    await page.locator('summary').click();
    const source = await page.getByLabel('进阶案例C++源码').textContent();
    await page.locator('a.button', { hasText: '可视化' }).click();
    const workspace = page.getByTestId('sort-workspace');
    await expect(workspace).toHaveAttribute('data-state', 'idle');
    await page.getByRole('button', { name: '运行C++案例', exact: true }).click();
    await expect(workspace).toHaveAttribute('data-state', 'ready');
    const raw = await page.evaluate(() => {
      const worker = window.__verticalObservation.workers.findLast(
        (item) => item.moduleSeen && item.responseOk,
      )!;
      return {
        moduleSeen: worker.moduleSeen,
        ...(
          worker as unknown as {
            captureEncoded(): { requestBase64: string; responseBase64: string };
          }
        ).captureEncoded(),
      };
    });
    expect(raw.moduleSeen).toBe(true);
    const request = JSON.parse(
      Buffer.from(raw.requestBase64, 'base64').toString(),
    ) as AlgorithmRequest;
    expect(request.source).toBe(source);
    const result = await decodeAlgorithmResult(
      Uint8Array.from(Buffer.from(raw.responseBase64, 'base64')).buffer,
      request,
      engineBuild.wasmSha256,
    );
    expect(result.terminal.status).toBe('completed');
    await info.attach('real-cpp-packet', {
      body: Buffer.from(JSON.stringify(raw)),
      contentType: 'application/json',
    });
    await page.getByRole('button', { name: '前进', exact: true }).click();
    expect(Number(await workspace.getAttribute('data-cursor'))).toBeGreaterThan(0);
    await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect(workspace).toHaveAttribute('data-cursor', '0');
    await page.getByRole('button', { name: '查看末步', exact: true }).click();
    await expect(page.getByTestId('sort-terminal')).toContainText('正常');
    await page.getByTestId('sort-input').fill('[]');
    await expect(workspace).toHaveAttribute('data-state', 'idle');
    await page.getByRole('button', { name: '运行C++案例', exact: true }).click();
    await expect(workspace).toHaveAttribute('data-state', 'ready');
  });
test('missing course bundle is honest and recoverable', async ({ page }) => {
  const bundle = /\/content\/(?:course|review)\//;
  await page.route(bundle, (route) =>
    route.fulfill({ status: 404, body: 'Explicit QA content fault' }),
  );
  await page.goto('/#/advanced');
  await expect(page.getByTestId('course-fallback')).toBeVisible();
  await expect(page.locator('.advanced-chapters .advanced-lesson-list a')).toHaveCount(0);
  await expect(page.getByTestId('advanced-chapter-progress').first()).toContainText('不可确认');
  await page.unroute(bundle);
  await page.getByRole('button', { name: '重试扩充课程', exact: true }).click();
  await expect(page.locator('.advanced-chapters .advanced-lesson-list a')).toHaveCount(4);
});
for (const width of [1440, 768, 390])
  test(`course layout and keyboard entry at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`directory-${width}.png`), fullPage: true });
    await page.locator('.advanced-chapters .advanced-lesson-list a').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '基础准备清单', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`lesson-${width}.png`), fullPage: true });
  });
