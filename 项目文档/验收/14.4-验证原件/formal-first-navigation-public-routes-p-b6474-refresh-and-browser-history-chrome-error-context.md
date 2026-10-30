# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation.spec.ts >> public routes preserve content relationships, refresh and browser history
- Location: tests\browser\navigation.spec.ts:20:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '变量与表达式' })
Expected: "#/courses/chapter.c.values"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '变量与表达式' }) with timeout 5000ms
  - waiting for getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '变量与表达式' })

```

```yaml
- link "跳到主要内容":
  - /url: "#main-content"
- complementary:
  - button "收起侧栏" [expanded]
  - link "编程可视化教学平台 · 学习首页":
    - /url: "#/"
    - text: "{ } 一步一懂 编程可视化教学平台"
  - paragraph: 从代码，到理解。
  - navigation "主导航":
    - link "学习首页":
      - /url: "#/"
    - link "C 语言课程":
      - /url: "#/courses"
    - link "算法与演示":
      - /url: "#/cases"
    - link "编译流程":
      - /url: "#/compilation"
    - link "本地设置":
      - /url: "#/settings"
  - strong: 按自己的节奏学习
  - paragraph: 学习记录将保存在当前浏览器，不跨设备同步。
  - link "了解本地数据":
    - /url: "#/settings?panel=data"
- banner:
  - text: C 语言 · 从零开始 本地学习
  - link "本地数据":
    - /url: "#/settings?panel=data"
  - button "切换为深色"
