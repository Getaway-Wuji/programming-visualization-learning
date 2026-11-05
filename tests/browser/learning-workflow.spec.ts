import { expectEditorValue } from './editor-value';
import { expect, test, type Page } from '@playwright/test';

const exercise = '/#/practice/exercise.c6.s2.1';
const answer =
  '#include <stdio.h>\nint main(void) { int n; scanf("%d", &n); printf("n=%d\\n", n); return 0; }\n';
const editor = (page: Page) =>
  page.getByRole('textbox', { name: '完整 C 源码 · main.c', exact: true });

async function delayedWorker(page: Page, delayMs = 350) {
  await page.addInitScript((delayMs: number) => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ) {
        setTimeout(() => {
          if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
          else super.postMessage(message, transferOrOptions);
        }, delayMs);
      }
    };
  }, delayMs);
}

test('immediate submission takes priority over background block mapping', async ({ page }) => {
  await delayedWorker(page);
  await page.goto(exercise);
  await expect(page.locator('.c6-block-pane')).toHaveAttribute('aria-busy', 'false');
  await editor(page).fill(answer);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText('通过');
  await expect(page.getByRole('alert').filter({ hasText: 'E_CANCELLED' })).toHaveCount(0);
});

test('cancelling a run allows a subsequent submission', async ({ page }) => {
  await delayedWorker(page);
  await page.goto(exercise);
  await expect(page.locator('.c6-block-pane')).toHaveAttribute('aria-busy', 'false');
  await editor(page).fill(answer);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveCount(0);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText('通过');
});

test('the original real deadline rejects a delayed Worker without accepting late success', async ({
  page,
}) => {
  await delayedWorker(page, 1_300);
  await page.goto(exercise);
  await editor(page).fill(answer);
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'E_DEADLINE' }).first()).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('oj-verdict')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'E_DEADLINE' }).first()).toBeVisible();
});

test('unsaved edits are protected on sidebar navigation and browser back', async ({ page }) => {
  await page.goto('/#/practice');
  await page.locator('.c6-practice-entry').first().click();
  const changed = '// preserved unsaved text\n' + answer;
  await editor(page).fill(changed);
  const home = page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '学习首页', exact: true });
  const confirm = (accept: boolean) =>
    page.waitForEvent('dialog').then(async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('未保存');
      if (accept) await dialog.accept();
      else await dialog.dismiss();
    });
  await Promise.all([confirm(false), home.click()]);
  await expect(editor(page)).toContainText('// preserved unsaved text');
  await Promise.all([confirm(false), page.goBack()]);
  await expect(editor(page)).toContainText('// preserved unsaved text');
  await Promise.all([confirm(true), home.click()]);
  await expect(page.getByRole('heading', { name: '继续学 C', exact: true })).toBeVisible();
});

test('saved edits can leave without a warning and restore on return', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (dialog) => {
    dialogs++;
    void dialog.dismiss();
  });
  await page.goto(exercise);
  await editor(page).fill(answer);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('c6-draft-save-status')).toHaveText('草稿已保存');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '学习首页', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '继续学 C', exact: true })).toBeVisible();
  expect(dialogs).toBe(0);
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '练习', exact: true })
    .click();
  await page.locator('.c6-practice-entry').first().click();
  await expect(editor(page)).toContainText('scanf("%d", &n)');
});

async function readToEnd(page: Page) {
  const end = page.getByTestId('reading-end');
  await expect(end).toBeAttached();
  await end.scrollIntoViewIfNeeded();
  await page.keyboard.press('End');
  await expect(end).toHaveAttribute('data-read', 'true');
  await expect(end).toHaveAttribute('data-read-today', 'true');
}

test('automatic reading counts once per day and again on a later day without a repeated reward', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-05T04:00:00Z'));
  await page.goto('/#/lessons/lesson.c6.s1.1');
  await readToEnd(page);
  await page.goto('/#/');
  await expect(page.getByTestId('goal-progress-lesson')).toContainText('1 / 1');
  const points = await page.locator('.points-toggle').innerText();
  await page.goto('/#/lessons/lesson.c6.s1.1');
  await readToEnd(page);
  await page.goto('/#/');
  await expect(page.getByTestId('goal-progress-lesson')).toContainText('1 / 1');
  await page.clock.setFixedTime(new Date('2026-11-06T04:00:00Z'));
  await page.goto('/#/lessons/lesson.c6.s1.1');
  await readToEnd(page);
  await page.goto('/#/');
  await expect(page.getByTestId('goal-progress-lesson')).toContainText('1 / 1');
  await expect(page.locator('.points-toggle')).toHaveText(points);
});

