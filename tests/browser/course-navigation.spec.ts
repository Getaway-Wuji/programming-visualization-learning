import { expect, test, type Locator } from '@playwright/test';

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

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
    await nav
      .getByRole('link', { name: '← 返回 ' + course.language + ' 课程目录', exact: true })
      .click();
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

async function measureCenteredContent(main: Locator, heading: string, selector: string) {
  await expect(main.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
  const geometry = await main.locator(selector).evaluate((element) => {
    const content = element.getBoundingClientRect();
    const lane = element.closest('main')!.getBoundingClientRect();
    return {
      left: content.left,
      width: content.width,
      centerOffset: Math.abs((content.left + content.right - lane.left - lane.right) / 2),
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(geometry.centerOffset, `${heading} is centered`).toBeLessThanOrEqual(1);
  expect(geometry.horizontalOverflow, `${heading} fits`).toBe(false);
  return geometry;
}

const courseLayouts = [
  {
    language: 'C',
    path: '/courses',
    heading: '课程目录',
    catalogSelector: '.c6-course-page',
    navLabel: 'C 语言学习',
    workbench: { link: '工作台', heading: 'C 代码工作台', selector: '.custom-code-page' },
    review: { heading: '错题与陌生点', selector: '.learning-notebook' },
  },
  ...courses.map(({ language, path, heading }) => {
    const selector = language === 'MySQL' ? '.mysql-screen' : '.python-screen';
    const languageWorkbench = language === 'MySQL' ? 'SQL 工作台' : `${language} 工作台`;
    const review = language === 'Python' || language === 'Java' ? '复盘' : '判题复盘';
    return {
      language,
      path,
      heading,
      catalogSelector: selector,
      navLabel: `${language} 学习`,
      workbench: {
        link: language === 'MySQL' ? languageWorkbench : '工作台',
        heading: languageWorkbench,
        selector,
      },
      review: { heading: `${language} ${review}`, selector },
    };
  }),
];

test.describe('centered language navigation with visible scrollbars', () => {
  for (const layout of courseLayouts) {
    test(`${layout.language} catalog, workbench and review share a centered content width`, async ({
      page,
    }) => {
      for (const width of [1920, 390]) {
        await test.step(`viewport ${width}px`, async () => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto('/#' + layout.path);
          const main = page.getByRole('main');
          const nav = main.getByRole('navigation', { name: layout.navLabel, exact: true });
          const catalog = await measureCenteredContent(
            main,
            layout.heading,
            layout.catalogSelector,
          );

          await nav.getByRole('link', { name: layout.workbench.link, exact: true }).click();
          const workbench = await measureCenteredContent(
            main,
            layout.workbench.heading,
            layout.workbench.selector,
          );

          if (layout.language === 'C') {
            const menu = page.getByRole('button', { name: '展开或收起导航', exact: true });
            if (await menu.isVisible()) await menu.click();
            await page
              .getByRole('navigation', { name: '主导航', exact: true })
              .getByRole('link', { name: layout.review.heading, exact: true })
              .click();
          } else {
            await nav.getByRole('link', { name: '判题复盘', exact: true }).click();
          }
          const review = await measureCenteredContent(
            main,
            layout.review.heading,
            layout.review.selector,
          );

          for (const [pageName, geometry] of [
            ['workbench', workbench],
            ['review', review],
          ] as const) {
            expect(geometry.left, `${pageName} aligns with catalog`).toBeCloseTo(catalog.left, 0);
            expect(geometry.width, `${pageName} matches catalog width`).toBeCloseTo(
              catalog.width,
              0,
            );
          }
        });
      }
    });
  }
});

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
