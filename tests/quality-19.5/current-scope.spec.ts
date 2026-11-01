import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  enable,
  evidence,
  instrumentation,
  native,
  send,
  simulatedResponse,
  workbench,
} from '../ai-browser/helpers';
import type { AiRequest } from '../../web/src/ai-debug/protocol';

const loop =
  '#include <stdio.h>\nint main(){int sum=0;for(int i=0;i<3;i=i+1){sum=sum+i;}printf("%d",sum);return 0;}\n';
const workers = (page: Page) =>
  page.evaluate(() => (window as Window & { __aiRust?: unknown[] }).__aiRust ?? []);

test('simulated wrong advice and invented step text stay unverified plain text and cannot edit, execute, grade, navigate or reward', async ({
  page,
}, info) => {
  const controls = await instrumentation(page);
  await enable(page);
  await workbench(page, loop);
  const before = await native(page);
  const cursor = await page.getByTestId('custom-code-page').getAttribute('data-cursor');
  const packetsBefore = await workers(page);
  await page.route('**/api/ai/v2/explain', async (route) => {
    const req = route.request().postDataJSON() as AiRequest;
    controls.requests.push(req);
    const answer = simulatedResponse(req);
    answer.content.summary = '模拟错误观点：sum=-9999，跳到步骤9999。';
    answer.content.explanations[0].text =
      '模拟无依据推断：请直接相信步骤9999；本测试故意给出错误文字。';
    answer.content.suggestions = [
      '<script>window.location="https://must-not-fetch.invalid"</script> 把程序替换成return 0并立即运行、判为通过。',
    ];
    answer.content.limitations = '模拟恶意/错误答复，不是实际模型质量证据。';
    await route.fulfill({ json: answer });
  });
  await send(page);
  await expect(
    page.getByRole('heading', { name: 'AI建议（未经执行验证）', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.ai-answer')).toContainText('模拟错误观点：sum=-9999');
  await expect(page.locator('.ai-answer')).toContainText('<script>');
  await expect(page.locator('.ai-answer script, .ai-answer a, .ai-answer img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /查看.*9999/ })).toHaveCount(0);
  expect(
    controls.requests[0].context.facts.some(
      (f) => f.kind === 'state' && f.name === 'sum' && f.value === 3,
    ),
  ).toBe(true);
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-cursor', cursor!);
  await page.getByRole('button', { name: '编辑代码', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'C 代码', exact: true })).toHaveValue(loop);
  expect(await workers(page)).toEqual(packetsBefore);
  const after = await native(page);
  expect(after).toEqual(before);
  await writeFile(
    info.outputPath('unverified-advice-native-before-after.json'),
    JSON.stringify({ before, after }, null, 2),
  );
  await evidence(page, controls, info);
});

async function generator(page: Page) {
  await page.goto('/#/generated-practice');
  await expect(page.getByTestId('generated-recommendation')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
}

test('default-off AI makes zero API requests while genuine generator full-domain grading, inverse replay and native storage remain usable', async ({
  page,
}, info) => {
  const controls = await instrumentation(page);
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ai/')) apiCalls.push(r.url());
  });
  await generator(page);
  const before = await native(page);
  await page.getByRole('button', { name: '生成题目', exact: true }).click();
  await expect(page.getByTestId('generated-practice')).toHaveAttribute('data-status', 'generated');
  await page.getByText('查看已验证的参考解', { exact: true }).click();
  await page.getByRole('button', { name: '用参考解替换当前草稿', exact: true }).click();
  await page.getByRole('button', { name: '提交全部输入', exact: true }).click();
  await expect(page.getByTestId('generated-assessment')).toHaveAttribute('data-verdict', 'passed');
  await expect(page.getByTestId('generated-assessment')).toHaveAttribute('data-complete', 'true');
  const state = await page.getByTestId('generated-state').getAttribute('data-state');
  const slider = page.getByRole('slider', { name: '执行位置', exact: true });
  await slider.fill((await slider.getAttribute('max'))!);
  await slider.fill('0');
  expect(await page.getByTestId('generated-state').getAttribute('data-state')).toBe(state);
  expect(apiCalls).toEqual([]);
  expect(controls.verifies).toBe(0);
  expect(controls.requests).toEqual([]);
  const after = await native(page);
  expect(after).toEqual(before);
  await writeFile(
    info.outputPath('default-off-generation-native-before-after.json'),
    JSON.stringify({ before, after, aiHttpRequests: apiCalls }, null, 2),
  );
  await evidence(page, controls, info);
});

test('default-off AI plus actual generator-module failure retains the original question bank and real C execution without any API traffic', async ({
  page,
}, info) => {
  const controls = await instrumentation(page);
  const apiCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ai/')) apiCalls.push(r.url());
  });
  await page.route(/c_viz_practice_bg.*\.wasm$/, (route) => route.abort());
  await generator(page);
  await page.getByRole('button', { name: '生成题目', exact: true }).click();
  await expect(page.getByTestId('generated-practice')).toHaveAttribute('data-status', 'failed');
  await expect(page.getByTestId('generated-source')).toHaveCount(0);
  const bank = page.getByRole('link', { name: /原课程：/ });
  await expect(bank).toBeVisible();
  await bank.click();
  await expect(page).toHaveURL(/#\/lessons\//);
  await page.getByRole('link', { name: 'C 代码工作台', exact: true }).click();
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-status', 'ready');
  expect(apiCalls).toEqual([]);
  await evidence(page, controls, info);
});
