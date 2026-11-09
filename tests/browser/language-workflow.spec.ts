import { expect, test, type Page } from '@playwright/test';
import { expectEditorValue } from './editor-value';

const workbenches = [
  {
    language: 'C',
    path: '/custom-code',
    directory: '/courses',
    heading: 'C 代码工作台',
    label: 'C 代码',
    run: '运行代码',
    output: 'custom-output',
    trace: 'custom-code-page',
    source: '#include <stdio.h>\nint main(void) { printf("%d\\n", 2718); return 0; }\n',
    saved: '草稿已保存到当前浏览器。',
  },
  {
    language: 'Python',
    path: '/python/workbench',
    directory: '/python',
    heading: 'Python 工作台',
    label: 'Python 代码',
    run: '运行代码',
    output: 'python-output',
    trace: 'python-trace',
    source: 'print(2718)\n',
    saved: '草稿已保存到本机。',
  },
  {
    language: 'Java',
    path: '/java/workbench',
    directory: '/java',
    heading: 'Java 工作台',
    label: 'Java 代码',
    run: '运行代码',
    output: 'java-output',
    trace: 'java-trace',
    source:
      'public class Main {\n    public static void main(String[] args) {\n        System.out.println(2718);\n    }\n}\n',
    saved: '草稿已保存到本机。',
  },
  {
    language: 'C++',
    path: '/cpp/workbench',
    directory: '/cpp',
    heading: 'C++ 工作台',
    label: 'C++ 源码',
    run: '运行',
    output: 'cpp-output',
    trace: 'cpp-trace',
    source: '#include <iostream>\nint main() { std::cout << 2718 << std::endl; return 0; }\n',
    saved: '草稿已保存到此浏览器。',
  },
  {
    language: 'Rust',
    path: '/rust/workbench',
    directory: '/rust',
    heading: 'Rust 工作台',
    label: 'Rust 源码',
    run: '运行',
    output: 'rust-output',
    trace: 'rust-trace',
    source: 'fn main() {\n    println!("{}", 2718);\n}\n',
    saved: '草稿已保存到此浏览器。',
  },
  {
    language: 'MySQL',
    path: '/mysql/workbench',
    directory: '/mysql',
    heading: 'SQL 工作台',
    label: 'SQL 源码',
    run: '运行 SQL',
    output: 'mysql-result',
    trace: 'mysql-trace',
    source: 'SELECT 2718 AS result;\n',
    saved: 'SQL 和数据库草稿已保存到此浏览器。',
  },
] as const;

async function storageReady(page: Page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}

for (const workbench of workbenches) {
  test(`${workbench.language} runs real edited source, outputs 2718, saves and restores the draft`, async ({
    page,
  }) => {
    await page.goto('/#' + workbench.path);
    const code = page.getByRole('textbox', { name: workbench.label, exact: true });
    await expect(code).toBeEditable();
    await storageReady(page);
    await code.fill(workbench.source);
    await expectEditorValue(code, workbench.source);
    await page.getByRole('button', { name: workbench.run, exact: true }).click();
    if (workbench.language === 'C') {
      await expect(page.getByTestId(workbench.trace)).toHaveAttribute('data-status', 'ready');
      const slider = page.getByRole('slider', { name: '执行步骤', exact: true });
      await slider.fill((await slider.getAttribute('max'))!);
    } else if (workbench.language !== 'MySQL') {
      await expect(page.getByTestId(workbench.trace)).toBeVisible();
      const last = page.getByRole('button', { name: '到最后一步', exact: true });
      if (await last.isEnabled()) await last.click();
    }
    if (workbench.language === 'MySQL') {
      await expect(
        page.getByTestId(workbench.output).getByRole('cell', { name: '2718', exact: true }),
      ).toBeVisible();
    } else await expect(page.getByTestId(workbench.output)).toHaveText('2718');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText(workbench.saved, { exact: true })).toBeVisible();
    await page.reload();
    await expectEditorValue(code, workbench.source);
    await storageReady(page);
    if (workbench.language !== 'C') await expect(page.getByTestId(workbench.trace)).toHaveCount(0);
    else await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-status', 'idle');
  });
}

