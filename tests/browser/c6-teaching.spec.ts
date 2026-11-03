import { expect, test } from '@playwright/test';
import type {} from './c6-teaching-harness-types';

test.beforeEach(async ({ page }) => {
  await page.goto('/c6-teaching-harness.html');
  await page.waitForFunction(() => Boolean(window.c6Teaching));
  await expect(page.locator('article h1')).toHaveText('14.3.1 初始化结构');
});

test('all 650 source nodes render every fenced line and preserve literal titles at phone width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const result = await page.evaluate(async () => {
    const repo = window.c6Teaching.repository;
    const manifest = await repo.loadManifest();
    const failures: string[] = [];
    let nodes = 0,
      fences = 0,
      programs = 0,
      tables = 0;
    for (const entry of manifest.chunks) {
      const chunk = await repo.loadChunk(entry.id);
      const byId = new Map(chunk.programs.map((p) => [p.ref.id, p]));
      for (const node of chunk.nodes) {
        window.c6Teaching.render(node.body);
        const expected = [...node.body.matchAll(/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm)];
        const actual = [...document.querySelectorAll('article pre code')];
        if (expected.length !== actual.length) failures.push(`${node.sourceNodeId}: fence count`);
        for (let i = 0; i < expected.length; ++i) {
          if (actual[i]?.textContent !== expected[i][2])
            failures.push(`${node.sourceNodeId}: fence ${i}`);
        }
        for (const ref of node.programRefs) {
          const program = byId.get(ref.id)!;
          for (const file of program.files)
            if (
              !actual.some(
                (code) =>
                  code.getAttribute('data-language') === 'c' &&
                  code.textContent?.trimEnd() === file.source.trimEnd(),
              )
            )
              failures.push(`${node.sourceNodeId}: missing ${ref.id}/${file.name}`);
          ++programs;
        }
        const title = node.body
          .split('\n')[0]
          .slice(2)
          .replace(/\\([\\`*_{}[\]<>])/gu, '$1');
        if (document.querySelector('article h1')?.textContent !== title)
          failures.push(`${node.sourceNodeId}: title`);
        if (document.documentElement.scrollWidth > 391)
          failures.push(`${node.sourceNodeId}: page overflow`);
        if (document.querySelector('article script, article iframe, article img'))
          failures.push(`${node.sourceNodeId}: active HTML`);
        fences += expected.length;
        tables += document.querySelectorAll('article table').length;
        ++nodes;
      }
    }
    return {
      failures,
      nodes,
      fences,
      programs,
      tables,
      loaded: repo.getSnapshot().loadedChunkIds.length,
      localKeys: Object.keys(localStorage),
      databases: await indexedDB.databases(),
    };
  });
  expect(result.failures).toEqual([]);
  expect(result.nodes).toBe(650);
  expect(result.programs).toBe(576);
  expect(result.fences).toBeGreaterThan(576);
  expect(result.tables).toBeGreaterThan(0);
  expect(result.loaded).toBe(19);
  expect(result.localKeys).toEqual([]);
  expect(result.databases).toEqual([]);
});

test('references request only their own block; aborted HTTP cannot restore reset data', async ({
  page,
}) => {
  const requested: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/content/c/primer6-teaching/'))
      requested.push(request.url().split('/').at(-1)!);
  });
  await page.evaluate(async () => {
    const repo = window.c6Teaching.repository;
    repo.reset();
    const node = await repo.loadNode('c6.sB.2.1');
    window.c6Teaching.render(node.body);
  });
  expect(requested).toEqual(['manifest-2.0.0.json', 'chB-2.0.0.json']);
  await expect(page.locator('article h1')).toHaveText('B.2.1 算术运算符');
  await page.route('**/ch17-2.0.0.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.continue().catch(() => undefined);
  });
  const reset = await page.evaluate(async () => {
    const repo = window.c6Teaching.repository;
    const pending = repo.loadChunk('ch17').then(
      () => 'unexpected',
      (error: { code: string }) => error.code,
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    repo.reset();
    return {
      code: await pending,
      loaded: repo.getSnapshot().loadedChunkIds,
      manifest: repo.getSnapshot().manifest,
    };
  });
  expect(reset).toEqual({ code: 'C6_TEACHING_CANCELLED', loaded: [], manifest: null });
});

test('literal C operators, output newlines and HTML remain text; tables scroll inside the body', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    window.c6Teaching.render(
      '# 字面内容\n\n`__VA_ARGS__` 与 `a | b`\n\n| 表达式 | 结果 |\n| --- | --- |\n| `a \\| b` | 3 |\n\n```c\n#include <stdio.h>\nint main(void) { puts("<b> & \\"ok\\""); return 0; }\n\n```\n\n```text\nfirst\nsecond\n```\n\n<script>window.renderWasExecuted=true</script>\n\n[x](javascript:alert(1))\n',
    ),
  );
  await expect(page.locator('article td').first()).toHaveText('a | b');
  await expect(page.locator('article script')).toHaveCount(0);
  await expect(page.locator('article a')).toHaveCount(0);
  expect(await page.locator('article pre').last().textContent()).toBe('first\nsecond\n');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const scrolling = await page.locator('.c6-reading-table').evaluate((element) => {
    element.scrollLeft = 50;
    return { left: element.scrollLeft, wider: element.scrollWidth > element.clientWidth };
  });
  expect(scrolling).toEqual({ left: 50, wider: true });
});
