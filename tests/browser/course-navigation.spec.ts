import { expect, test } from '@playwright/test';

const courses = [
  { language: 'Python', path: '/python', heading: 'Python 3 课程' },
  { language: 'Java', path: '/java', heading: 'Java 课程' },
  { language: 'C++', path: '/cpp', heading: 'C++ 课程' },
  { language: 'Rust', path: '/rust', heading: 'Rust 课程' },
  { language: 'MySQL', path: '/mysql', heading: 'MySQL 课程' },
] as const;

for (const course of courses) {
  test(`${course.language} catalog continues to the next unread lesson after a saved reading`, async ({
    page,
  }) => {
    await page.goto('/#' + course.path);
    await expect(
      page.getByRole('heading', { level: 1, name: course.heading, exact: true }),
    ).toBeVisible();
    const nav = page.getByRole('navigation', { name: course.language + ' 学习', exact: true });
    await expect(nav.getByRole('link')).toHaveCount(3);
    await expect(nav.getByRole('link').nth(1)).toHaveAttribute(
      'href',
      '#' + course.path + '/workbench',
    );
    await expect(nav.getByRole('link').nth(2)).toHaveAttribute(
      'href',
      '#' + course.path + '/review',
    );
    const next = page.getByRole('region', { name: '推荐下一步', exact: true });
    const first = next.getByRole('heading').getByRole('link');
    const firstPath = await first.getAttribute('href');
    const firstTitle = await first.innerText();
    await first.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(firstTitle);
    await expect(page.getByTestId('reading-end')).toBeAttached();
    await page.bringToFront();
    await expect(async () => {
      await page.keyboard.press('End');
      await expect(page.getByTestId('reading-end')).toHaveAttribute('data-read-today', 'true', {
        timeout: 800,
      });
    }).toPass({ timeout: 8000 });
    await nav.getByRole('link', { name: course.language + ' 目录', exact: true }).click();
    await expect(next.getByRole('heading').getByRole('link')).not.toHaveAttribute(
      'href',
      firstPath!,
    );
    await expect(next.getByRole('link', { name: '继续阅读', exact: true })).toBeVisible();
    await expect(page.locator('.course-progress')).toContainText('已读 1 /');
    const search = page.getByRole('searchbox', { name: '搜索目录', exact: true });
    await search.fill(firstTitle);
    const catalog = page.getByRole('region', { name: '教材目录', exact: true });
    await expect(catalog.locator(`a[href="${firstPath}"]`).first()).toBeVisible();
    await expect(catalog.locator('.course-mode .course-read').first()).toHaveText('已读');
    await search.fill('不存在的课程目录关键词-zxq');
    await expect(catalog.getByRole('status')).toHaveText('没有匹配的小节。');
  });
}

test('the shared notebook exposes a review destination for every other language', async ({
  page,
}) => {
  await page.goto('/#/notebook');
  const nav = page.getByRole('navigation', { name: '语言复盘', exact: true });
  await expect(nav.getByRole('link')).toHaveCount(5);
  for (const course of courses) {
    await expect(
      nav.getByRole('link', { name: '查看 ' + course.language + ' 复盘', exact: true }),
    ).toHaveAttribute('href', '#' + course.path + '/review');
  }
  await nav.getByRole('link', { name: '查看 C++ 复盘', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'C++ 判题复盘', exact: true }),
  ).toBeVisible();
});