test('a real MySQL reading selects its language on home and preserves its named first reward', async ({
  page,
}) => {
  await page.goto('/#/mysql/lesson/mysql.lesson.1.1.1');
  await storageReady(page);
  const end = page.getByTestId('reading-end');
  await expect(end).toBeAttached();
  await page.bringToFront();
  await expect(async () => {
    await page.keyboard.press('End');
    await expect(end).toHaveAttribute('data-read-today', 'true', { timeout: 800 });
  }).toPass({ timeout: 8000 });
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('link', { name: '学习首页', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: '继续学 MySQL', exact: true }),
  ).toBeVisible();
  const study = page.getByRole('region', { name: 'MySQL 继续学习', exact: true });
  await expect(study).toContainText('1 / 300 个小节已阅读');
  await expect(study.getByRole('link', { name: '继续阅读', exact: true })).toHaveAttribute(
    'href',
    '#/mysql/lesson/mysql.lesson.1.1.2',
  );
  await expect(page.locator('.points-toggle')).toContainText('20');
  await page.locator('.points-toggle').click();
  const points = page.getByRole('dialog');
  await expect(points).toBeVisible();
  const earned = points.locator('.reward-ledger > li');
  await expect(earned).toHaveCount(1);
  await expect(earned).toContainText('数据库技术的发展');
  await expect(earned).toContainText('20 分');
  await expect(earned).not.toContainText('旧版本学习内容');
  await expect(earned).not.toContainText('教学组');
});

test('all six manual home language choices keep daily-goal and workspace destinations in that language', async ({
  page,
}) => {
  await page.goto('/#/');
  await storageReady(page);
  const picker = page.locator('[aria-label="选择学习语言"]');
  for (const workbench of workbenches) {
    await picker.getByRole('button', { name: workbench.language, exact: true }).click();
    await expect(
      picker.getByRole('button', { name: workbench.language, exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('heading', { level: 1, name: '继续学 ' + workbench.language, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId('goal-progress-lesson').getByRole('link')).toHaveAttribute(
      'href',
      '#' + workbench.directory,
    );
    await expect(page.getByTestId('goal-progress-exercise').getByRole('link')).toHaveAttribute(
      'href',
      '#' + (workbench.language === 'C' ? '/practice' : workbench.directory),
    );
    await expect(
      page.getByRole('link', { name: workbench.language + ' 工作台', exact: true }),
    ).toHaveAttribute('href', '#' + workbench.path);
  }
});

test('cold and warm in-app workbench routes focus every heading while initial documents keep native focus order', async ({
  page,
  context,
}) => {
  await page.goto('/#/');
  await expect(
    page.getByRole('heading', { level: 1, name: '继续学 C', exact: true }),
  ).toBeVisible();
  const home = (current: Page) =>
    current
      .getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('link', { name: '学习首页', exact: true });
  for (const workbench of workbenches) {
    const heading = page.getByRole('heading', { level: 1, name: workbench.heading, exact: true });
    const enter = async () => {
      const primary = page.getByRole('navigation', { name: '主导航', exact: true });
      if (workbench.language === 'C')
        await primary.getByRole('link', { name: 'C 代码工作台', exact: true }).click();
      else {
        await primary
          .getByRole('link', { name: workbench.language + ' 课程', exact: true })
          .click();
        await page
          .getByRole('navigation', { name: workbench.language + ' 学习', exact: true })
          .getByRole('link', {
            name: workbench.language === 'MySQL' ? 'SQL 工作台' : '工作台',
            exact: true,
          })
          .click();
      }
      await expect(
        page.getByRole('textbox', { name: workbench.label, exact: true }),
      ).toBeEditable();
      await expect(heading).toBeFocused();
    };
    // The first in-document entry loads the language screen; the second reuses its modules.
    await enter();
    await page.getByRole('button', { name: '进入专注模式', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workbench-mode', 'focus');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sidebar', 'collapsed');
    await page.getByRole('button', { name: '退出专注模式', exact: true }).click();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-workbench-mode', 'standard');
    await home(page).click();
    await enter();
    await home(page).click();
    // A new document preserves native initial Tab order instead of focusing an editor.
    const initial = await context.newPage();
    try {
      await initial.goto('/#' + workbench.path);
      const code = initial.getByRole('textbox', { name: workbench.label, exact: true });
      await expect(code).toBeEditable();
      await expect(
        initial.getByRole('heading', { level: 1, name: workbench.heading, exact: true }),
      ).toBeVisible();
      await expect(code).not.toBeFocused();
    } finally {
      await initial.close();
    }
  }
});
