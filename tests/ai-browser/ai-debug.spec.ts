import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  enable,
  evidence,
  instrumentation,
  native,
  preview,
  send,
  settings,
  workbench,
} from './helpers';
const sources = {
  pointer:
    '#include <stdio.h>\nint main(){int *p=0;int value=*p;printf("%d\\n",value);return 0;}\n',
  loop: '#include <stdio.h>\nint main(){int sum=0;for(int i=0;i<3;i=i+1){sum=sum+i;}printf("%d",sum);return 0;}\n',
  syntax: 'int main( { return 0; }',
};
test('actual browser same-origin headers reach the production gateway; no-Key request is rejected before any provider call', async ({
  page,
}) => {
  await page.goto('/#/settings?panel=ai');
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/ai/v2/verify', {
      method: 'POST',
      mode: 'same-origin',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aiVersion: '2.0.0',
        kind: 'config.check',
        requestId: crypto.randomUUID(),
        configRevision: crypto.randomUUID(),
        provider: { providerId: 'openai', model: 'gpt-5.4-mini-2026-03-17' },
      }),
    });
    return { status: response.status, packet: await response.json() };
  });
  expect(result).toEqual({ status: 400, packet: { code: 'E_AI_PROTOCOL_INVALID' } });
});
test('default off and missing Key make no verification/inference request; ordinary C remains usable', async ({
  page,
}, info) => {
  const c = await instrumentation(page);
  await settings(page);
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('combobox', { name: 'AI服务', exact: true })).toHaveValue('');
  await page.getByRole('switch').click();
  await expect(page.locator('.ai-settings [role=alert]')).toContainText('请选择');
  expect(c.verifies).toBe(0);
  await page.getByRole('link', { name: 'C 代码工作台', exact: true }).click();
  await page.getByRole('textbox', { name: 'C 代码', exact: true }).fill(sources.loop);
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-status', 'ready');
  expect(c.requests).toHaveLength(0);
  await evidence(page, c, info);
});
test('an unverified typed Key is discarded on full navigation, refresh and browser back', async ({
  page,
}, info) => {
  const c = await instrumentation(page);
  await settings(page);
  await page.getByLabel('你自己的API Key', { exact: true }).fill('DESIGN_ONLY_NOT_A_REAL_KEY');
  await page.goto('/?ai-lifecycle=1#/settings?panel=ai');
  await expect(page.getByLabel('你自己的API Key', { exact: true })).toHaveValue('');
  await page.goBack();
  await expect(page.getByLabel('你自己的API Key', { exact: true })).toHaveValue('');
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  expect(c.verifies).toBe(0);
  expect(c.requests).toHaveLength(0);
  await evidence(page, c, info);
});
for (const kind of ['pointer', 'loop', 'syntax'] as const)
  test(`actual Rust ${kind}, exact preview and simulated API references, never a real AI answer`, async ({
    page,
  }, info) => {
    const c = await instrumentation(page);
    await enable(page);
    await workbench(page, sources[kind]);
    await preview(page);
    expect(c.requests).toHaveLength(0);
    if (kind === 'syntax')
      await expect(page.getByText('本次语法或前置检查没有轨迹', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '确认并发送本次内容', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI解释', exact: true })).toBeVisible();
    expect(c.requests).toHaveLength(1);
    const req = c.requests[0];
    if (kind === 'loop')
      expect(
        req.context.facts.some(
          (f) => f.kind === 'state' && f.name === 'sum' && f.value === 3 && f.alive,
        ),
      ).toBe(true);
    expect(req.context.runRef.language).toBe('c');
    expect(req.context.snippets.map((s) => s.text).join('')).toContain(
      kind === 'syntax' ? 'int main' : 'int main',
    );
    expect(req.context.facts.length).toBeGreaterThan(0);
    if (kind === 'syntax') {
      expect(req.context.traceAvailable).toBe(false);
      expect(req.context.facts.every((f) => f.kind === 'diagnostic')).toBe(true);
      await expect(page.getByRole('button', { name: /查看真实步骤/ })).toHaveCount(0);
      await page.getByRole('button', { name: '查看真实诊断源码', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'C 代码', exact: true })).toBeFocused();
    } else {
      const step = req.context.facts.find((f) => f.kind === 'step');
      expect(step).toBeDefined();
      if (step?.kind === 'step') {
        await page.getByRole('button', { name: `查看真实步骤 ${step.step}`, exact: true }).click();
        await expect(page.getByTestId('custom-code-page')).toHaveAttribute(
          'data-cursor',
          String(step.step),
        );
      }
    }
    await evidence(page, c, info);
  });
for (const mode of ['auth', 'quota', 'rate', 'badref', 'stale', 'blank'] as const)
  test(`simulated ${mode} failure has fixed fallback and real execution still works`, async ({
    page,
  }, info) => {
    const c = await instrumentation(page);
    await enable(page, 'deepseek');
    await workbench(page, sources.pointer);
    c.mode = mode;
    await send(page);
    await expect(page.locator('.ai-panel [role=alert]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'AI解释', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '运行代码', exact: true }).click();
    await expect(page.getByTestId('custom-code-page')).toHaveAttribute('data-status', 'ready');
    expect(c.requests).toHaveLength(1);
    await evidence(page, c, info);
  });
test('simulated HTML answer is plain text and never loads an image or URL', async ({
  page,
}, info) => {
  const c = await instrumentation(page);
  await enable(page);
  await workbench(page, sources.loop);
  c.mode = 'html';
  await send(page);
  await expect(page.locator('.ai-answer')).toContainText('<img src=');
  await expect(page.locator('.ai-answer img')).toHaveCount(0);
  await evidence(page, c, info);
});
for (const action of ['cancel', 'source', 'input', 'cursor'] as const)
  test(`${action} invalidates an in-flight simulated answer`, async ({ page }, info) => {
    const c = await instrumentation(page);
    await enable(page);
    await workbench(page, sources.loop);
    c.mode = 'delay';
    c.delay = 700;
    await send(page);
    await expect(page.getByText('正在等待OpenAI解释', { exact: false })).toBeVisible();
    if (action === 'cancel')
      await page.getByRole('button', { name: '取消本端等待', exact: true }).click();
    else if (action === 'source') {
      await page.getByRole('button', { name: '编辑代码', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'C 代码', exact: true })
        .fill('int main(){return 0;}');
    } else if (action === 'input')
      await page.getByRole('textbox', { name: '整数输入', exact: true }).fill('8');
    else await page.getByRole('button', { name: '后退', exact: true }).click();
    await expect(page.getByRole('heading', { name: '确认本次发送内容', exact: true })).toHaveCount(
      0,
    );
    await page.waitForTimeout(800);
    await expect(page.getByRole('heading', { name: 'AI解释', exact: true })).toHaveCount(0);
    await evidence(page, c, info);
  });
test('refresh and leaving the workbench discard all AI configuration', async ({ page }, info) => {
  const c = await instrumentation(page);
  await enable(page);
  await workbench(page, sources.loop);
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: 'AI解释（可选）', exact: true }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await enable(page);
  await page.reload();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('combobox', { name: 'AI服务', exact: true })).toHaveValue('');
  await evidence(page, c, info);
});
test('正式存储: AI configuration, real execution, simulated explanation and close preserve native DB9 rows/keys and all browser storage', async ({
  page,
}, info) => {
  const c = await instrumentation(page);
  await settings(page);
  await expect(page.getByTestId('learning-save-status')).toHaveAttribute(
    'data-save-status',
    'ready',
  );
  const before = await native(page);
  const db = before.databases['c-viz-learning'] as { version: number; names: string[] };
  expect(db.version).toBe(9);
  expect(db.names).toHaveLength(17);
  await enable(page);
  await workbench(page, sources.loop);
  await send(page);
  await expect(page.locator('.ai-answer')).toBeVisible();
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: 'AI解释（可选）', exact: true }).click();
  const after = await native(page);
  expect(after).toEqual(before);
  await writeFile(
    info.outputPath('native-db9-before-after.json'),
    JSON.stringify({ before, after }, null, 2),
  );
  await evidence(page, c, info);
});
test('正式存储: two tabs never share Key, and clearing learning data in another tab closes the configured tab', async ({
  page,
  context,
}, info) => {
  const c = await instrumentation(page);
  await enable(page);
  const second = await context.newPage();
  await instrumentation(second);
  await settings(second);
  await expect(second.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(second.getByLabel('你自己的API Key', { exact: true })).toHaveValue('');
  await second.getByRole('tab', { name: '本地数据', exact: true }).click();
  await second.getByRole('button', { name: '清除本地数据', exact: true }).click();
  await second.getByRole('button', { name: '确认清除', exact: true }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('combobox', { name: 'AI服务', exact: true })).toHaveValue('');
  await evidence(page, c, info);
});
for (const width of [1440, 768, 390])
  test(`AI settings keyboard and layout at ${width}px`, async ({ page }, info) => {
    const c = await instrumentation(page);
    await page.setViewportSize({ width, height: 900 });
    await settings(page);
    await expect(page.getByRole('combobox', { name: 'AI服务', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'AI服务', exact: true }).focus();
    await expect(page.getByRole('combobox', { name: 'AI服务', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`settings-${width}.png`), fullPage: true });
    await evidence(page, c, info);
  });