test('a lesson left open across midnight requires new reading interaction', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-05T15:59:58Z'));
  await page.goto('/#/lessons/lesson.c6.s1.1');
  await readToEnd(page);
  const end = page.getByTestId('reading-end');
  await page.clock.setFixedTime(new Date('2026-11-05T16:00:02Z'));
  await expect(end).toHaveAttribute('data-read-today', 'false');
  await expect(end).toHaveAttribute('data-read', 'true');
  await page.waitForTimeout(1_200);
  await expect(end).toHaveAttribute('data-read-today', 'false');
  await page.keyboard.press('End');
  await expect(end).toHaveAttribute('data-read-today', 'true');
  await page.goto('/#/');
  await expect(page.getByTestId('goal-progress-lesson')).toContainText('1 / 1');
});

test('custom code also protects unsaved edits and allows leaving after saving', async ({
  page,
}) => {
  await page.goto('/#/custom-code');
  const source = page.getByRole('textbox', { name: 'C 代码', exact: true });
  await expect(source).toBeVisible();
  await source.fill(answer);
  const home = page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '学习首页', exact: true });
  page.once('dialog', (dialog) => dialog.dismiss());
  await home.click();
  await expectEditorValue(source, answer);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('custom-save-status')).toContainText('草稿已保存');
  await home.click();
  await expect(page.getByRole('heading', { name: '继续学 C', exact: true })).toBeVisible();
});

test('mobile practice keeps code and actions accessible while preserving pane edits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(exercise);
  await expect(editor(page)).toBeVisible();
  const box = await editor(page).boundingBox();
  expect(box!.y).toBeLessThan(500);
  await editor(page).fill(answer);
  await page.getByRole('button', { name: '题目', exact: true }).click();
  await expect(page.getByTestId('practice-examples')).toBeVisible();
  await expect(editor(page)).not.toBeVisible();
  await page.getByRole('button', { name: '积木', exact: true }).click();
  await expect(page.locator('.c6-block-pane')).toBeVisible();
  await page.getByRole('button', { name: '代码', exact: true }).click();
  await expect(editor(page)).toContainText('scanf("%d", &n)');
  await page.getByRole('button', { name: '提交', exact: true }).click();
  await expect(page.getByTestId('oj-verdict')).toHaveText('通过');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByTestId('c6-draft-save-status')).toHaveText('草稿已保存');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('compact mobile toolbar keeps secondary tools reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: '继续学 C', exact: true })).toBeVisible();
  expect((await page.locator('.topbar').boundingBox())!.height).toBeLessThanOrEqual(72);
  await page.locator('.topbar-more > summary').click();
  await page.getByRole('link', { name: '本地数据', exact: true }).click();
  await expect(page).toHaveURL(/panel=data/);
  await page.locator('.topbar-more > summary').click();
  await page.locator('.points-toggle').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('desktop shows question and code together and uses the actual algorithm language', async ({
  page,
}) => {
  await page.goto(exercise);
  await expect(editor(page)).toBeVisible();
  const sourceBox = await editor(page).boundingBox();
  const questionBox = await page.getByRole('region', { name: '题目和样例' }).boundingBox();
  expect(sourceBox!.y).toBeLessThan(500);
  expect(questionBox!.x).toBeLessThan(sourceBox!.x);
  await page.goto('/#/algorithms/lab/bubble');
  await expect(page.locator('.topbar-title')).toHaveText('算法演示 · C++');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
});

test('home keeps optional AI unloaded and AI settings still initializes on demand', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: '继续学 C', exact: true })).toBeVisible();
  expect(
    requests.filter((url) => /c6-teaching-(chunk|source)|\/session-[^/]+\.js/.test(url)),
  ).toEqual([]);
  await page.goto('/#/settings?panel=ai');
  await expect(page.getByRole('heading', { name: 'AI解释（可选）', exact: true })).toBeVisible();
  await expect(page.getByLabel('AI服务', { exact: true })).toBeEnabled();
  await expect(page.getByText('未开启', { exact: true })).toBeVisible();
});
