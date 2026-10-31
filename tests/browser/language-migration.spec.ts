import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { waitForPhase2Archive } from './phase2-ready';
import { native } from './scheduler-helpers';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
const content = JSON.parse(
  readFileSync('content/advanced/language-migration-1.0.0.json', 'utf8'),
) as {
  languages: { id: string; label: string; bridge: string; defaultTarget: string }[];
  topics: {
    id: string;
    title: string;
    lessonRef: { id: string };
    snippets: Record<
      string,
      {
        context: string;
        code: string;
        steps: { label: string; lines: number[]; explanation: string }[];
      }
    >;
  }[];
};
const root = (page: Page) => page.getByTestId('language-migration');
async function open(page: Page) {
  await page.goto('/#/advanced/migration');
  await waitForPhase2Archive(page);
  await expect(root(page)).toHaveAttribute('data-cursor', '0');
  await expect(root(page)).toHaveAttribute('data-playing', 'false');
}
async function next(page: Page) {
  await page.getByRole('button', { name: '下一步标注', exact: true }).click();
}
for (const topic of content.topics)
  for (const language of content.languages)
    test(`static reading ${topic.id}/${language.id}: exact code, context and three authored annotations`, async ({
      page,
    }, info) => {
      await open(page);
      await page.getByRole('combobox', { name: '已有语言', exact: true }).selectOption(language.id);
      await page.getByRole('combobox', { name: '阅读主题', exact: true }).selectOption(topic.id);
      await expect(root(page)).toHaveAttribute('data-target', language.defaultTarget);
      await expect(page.getByTestId('migration-bridge')).toHaveText(language.bridge);
      for (const id of [language.id, language.defaultTarget]) {
        const pane = page.locator(`[data-testid="migration-snippet"][data-language="${id}"]`);
        await expect(pane.locator('pre')).toHaveText(topic.snippets[id].code);
        await expect(pane).toContainText(topic.snippets[id].context);
        await expect(pane.locator('mark')).toHaveCount(0);
      }
      for (let cursor = 1; cursor <= 3; cursor++) {
        await next(page);
        await expect(root(page)).toHaveAttribute('data-cursor', String(cursor));
        for (const id of [language.id, language.defaultTarget]) {
          const pane = page.locator(`[data-testid="migration-snippet"][data-language="${id}"]`),
            expected = topic.snippets[id].steps[cursor - 1];
          expect(
            await pane
              .locator('[data-highlighted="true"]')
              .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('data-line')))),
          ).toEqual(expected.lines);
          await expect(pane.getByTestId('migration-annotation')).toContainText(
            expected.explanation,
          );
        }
      }
      await expect(page.getByRole('button', { name: '下一步标注', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '上一步标注', exact: true }).click();
      await expect(root(page)).toHaveAttribute('data-cursor', '2');
      await page.getByRole('button', { name: '重置标注', exact: true }).click();
      await expect(root(page)).toHaveAttribute('data-cursor', '0');
      await expect(root(page).locator('mark')).toHaveCount(0);
      await info.attach('static-annotation-contract', {
        body: JSON.stringify({
          topic: topic.id,
          known: language.id,
          target: language.defaultTarget,
          phases: 3,
          provenance: 'authored reading annotations; no code execution',
        }),
        contentType: 'application/json',
      });
    });
