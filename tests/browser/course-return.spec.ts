import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const bookLesson = (folder: string) => {
  const manifest = JSON.parse(
    readFileSync(`content/${folder}/course/manifest-1.0.0.json`, 'utf8'),
  ) as { catalog: { id: string; leaf: boolean }[] };
  return manifest.catalog.find((node) => node.leaf)!.id;
};

for (const [language, path, article] of [
  ['Java', '/java', '/java/article/2/java.lesson.6b7b5f950b05e17d1042'],
  ['Python', '/python', '/python/article/2'],
] as const) {
  test(`${language} returns from reading to the complete course directory`, async ({ page }) => {
    await page.goto('/#' + article);
    const back = page.getByRole('link', { name: `← 返回 ${language} 课程目录`, exact: true });
    await expect(back).toBeVisible();
    await expect(back).not.toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: '来源文章', exact: true })).toHaveCount(0);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`#${path}$`));
    await expect(page.getByRole('searchbox', { name: '搜索目录' })).toBeVisible();
    await expect(page.getByRole('link', { name: `${language} 目录`, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
}

for (const [language, folder, path] of [
  ['C++', 'cpp', '/cpp'],
  ['Rust', 'rust2018', '/rust'],
  ['MySQL', 'mysql', '/mysql'],
] as const) {
  test(`${language} returns from a book lesson using the footer button`, async ({ page }) => {
    await page.goto('/#' + path + '/lesson/' + bookLesson(folder));
    const footer = page.getByRole('navigation', { name: '返回课程', exact: true });
    await expect(footer).toBeVisible();
    await footer.getByRole('link', { name: '← 返回课程目录', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${path}$`));
    await expect(page.getByRole('searchbox', { name: '搜索目录' })).toBeVisible();
  });
}

test('C lessons provide explicit return buttons at both ends', async ({ page }) => {
  await page.goto('/#/lessons/lesson.c6.s1.1');
  const buttons = page.getByRole('link', { name: '← 返回课程目录', exact: true });
  await expect(buttons).toHaveCount(2);
  await buttons.last().click();
  await expect(page).toHaveURL(/#\/courses$/);
});

test('the Java return button remains readable and usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/java/article/2/java.lesson.6b7b5f950b05e17d1042');
  const back = page.getByRole('link', { name: '← 返回 Java 课程目录', exact: true });
  await expect(back).toBeVisible();
  const bounds = await back.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  await back.click();
  await expect(page.getByRole('searchbox', { name: '搜索目录' })).toBeVisible();
});

test('reading navigation fits desktop, tablet and phone widths', async ({ page }, testInfo) => {
  for (const width of [1440, 810, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/java/article/2/java.lesson.6b7b5f950b05e17d1042');
    await expect(page.getByRole('heading', { name: '主要特性', exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`reading-${width}.png`), fullPage: true });
  }
});
