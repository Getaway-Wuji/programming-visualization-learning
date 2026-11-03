import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { observeCaseSetExecution } from './case-set-observation';

const panel = (page: Page) => page.locator('[data-page-id="PAGE-14-2"]');
const simulate = (page: Page) => page.getByRole('button', { name: '演示此阶段', exact: true });
const next = (page: Page) => page.getByRole('button', { name: '下一步', exact: true });
const folder = `.artifacts/14.2/browser/${process.env.TASK_EVIDENCE_LABEL ?? 'local'}`;
async function ready(page: Page) {
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}
async function record(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('c-viz-learning');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      return await Promise.all(
        names.map(
          (name) =>
            new Promise((resolve) => {
              const req = tx.objectStore(name).getAll();
              req.onsuccess = () => resolve([name, req.result]);
            }),
        ),
      );
    } finally {
      db.close();
    }
  });
}
async function open(page: Page) {
  await page.goto('/#/compilation');
  await ready(page);
}
async function advanceTo(page: Page, stage: number) {
  for (let index = 0; index < stage; index++) {
    await simulate(page).click();
    await next(page).click();
  }
}

test('four stage simulation preserves inputs, progression, review and local records without executing code', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (req) => {
    if (/\.wasm(?:\?|$)/.test(req.url())) requests.push(req.url());
  });
  await observeCaseSetExecution(page);
  await page.goto('/');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('link', { name: '编译流程', exact: true })
    .click();
  await ready(page);
  await expect(page.locator('main h1')).toBeFocused();
  const before = await record(page);
  await expect(page.getByRole('button', { name: '上一步', exact: true })).toBeDisabled();
  const titles = ['预处理', '编译', '汇编', '链接'];
  const outputs = ['return 2 + 3;', '取常量 2', '定义的符号：main', '是否已经运行：否'];
  for (let index = 0; index < 4; index++) {
    await expect(
      page.getByRole('heading', { name: `第 ${index + 1} 步 · ${titles[index]}`, exact: true }),
    ).toBeVisible();
    await expect(next(page)).toBeDisabled();
    await expect(page.getByTestId('compilation-output')).toHaveCount(0);
    await simulate(page).click();
    await expect(page.getByTestId('compilation-output')).toContainText(outputs[index]);
    if (index < 3) await next(page).click();
  }
  await expect(next(page)).toBeDisabled();
  await expect(panel(page)).toHaveAttribute('data-completed', '4');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(page.getByTestId('compilation-output')).toContainText(outputs[2]);
  await expect(simulate(page)).toBeDisabled();
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await expect(panel(page)).toHaveAttribute('data-completed', '0');
  await expect(page.getByTestId('compilation-output')).toHaveCount(0);
  expect(await record(page)).toEqual(before);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => window.__verticalObservation.workers.length)).toBe(0);
  await mkdir(folder, { recursive: true });
  await writeFile(
    `${folder}/simulation-boundary.json`,
    JSON.stringify(
      { before, after: await record(page), wasmRequests: requests, workers: 0 },
      null,
      2,
    ),
  );
});

for (const [id, index, description] of [
  ['header', 0, '头文件没有找到'],
  ['semicolon', 1, 'return 语句缺少分号'],
  ['instruction', 2, '汇编文本含未知指令'],
  ['symbol', 3, 'helper 只有声明，没有定义'],
] as const) {
  test(`illustrated ${id} failure stops only at its stage and a reset repairs the flow`, async ({
    page,
  }) => {
    await open(page);
    await page.getByRole('combobox', { name: '演示情景', exact: true }).selectOption(id);
    await advanceTo(page, index);
    await simulate(page).click();
    await expect(page.getByRole('alert')).toContainText(description);
    await expect(page.getByRole('alert')).toContainText('非真实诊断');
    await page.getByRole('alert').scrollIntoViewIfNeeded();
    await mkdir(folder, { recursive: true });
    await page.screenshot({ path: `${folder}/fault-${id}.png` });
    await expect(page.getByTestId('compilation-output')).toHaveCount(0);
    await expect(next(page)).toBeDisabled();
    for (let later = index + 1; later < 4; later++)
      await expect(page.locator('.compilation-chain button').nth(later)).toBeDisabled();
    await page.getByRole('button', { name: '恢复正常示例', exact: true }).click();
    await expect(panel(page)).toHaveAttribute('data-scenario', 'normal');
    await expect(panel(page)).toHaveAttribute('data-completed', '0');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await advanceTo(page, 3);
    await simulate(page).click();
    await expect(panel(page)).toHaveAttribute('data-completed', '4');
    // Changing scenario invalidates every earlier illustration, including the final artifact.
    await page.getByRole('combobox', { name: '演示情景', exact: true }).selectOption(id);
    await expect(panel(page)).toHaveAttribute('data-completed', '0');
    await expect(page.getByTestId('compilation-output')).toHaveCount(0);
  });
}

