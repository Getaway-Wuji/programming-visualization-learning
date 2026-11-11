import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Marked } from 'marked';
import type { Tokens } from 'marked';
import { expect, test } from '@playwright/test';

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const release = read(
  'content/build/' + read('content/build/book-teaching-current.json').releaseFile,
);
const markdown = new Marked();
const path = (language: string, id: string) => {
  if (language === 'c') {
    const index = read('content/c/primer6-learning/index-1.0.0.json');
    const lesson = index.lessons.find((row: string[]) => row[1] === 'node.' + id);
    return lesson ? '/lessons/' + lesson[0] : '/courses/' + id;
  }
  return `/${language === 'rust2018' ? 'rust' : language}/lesson/${id}`;
};

for (const language of ['c', 'cpp', 'rust2018', 'mysql']) {
  test(`${language} detailed teaching keeps complete source, tables and directory access`, async ({
    page,
    request,
  }) => {
    const entries = release.chunks.filter(
      (entry: { language: string }) => entry.language === language,
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const response = await request.get('/content/teaching/' + entry.file);
      expect(response.ok()).toBe(true);
      const bytes = await response.body();
      expect(bytes.length).toBe(entry.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    }
    const entry = entries[0];
    const chunk = read('content/teaching/' + entry.file);
    const candidates = chunk.nodes
      .map((node: { id: string; title: string; body: string[] }) => {
        const tokens = markdown.lexer(node.body.join('\n\n'));
        return {
          node,
          score:
            tokens.filter((token) => token.type === 'table').length * 30 +
            tokens.filter((token) => token.type === 'code').length,
        };
      })
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score);
    const node = candidates[0].node;
    const codes = markdown
      .lexer(node.body.join('\n\n'))
      .filter((token): token is Tokens.Code => token.type === 'code')
      .map((token) => {
        const fenced = /^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^ {0,3}\1[ \t]*(?:\n|$)/mu.exec(
          token.raw,
        );
        return fenced ? fenced[2] : token.text;
      });
    for (const width of [1440, 810, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#' + path(language, node.id));
      await expect(page.locator('h1').last()).toContainText(node.title);
      const body = page.locator('.c6-teaching-reading').first();
      await expect(body).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      expect(await body.locator('pre code').allTextContents()).toEqual(codes);
      expect(
        await body
          .locator('p')
          .first()
          .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
      ).toBeGreaterThanOrEqual(16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const returnLinks = page
        .getByRole('navigation', { name: '返回课程', exact: true })
        .getByRole('link', { name: /返回课程目录/ });
      await expect(returnLinks.first()).toBeVisible();
      await expect(returnLinks.last()).toBeVisible();
      await (width === 810 ? returnLinks.last() : returnLinks.first()).click();
      await expect(page).toHaveURL(
        new RegExp(
          '/#' +
            (language === 'c' ? '/courses' : '/' + (language === 'rust2018' ? 'rust' : language)) +
            '$',
        ),
      );
    }
  });
}

test('a corrupt teaching revision blocks the lesson and a clean retry restores it', async ({
  page,
}) => {
  const entries = release.chunks.filter((row: { language: string }) => row.language === 'cpp');
  const entry = entries.find((row: { baselineFile: string }) =>
    read(row.baselineFile).nodes.some((node: { leaf: boolean }) => node.leaf),
  );
  expect(entry).toBeTruthy();
  const leafId = read(entry.baselineFile).nodes.find((node: { leaf: boolean }) => node.leaf).id;
  const node = read('content/teaching/' + entry.file).nodes.find(
    (row: { id: string }) => row.id === leafId,
  );
  await page.route('**/content/teaching/' + entry.file, (route) =>
    route.fulfill({ status: 200, body: '{}' }),
  );
  await page.goto('/#' + path('cpp', node.id));
  await expect(page.getByRole('alert')).toContainText('暂时无法读取');
  await expect(page.locator('.c6-teaching-reading')).toHaveCount(0);
  await expect(page.getByTestId('reading-end')).toHaveCount(0);
  await page.unroute('**/content/teaching/' + entry.file);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('h1').last()).toContainText(node.title);
  await expect(page.locator('.c6-teaching-reading')).toBeVisible();
  await expect(page.getByTestId('reading-end')).toBeAttached();
});