- main:
  - navigation "当前位置":
    - list:
      - listitem:
        - link "C 语言课程":
          - /url: "#/courses"
      - listitem:
        - link "程序入门与输出":
          - /url: "#/courses/chapter.c.values"
      - listitem: 变量和输出
  - status:
    - heading "本地档案已读取" [level=2]
    - paragraph: 正在显示当前浏览器中已保存的记录与设置。
  - paragraph: 第 1 章 · 程序入门与输出
  - heading "变量和输出" [level=1]
  - paragraph: 先理解目标和示例，再主动确认学习，最后通过本节必修练习。
  - paragraph: 未开始
  - heading "学习目标" [level=2]
  - list:
    - listitem: 找到程序从哪里开始、按什么顺序执行
    - listitem: 区分声明、赋值和读取，理解变量的名字与当前值
    - listitem: 用 printf 输出实际输入变量并保留换行
  - heading "讲解与示例" [level=2]
  - paragraph: 先把程序想成一张按顺序执行的任务单。int main(void) 是入口，花括号包住任务，return 0 表示正常结束。#include <stdio.h> 在这里是可识别的教学头文件行，不会加载任意系统库。当前课程只使用有符号32位整数，不支持小数、scanf、指针或自定义函数。 变量像有名字的格子。int x = 7; 声明一个名为 x 的整数并放入7；随后读取 x 得到当前值。x = x + 2; 先读旧值、算出新值，再写回，所以不是数学等式。参考程序 program.c.echo 把输入 x=7 写在声明中，printf("%d\n", x) 读取它，输出7并换行。%d 对应一个整数，\n 是换行，%% 输出一个百分号；输出格式与参数必须一一对应。 输入面板的数值会成为这一次可见源码的初始化值；不是终端键盘输入。运行前先预测输出，再看变量建立、输出追加、return退出。关联的“变量赋值”案例默认从3加2到5；它与本节“原样输出”练习是两个不同目标。 变量名区分大小写，采用英文字母、数字和下划线且不能以数字开头。先声明再使用。下面演示内外层同名变量：两个 x 是不同格子，离开内层花括号后，外层仍为7，输出依次是9、7。
  - text: "#include <stdio.h> int main(void) { int x = 7; { int x = 9; printf(\"%d\\n\", x); } printf(\"%d\\n\", x); return 0; }"
  - paragraph: 没有初始化的格子没有可读取的数值。下面是故意的错误示例：运行到 printf 时报告未初始化读取，不输出半行。修复方法是在读取前初始化或赋值。
  - text: "#include <stdio.h> int main(void) { int x; printf(\"%d\\n\", x); return 0; }"
  - paragraph: "## 本节完整参考程序 以下保留原题目目标与输入绑定。新增细分课程用于补充讲解，不改变已经通过本节的完成条件。"
  - text: "#include <stdio.h> int main(void) { int x = 7; printf(\"%d\\n\", x); return 0; }"
  - paragraph: 在练习中可主动打开三层提示；独立练习默认只保留输入骨架，不替你填答案。课程移动到新章节后，旧同ID的有效学习记录仍按显式兼容链保留。只有新的真实提交或主动学习确认才产生当天事实；移章、刷新、查看本段不会重新发首次积分。
  - heading "变量输出参考" [level=3]
  - text: "#include <stdio.h> int main(void) { int x = 7; printf(\"%d\\n\", x); return 0; }"
  - heading "常见错误" [level=2]
  - list:
    - listitem: 打印字面量7只对一个例子碰巧正确；练习必须读取输入变量。
    - listitem: 漏掉分号、花括号或把 X 当作 x，会在运行前被拒绝。
    - listitem: int x = x; 读的是尚未初始化的新变量；不要用它复制外层同名变量。
    - listitem: 输出末尾需要换行；题目不会自动删除多余空格或提示文字。
  - heading "范围与边界" [level=2]
  - list:
    - listitem: x 可为-999到999，包括0和负数；例如-9输出-9和换行。
    - listitem: int 值域为-2147483648到2147483647；溢出会报告错误，不自动绕回。
    - listitem: 本节练习要求实际读取并输出 x，查看课程或运行演示本身不算练习通过。
  - heading "本节知识点" [level=2]
  - list:
    - listitem: main与程序入口
    - listitem: 变量与作用域
    - listitem: 有限printf
    - listitem: 真实输入绑定
  - heading "记录本节学习" [level=2]
  - paragraph: 学习确认与必修练习通过共同决定小节完成。浏览、刷新和查看解析不会自动通过练习。
  - button "开始本节学习"
  - button "确认已学习"
  - link "返回课程目录":
    - /url: "#/courses"
  - complementary:
    - region "小节完成清单":
      - heading "小节完成清单" [level=3]
      - text: 0/2 项已保存
      - list:
        - listitem:
          - text: 阅读并主动确认学习
          - strong: 待确认
        - listitem:
          - text: 输出输入变量
          - strong: 待通过并保存
      - paragraph: 小节尚未完成
      - link "阅读并确认本节学习":
        - /url: "#/lessons/lesson.c.variables-output#lesson-study-confirmation"
    - text: 本节必修练习
    - heading "输出输入变量" [level=2]
    - paragraph: 尚无已保存的通过记录
    - paragraph: 搭建本节积木程序，提交真实测试并逐步复盘；通过记录保存在当前浏览器。
    - link "进入练习工作区":
      - /url: "#/practice/exercise.c.echo"
    - heading "关联演示" [level=2]
    - list:
      - listitem:
        - link "变量赋值":
          - /url: "#/visualize/case.c.assignment"
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import type { Page } from '@playwright/test';
  3   | import { openBlockKeyboardEditor, showPracticeBlocks } from './block-ui';
  4   | 
  5   | const practicePath = '/#/practice/exercise.c.echo';
  6   | const visualPath = '/#/visualize/case.c.bubble-sort';
  7   | 
  8   | async function ready(page: Page, id: string) {
  9   |   await expect(page.locator(`[data-page-id="${id}"]`)).toBeVisible();
  10  |   await expect(page.locator('.state-loading')).toHaveCount(0);
  11  |   await expect(page.locator('main h1')).toBeVisible();
  12  | }
  13  | 
  14  | async function noHorizontalOverflow(page: Page) {
  15  |   await expect
  16  |     .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  17  |     .toBe(true);
  18  | }
  19  | 
  20  | test('public routes preserve content relationships, refresh and browser history', async ({
  21  |   page,
  22  | }) => {
  23  |   const wasmRequests: string[] = [];
  24  |   page.on('request', (request) => {
  25  |     if (/\.wasm(?:\?|$)/.test(request.url())) wasmRequests.push(request.url());
  26  |   });
  27  |   await page.goto('/');
  28  |   await ready(page, 'PAGE-01');
  29  |   await page
  30  |     .getByRole('navigation', { name: '主导航' })
  31  |     .getByRole('link', { name: 'C 语言课程' })
  32  |     .click();
  33  |   await ready(page, 'PAGE-02');
  34  |   await expect(
  35  |     page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: 'C 语言课程' }),
  36  |   ).toHaveAttribute('aria-current', 'page');
  37  |   await page.locator('[data-course-lesson] a[href="#/lessons/lesson.c.variables-output"]').click();
  38  |   await ready(page, 'PAGE-03');
  39  |   await expect(page.locator('main h1')).toHaveText('变量和输出');
  40  |   await expect(page.locator('main h1')).toBeFocused();
  41  |   await expect(page.getByRole('button', { name: '确认已学习' })).toBeEnabled();
  42  |   await expect(
  43  |     page.getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '变量与表达式' }),