test('all twelve ordered pairs change content and the known-language choice preserves the fixed learning order', async ({
  page,
}) => {
  await open(page);
  for (const known of content.languages) {
    await page.getByRole('combobox', { name: '已有语言', exact: true }).selectOption(known.id);
    await expect(page.locator('.migration-order ol li')).toHaveText(
      content.languages.map((l) => l.label + (l.id === known.id ? ' · 你选择的基础' : '')),
    );
    for (const target of content.languages.filter((l) => l.id !== known.id)) {
      await page.getByRole('combobox', { name: '对照语言', exact: true }).selectOption(target.id);
      await expect(root(page)).toHaveAttribute('data-target', target.id);
      await expect(page.locator(`[data-language="${target.id}"] pre`)).toHaveText(
        content.topics[0].snippets[target.id].code,
      );
      await expect(root(page)).toHaveAttribute('data-cursor', '0');
    }
  }
});
test('controlled browser clock: play pause replay and every selection revoke the preceding annotation timer', async ({
  page,
}) => {
  await page.clock.install();
  await open(page);
  const play = () => page.getByRole('button', { name: '播放教学标注', exact: true }).click();
  await play();
  await page.clock.runFor(1201);
  await expect(root(page)).toHaveAttribute('data-cursor', '1');
  await page.getByRole('button', { name: '暂停标注', exact: true }).click();
  await page.clock.runFor(5000);
  await expect(root(page)).toHaveAttribute('data-cursor', '1');
  for (const [name, value] of [
    ['已有语言', 'java'],
    ['对照语言', 'python'],
    ['阅读主题', 'arrays'],
  ]) {
    await play();
    await page.getByRole('combobox', { name, exact: true }).selectOption(value);
    await page.clock.runFor(5000);
    await expect(root(page)).toHaveAttribute('data-cursor', '0');
    await expect(root(page)).toHaveAttribute('data-playing', 'false');
  }
  await play();
  await next(page);
  await expect(root(page)).toHaveAttribute('data-playing', 'false');
  await page.clock.runFor(3000);
  await expect(root(page)).toHaveAttribute('data-cursor', '1');
  await play();
  await page.clock.runFor(2401);
  await expect(root(page)).toHaveAttribute('data-cursor', '3');
  await expect(root(page)).toHaveAttribute('data-playing', 'false');
  await play();
  await expect(root(page)).toHaveAttribute('data-cursor', '0');
  await page.getByRole('button', { name: '重置标注', exact: true }).click();
});
test('controlled visibility event pauses; leaving and returning cannot restore an old teaching timer', async ({
  page,
}) => {
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: '播放教学标注', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(5000);
  await expect(root(page)).toHaveAttribute('data-playing', 'false');
  await expect(root(page)).toHaveAttribute('data-cursor', '0');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  await page.getByRole('button', { name: '播放教学标注', exact: true }).click();
  await page.getByRole('link', { name: '返回进阶课程', exact: true }).click();
  await page.clock.runFor(5000);
  await page
    .getByRole('link', { name: '语言迁移与语法对照：从已有语言读懂C++', exact: true })
    .click();
  await expect(root(page)).toHaveAttribute('data-known', 'c');
  await expect(root(page)).toHaveAttribute('data-cursor', '0');
  await expect(root(page)).toHaveAttribute('data-playing', 'false');
});
test('bundled static reading works offline, creates no Worker or learning facts and refreshes to defaults', async ({
  page,
  context,
}, info) => {
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await open(page);
  const before = await native(page);
  await context.setOffline(true);
  await page.getByRole('combobox', { name: '已有语言', exact: true }).selectOption('java');
  for (const topic of content.topics) {
    await page.getByRole('combobox', { name: '阅读主题', exact: true }).selectOption(topic.id);
    await next(page);
  }
  const after = await native(page);
  for (const key of ['progress', 'receipts', 'ledger', 'dailyFacts', 'goals', 'aliases'] as const)
    expect(after[key]).toEqual(before[key]);
  expect(workers).toEqual([]);
  expect(JSON.stringify(after)).not.toContain('MigrationExample');
  await info.attach('static-only-no-learning-side-effects', {
    body: JSON.stringify({ workers, before, after, offlineAfterInitialBundleLoad: true }),
    contentType: 'application/json',
  });
  await context.setOffline(false);
  await page.reload();
  await expect(root(page)).toHaveAttribute('data-known', 'c');
  await expect(root(page)).toHaveAttribute('data-topic', 'integers');
  await expect(root(page)).toHaveAttribute('data-cursor', '0');
  await expect(root(page)).toHaveAttribute('data-playing', 'false');
});
test('course entries, exact original preparation and existing real C/C++ destinations remain usable', async ({
  page,
}) => {
  for (const url of ['/#/advanced', '/#/courses']) {
    await page.goto(url);
    await waitForPhase2Archive(page);
    await page.getByRole('link', { name: /语言迁移与语法对照/ }).click();
    await expect(root(page)).toBeVisible();
  }
  await page.getByRole('combobox', { name: '阅读主题', exact: true }).selectOption('arrays');
  const original = page.getByRole('link', { name: '回到原C小节：一维数组', exact: true });
  if (p05CourseRelease.registered) {
    await expect(original).toBeVisible();
    await expect(original).toHaveAttribute('href', '#/lessons/lesson.c.array-update');
  }
  for (const [name, path] of [
    ['C循环真实观察', '/visualize/case.c.loops'],
    ['C++插入排序真实观察', '/algorithms/case.cpp.insertion-sort'],
    ['C++ KMP真实观察', '/advanced/algorithms/case.cpp.kmp'],
  ]) {
    await page.getByRole('link', { name, exact: true }).click();
    expect(page.url()).toContain('#' + path);
    await page.goBack();
    await expect(root(page)).toBeVisible();
  }
  await expect(page.getByRole('link', { name: '今日复习', exact: true }).last()).toHaveAttribute(
    'href',
    '#/reviews',
  );
});
test('missing expanded course never impersonates preparation while bundled static teaching remains available', async ({
  page,
}) => {
  const bundle = /\/content\/(?:course|review)\//;
  await page.route(bundle, (route) => route.fulfill({ status: 404, body: 'QA content fault' }));
  await page.goto('/#/advanced/migration');
  await expect(root(page).getByText(/基础课程版本暂不可用/)).toBeVisible();
  await expect(root(page).getByRole('link', { name: /回到原C小节/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: '阅读主题', exact: true }).selectOption('strings');
  await next(page);
  await expect(root(page).locator('mark')).not.toHaveCount(0);
  await page.unroute(bundle);
  await page.reload();
  await waitForPhase2Archive(page);
  if (p05CourseRelease.registered)
    await expect(root(page).getByRole('link', { name: /回到原C小节/ })).toBeVisible();
});
for (const width of [1440, 768, 390])
  test(`static comparison layout and keyboard ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.getByRole('combobox', { name: '已有语言', exact: true }).selectOption('java');
    await page.getByRole('combobox', { name: '阅读主题', exact: true }).selectOption('functions');
    await page.getByRole('button', { name: '下一步标注', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(root(page)).toHaveAttribute('data-cursor', '1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('migration-' + width + '.png'), fullPage: true });
  });