test('keyboard, three widths, refresh and history keep the simulated state honest', async ({
  page,
}) => {
  await open(page);
  await simulate(page).focus();
  await page.keyboard.press('Enter');
  await next(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '第 2 步 · 编译', exact: true })).toBeFocused();
  await simulate(page).click();
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page
      .getByRole('heading', { name: '第 2 步 · 编译', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${folder}/compilation-${width}.png` });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('compilation-output')).toContainText('取常量 2');
  }
  await page.reload();
  await ready(page);
  await expect(panel(page)).toHaveAttribute('data-completed', '0');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('link', { name: '本地设置', exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await page.goBack();
  await ready(page);
  await expect(panel(page)).toHaveAttribute('data-completed', '0');
});

test('the explanation links to the existing real Rust path and lazy page failure can recover', async ({
  page,
}) => {
  await observeCaseSetExecution(page);
  await open(page);
  await page.getByRole('link', { name: '查看真实解释执行', exact: true }).click();
  await expect(page.getByTestId('case-execution')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: '运行示例', exact: true }).click();
  await expect(page.getByTestId('execution-terminal')).toContainText('程序正常结束');
  const execution = await page.evaluate(() => {
    const worker = window.__verticalObservation.workers.findLast(
      (worker) => worker.kind === 'execute' && worker.responseOk,
    );
    if (!worker) throw new Error('Real execution missing');
    return {
      request: worker.requestBytes,
      result: worker.responseBytes,
      moduleSeen: worker.moduleSeen,
    };
  });
  const real = {
    request: JSON.parse(Buffer.from(execution.request!).toString('utf8')),
    result: JSON.parse(Buffer.from(execution.result!).toString('utf8')),
    moduleSeen: execution.moduleSeen,
  };
  expect(real.result.producer).toBe('rust');
  expect(real.result.terminal.status).toBe('completed');
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/real-execution.json`, JSON.stringify(real, null, 2));
  expect(
    await page.evaluate(() =>
      window.__verticalObservation.workers.some(
        (worker) => worker.kind === 'execute' && worker.responseOk && worker.moduleSeen,
      ),
    ),
  ).toBe(true);
  await page.goBack();
  await ready(page);
  await page.getByRole('link', { name: '在练习中查看真实诊断', exact: true }).click();
  await expect(page).toHaveURL(/#\/practice\/exercise\.c6\.s2\.1$/);
  await expect(page.getByLabel('完整 C 源码 · main.c', { exact: true })).toBeEditable();
  // New context: fail only this new page's actual lazy resource, then reload without the fault.
  const isolated = await page.context().browser()!.newContext();
  try {
    const broken = await isolated.newPage();
    await broken.route('**/assets/CompilationPage-*.js', (route) => route.abort());
    await broken.goto(new URL('/#/compilation', page.url()).href);
    await expect(broken.getByRole('heading', { name: '页面加载失败', exact: true })).toBeVisible();
    await broken.unroute('**/assets/CompilationPage-*.js');
    await broken.getByRole('button', { name: '重新加载', exact: true }).click();
    await ready(broken);
  } finally {
    await isolated.close();
  }
});