> 44  |   ).toHaveAttribute('href', '#/courses/chapter.c.values');
      |     ^ Error: expect(locator).toHaveAttribute(expected) failed
  45  |   expect(wasmRequests).toEqual([]);
  46  |   await page.getByRole('link', { name: '进入练习工作区' }).click();
  47  |   await ready(page, 'PAGE-04');
  48  |   await expect(page.getByTestId('draft-code-editor')).toHaveAttribute('data-sync', 'synced');
  49  |   expect(wasmRequests.length).toBeGreaterThan(0);
  50  |   await expect(page).toHaveURL(/#\/practice\/exercise\.c\.echo$/);
  51  |   await page.reload();
  52  |   await ready(page, 'PAGE-04');
  53  |   await expect(
  54  |     page.getByRole('navigation', { name: '当前位置' }).getByRole('link', { name: '变量和输出' }),
  55  |   ).toHaveAttribute('href', '#/lessons/lesson.c.variables-output');
  56  |   await page.goBack();
  57  |   await ready(page, 'PAGE-03');
  58  |   await page
  59  |     .getByRole('navigation', { name: '主导航' })
  60  |     .getByRole('link', { name: '算法与演示' })
  61  |     .click();
  62  |   await ready(page, 'PAGE-05');
  63  |   await expect(page.locator('main a[href^="#/visualize/"]')).toHaveCount(7);
  64  |   await page.locator('main a[href="#/visualize/case.c.bubble-sort"]').click();
  65  |   await ready(page, 'PAGE-06');
  66  |   await expect(
  67  |     page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '算法与演示' }),
  68  |   ).toHaveAttribute('aria-current', 'page');
  69  |   await expect(page.locator('main a[href="#/lessons/lesson.c.array-sum"]').first()).toBeVisible();
  70  |   await page
  71  |     .getByRole('navigation', { name: '主导航' })
  72  |     .getByRole('link', { name: '本地设置' })
  73  |     .click();
  74  |   await ready(page, 'PAGE-07');
  75  |   await expect(page.getByRole('link', { name: /登录|注册|排行榜/ })).toHaveCount(0);
  76  | });
  77  | 
  78  | test('workspaces keep real blocks beside read-only code, review playback and empty-review boundaries', async ({
  79  |   page,
  80  | }, testInfo) => {
  81  |   await page.goto(practicePath);
  82  |   await ready(page, 'PAGE-04');
  83  |   const options = page.getByRole('region', { name: '积木工作区', exact: true });
  84  |   await expect(page.getByTestId('practice-execution')).toHaveAttribute('data-state', 'ready');
  85  |   await showPracticeBlocks(page);
  86  |   await expect(options).toBeVisible();
  87  |   await openBlockKeyboardEditor(page);
  88  |   await expect(
  89  |     options.getByRole('combobox', { name: '添加积木类型', exact: true }).locator('option'),
  90  |   ).toHaveCount(20);
  91  |   await expect(options.getByRole('combobox', { name: '积木列表', exact: true })).toBeVisible();
  92  |   await expect(options.locator('.blocklySvg')).toBeVisible();
  93  |   const practiceCode = page.getByTestId('code-panel');
  94  |   await expect(practiceCode).toBeVisible();
  95  |   await expect(page.getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  96  |   await expect(page.getByRole('button', { name: '运行本组', exact: true })).toBeEnabled();
  97  |   const optionsBox = await options.boundingBox();
  98  |   const practiceBox = await practiceCode.boundingBox();
  99  |   expect(optionsBox).not.toBeNull();
  100 |   expect(practiceBox).not.toBeNull();
  101 |   expect(optionsBox!.x + optionsBox!.width).toBeLessThanOrEqual(practiceBox!.x + 1);
  102 |   expect(Math.abs(optionsBox!.y - practiceBox!.y)).toBeLessThanOrEqual(1);
  103 |   const practiceAnimationBox = await page.getByTestId('animation-panel').boundingBox();
  104 |   expect(practiceBox!.y + practiceBox!.height).toBeLessThanOrEqual(practiceAnimationBox!.y + 1);
  105 |   const source = practiceCode.locator('textarea');
  106 |   await expect(source).toHaveAttribute('readonly', '');
  107 |   await source.focus();
  108 |   const originalSource = await source.inputValue();
  109 |   await page.keyboard.type('int changed = 1;');
  110 |   await expect(source).toHaveValue(originalSource);
  111 |   await expect(source).not.toHaveValue('');
  112 |   await expect(page.getByRole('button', { name: '提交练习', exact: true })).toBeEnabled();
  113 |   await expect(page.getByTestId('practice-feedback')).not.toContainText('本次提交通过');
  114 |   await expect(page.getByRole('link', { name: '查看本次复盘', exact: true })).toHaveAttribute(
  115 |     'href',
  116 |     '#/practice/exercise.c.echo/review',
  117 |   );
  118 |   await page.screenshot({ path: testInfo.outputPath('practice-layout.png'), fullPage: true });
  119 | 
  120 |   await page.goto(visualPath);
  121 |   await ready(page, 'PAGE-06');
  122 |   await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  123 |   await expect(page.getByRole('button', { name: '运行示例', exact: true })).toBeEnabled();
  124 |   const visualCode = page.getByTestId('code-panel');
  125 |   const animation = page.getByTestId('animation-panel');
  126 |   const codeBox = await visualCode.boundingBox();
  127 |   const animationBox = await animation.boundingBox();
  128 |   expect(codeBox!.x + codeBox!.width).toBeLessThanOrEqual(animationBox!.x + 1);
  129 |   await expect(visualCode.locator('textarea')).toHaveAttribute('readonly', '');
  130 |   await expect(page.getByTestId('input-panel')).toBeVisible();
  131 |   for (const label of ['播放', '前进', '后退', '重播']) {
  132 |     await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled();
  133 |   }
  134 |   await expect(page.getByTestId('player-controls')).toHaveAttribute('data-length', '0');
  135 |   await expect(page.getByTestId('trace-view')).toHaveAttribute('data-cursor', '');
  136 |   await page.screenshot({ path: testInfo.outputPath('visualize-layout.png'), fullPage: true });
  137 | 
  138 |   await page.goto('/#/practice/exercise.c.echo/review');
  139 |   await ready(page, 'PAGE-06');
  140 |   await expect(page.getByTestId('practice-execution')).toContainText('还没有可复盘的运行');
  141 |   await expect(page.getByTestId('code-panel')).toHaveCount(0);
  142 |   await expect(page.getByTestId('animation-panel')).toHaveCount(0);
  143 |   await expect(page.getByRole('button', { name: '播放', exact: true })).toHaveCount(0);
  144 |   await expect(page.locator('main a[href="#/practice/exercise.c.echo"]').first()).toBeVisible();
```