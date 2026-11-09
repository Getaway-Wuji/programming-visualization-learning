import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { editorValue, expectEditorValue } from './editor-value';

const cases = [
  {
    language: 'C',
    path: '/custom-code',
    label: 'C 代码',
    keyword: 'return',
    source: 'int main() { int n = 42; /* comment */ printf("hello"); return n; }',
    prefix: 'pri',
    suggestion: 'printf',
  },
  {
    language: 'Python',
    path: '/python/workbench',
    label: 'Python 代码',
    keyword: 'if',
    source: 'if True:\n    n = 42 # comment\n    print("hello")',
    prefix: 'pri',
    suggestion: 'print',
  },
  {
    language: 'Java',
    path: '/java/workbench',
    label: 'Java 代码',
    keyword: 'class',
    source: 'public class Main { int n = 42; /* comment */ String s = "hello"; }',
    prefix: 'pri',
    suggestion: 'print',
  },
  {
    language: 'C++',
    path: '/cpp/workbench',
    label: 'C++ 源码',
    keyword: 'return',
    source: 'int main() { int n = 42; /* comment */ std::cout << "hello"; return n; }',
    prefix: 'co',
    suggestion: 'cout',
  },
  {
    language: 'Rust',
    path: '/rust/workbench',
    label: 'Rust 源码',
    keyword: 'let',
    source: 'fn main() { let n = 42; /* comment */ println!("hello"); }',
    prefix: 'clo',
    suggestion: 'clone',
  },
  {
    language: 'MySQL',
    path: '/mysql/workbench',
    label: 'SQL 源码',
    keyword: 'SELECT',
    source: "SELECT 42, 'hello'; -- comment",
    prefix: 'SEL',
    suggestion: 'SELECT',
  },
];

for (const scenario of cases) {
  test(`${scenario.language} editor distinguishes syntax, completes and permits keyboard exit without changing source`, async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      const violations: string[] = [];
      Object.assign(window, { editorStyleViolations: violations });
      document.addEventListener('securitypolicyviolation', (event) => {
        if (event.violatedDirective.startsWith('style')) violations.push(event.violatedDirective);
      });
    });
    await page.goto('/#' + scenario.path);
    const code = page.getByRole('textbox', { name: scenario.label, exact: true });
    await expect(code).toBeEditable();
    await code.fill(scenario.source);
    await expectEditorValue(code, scenario.source);
    const readColors = () =>
      page.locator('.code-editor .cm-line span').evaluateAll((spans, keyword) => {
        const color = (match: (text: string) => boolean) => {
          const span = spans.find((element) => match(element.textContent ?? ''));
          return span ? getComputedStyle(span).color : null;
        };
        return {
          keyword: color((text) => text === keyword),
          number: color((text) => text === '42'),
          string: color((text) => text.includes('hello')),
          comment: color((text) => text.includes('comment')),
        };
      }, scenario.keyword);
    const modes: Record<string, Awaited<ReturnType<typeof readColors>>> = {};
    for (const mode of ['light', 'dark']) {
      if ((await page.locator('html').getAttribute('data-theme')) !== mode) {
        await page.getByTestId('theme-mode-toggle').click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      const colors = await readColors();
      expect(Object.values(colors).every(Boolean)).toBe(true);
      expect(new Set(Object.values(colors)).size).toBe(4);
      modes[mode] = colors;
    }
    await info.attach('actual-light-and-dark-syntax-colors', {
      body: JSON.stringify(modes),
      contentType: 'application/json',
    });
    expect(
      await page.evaluate(
        () => (window as unknown as { editorStyleViolations: string[] }).editorStyleViolations,
      ),
    ).toEqual([]);
    await code.press('Control+End');
    await code.press('Escape');
    await code.press('Tab');
    await expect(code).not.toBeFocused();
    await expectEditorValue(code, scenario.source);
    await code.fill(scenario.prefix);
    await code.press('Control+End');
    await code.press('Control+Space');
    await expect(
      page.getByRole('option').filter({ hasText: scenario.suggestion }).first(),
    ).toBeVisible();
    await code.press('Escape');
    await code.press('Tab');
    await expect(code).not.toBeFocused();
    await expectEditorValue(code, scenario.prefix);
    await code.press('Control+End');
    await code.press('ArrowRight');
    await code.press('Tab');
    const indented = '    ' + scenario.prefix;
    await expectEditorValue(code, indented);
    const replacement = `${scenario.source}\n// 中文与🙂\n第二行`;
    await code.fill(replacement);
    await expectEditorValue(code, replacement);
    await code.press('Control+z');
    await expectEditorValue(code, indented);
    await code.press('Control+y');
    await expectEditorValue(code, replacement);
    expect(
      await page.evaluate(
        () => (window as unknown as { editorStyleViolations: string[] }).editorStyleViolations,
      ),
    ).toEqual([]);
  });
}

for (const language of ['cpp', 'rust'] as const) {
  test(`${language} editable example protects changes and saves a real free-workbench copy`, async ({
    page,
  }) => {
    const course = JSON.parse(
      readFileSync(
        `content/${language === 'rust' ? 'rust2018' : language}/course/exercises-1.0.0.json`,
        'utf8',
      ),
    ) as { lesson: string }[];
    await page.goto(`/#/${language}/example/${course[0].lesson}`);
    const code = page.getByRole('textbox', {
      name: language === 'cpp' ? 'C++ 源码' : 'Rust 源码',
      exact: true,
    });
    await expect(code).toBeEditable();
    const changed = (await editorValue(code)) + '\n// 保存副本🙂\n';
    await code.fill(changed);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page
      .getByRole('link', { name: language === 'cpp' ? 'C++ 课程' : 'Rust 课程', exact: true })
      .click();
    await expect(page).toHaveURL(/\/example\//);
    await expectEditorValue(code, changed);
    await page.getByRole('button', { name: '复制到自由工作台并保存', exact: true }).click();
    await page.getByRole('link', { name: '打开已保存的自由工作台', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${language}/workbench$`));
    await expectEditorValue(code, changed);
    await page.reload();
    await expectEditorValue(code, changed);
  });

  test(`${language} example copy preserves an existing free draft when replacement is cancelled`, async ({
    page,
    context,
  }) => {
    const label = language === 'cpp' ? 'C++ 源码' : 'Rust 源码';
    const code = page.getByRole('textbox', { name: label, exact: true });
    const original = language === 'cpp' ? 'int main(){return 7;}' : 'fn main(){println!("kept");}';
    await page.goto(`/#/${language}/workbench`);
    await code.fill(original);
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByText('草稿已保存到此浏览器。', { exact: true })).toBeVisible();
    const course = JSON.parse(
      readFileSync(
        `content/${language === 'rust' ? 'rust2018' : language}/course/exercises-1.0.0.json`,
        'utf8',
      ),
    ) as { lesson: string }[];
    await page.goto(`/#/${language}/example/${course[0].lesson}`);
    await expect(code).toBeEditable();
    const copy = (await editorValue(code)) + '\n// replacement\n';
    await code.fill(copy);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: '复制到自由工作台并保存', exact: true }).click();
    const peer = await context.newPage();
    await peer.goto(`/#/${language}/workbench`);
    await expectEditorValue(peer.getByRole('textbox', { name: label, exact: true }), original);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '复制到自由工作台并保存', exact: true }).click();
    await expect(
      page.getByRole('link', { name: '打开已保存的自由工作台', exact: true }),
    ).toBeVisible();
    await peer.reload();
    await expectEditorValue(peer.getByRole('textbox', { name: label, exact: true }), copy);
  });
}
