import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Marked } from 'marked';
import { expect, test } from '@playwright/test';

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const release = read(
  'content/build/' + read('content/build/book-teaching-current.json').releaseFile,
);
const markdown = new Marked();

for (const language of ['c', 'cpp', 'rust2018', 'mysql']) {
  test(`${language} teaching figure loads locally and can be enlarged on three screen sizes`, async ({
    page,
    request,
  }) => {
    let selected: { id: string; href: string; alt: string } | undefined;
    for (const entry of release.chunks.filter(
      (row: { language: string }) => row.language === language,
    )) {
      for (const node of read('content/teaching/' + entry.file).nodes) {
        markdown.walkTokens(markdown.lexer(node.body.join('\n\n')), (token) => {
          if (token.type === 'image') {
            selected ??= { id: node.id, href: token.href, alt: token.text };
          }
        });
      }
    }
    expect(selected).toBeDefined();
    if (!selected) throw new Error('No published teaching figure for ' + language);
    const figure = selected;
    expect(figure.href).toMatch(/^content\/[a-z0-9]+\/media\/[a-z0-9-]+\.svg$/u);
    const response = await request.get('/' + figure.href);
    expect(response.ok()).toBe(true);
    const expectedHash = createHash('sha256').update(readFileSync(figure.href)).digest('hex');
    expect(
      createHash('sha256')
        .update(await response.body())
        .digest('hex'),
    ).toBe(expectedHash);

    let route = `/${language === 'rust2018' ? 'rust' : language}/lesson/${figure.id}`;
    if (language === 'c') {
      const lesson = read('content/c/primer6-learning/index-1.0.0.json').lessons.find(
        (row: string[]) => row[1] === 'node.' + figure.id,
      );
      route = lesson ? '/lessons/' + lesson[0] : '/courses/' + figure.id;
    }
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    for (const width of [1440, 810, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#' + route);
      const body = page.locator('.c6-teaching-reading').first();
      const inline = body.getByRole('img', { name: figure.alt, exact: true });
      await inline.scrollIntoViewIfNeeded();
      await expect(inline).toBeVisible();
      await expect
        .poll(() => inline.evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      await body.getByRole('button', { name: '放大图解', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: figure.alt, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('img', { name: figure.alt, exact: true })).toBeVisible();
      const region = dialog.getByRole('region', { name: '放大图解，可横向滚动', exact: true });
      await expect(region).toBeVisible();
      if (width === 1440) {
        expect(await region.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
      }
      if (width === 390) {
        expect(await region.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
          true,
        );
        await region.evaluate((element) => {
          element.scrollLeft = 120;
        });
        expect(await region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
      } else {
        await dialog.getByRole('button', { name: '关闭图解', exact: true }).click();
      }
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const returnLinks = page
        .getByRole('navigation', { name: '返回课程', exact: true })
        .getByRole('link', { name: /返回课程目录/ });
      await returnLinks.last().scrollIntoViewIfNeeded();
      await expect(returnLinks.last()).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
