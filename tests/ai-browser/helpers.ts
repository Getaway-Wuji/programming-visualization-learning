import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { AiRequest, AiResponse } from '../../web/src/ai-debug/protocol';
export const sentinel = 'DESIGN_ONLY_NOT_A_REAL_KEY';
export const models = { openai: 'gpt-5.4-mini-2026-03-17', deepseek: 'deepseek-flash' };
export interface Controls {
  requests: AiRequest[];
  verifies: number;
  mode: 'ok' | 'auth' | 'quota' | 'rate' | 'badref' | 'stale' | 'blank' | 'html' | 'delay';
  delay: number;
  consoleErrors: string[];
  external: string[];
}
export async function instrumentation(page: Page): Promise<Controls> {
  const controls: Controls = {
    requests: [],
    verifies: 0,
    mode: 'ok',
    delay: 150,
    consoleErrors: [],
    external: [],
  };
  page.on('pageerror', (error) => controls.consoleErrors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4194/')) controls.external.push(request.url());
  });
  await page.addInitScript(() => {
    const target = window as Window & { __aiRust?: unknown[] };
    target.__aiRust = [];
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event) => {
          const value = event.data;
          if (value?.buffer instanceof ArrayBuffer && value.ok === true)
            target.__aiRust!.push({
              kind: 'result',
              raw: new TextDecoder().decode(value.buffer),
              wasmPages: value.wasmPages,
            });
        });
      }
      override postMessage(value: unknown, options?: Transferable[] | StructuredSerializeOptions) {
        const message = value as { buildId?: string; buffer?: ArrayBuffer };
        if (
          message?.buildId === 'ec2a4c3390303b3575d1ae29f77f122ce499ca235a560ee50159968e24fe30db' &&
          message.buffer instanceof ArrayBuffer
        )
          target.__aiRust!.push({
            kind: 'request',
            raw: new TextDecoder().decode(message.buffer),
            buildId: message.buildId,
          });
        if (Array.isArray(options)) super.postMessage(value, options);
        else super.postMessage(value, options);
      }
    };
  });
  // Every POST is intercepted. No sentinel is ever sent to a real service or proxy.
  await page.route('**/api/ai/v2/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    expect(request.headers()['x-cviz-api-key']).toBe(sentinel);
    expect(request.postData()).not.toContain(sentinel);
    const body = request.postDataJSON();
    if (request.url().endsWith('/verify')) {
      controls.verifies++;
      expect(body).not.toHaveProperty('context');
      await route.fulfill({
        json: { ...body, kind: 'config.checked', verified: true, code: null },
      });
      return;
    }
    controls.requests.push(body as AiRequest);
    if (controls.mode === 'delay')
      await new Promise((resolve) => setTimeout(resolve, controls.delay));
    if (controls.mode === 'auth' || controls.mode === 'quota' || controls.mode === 'rate') {
      await route.fulfill({
        status: controls.mode === 'auth' ? 401 : 429,
        json: {
          code:
            controls.mode === 'auth'
              ? 'E_AI_AUTH'
              : controls.mode === 'quota'
                ? 'E_AI_QUOTA'
                : 'E_AI_RATE_LIMIT',
        },
      });
      return;
    }
    if (controls.mode === 'blank') {
      await route.fulfill({ contentType: 'application/json', body: ' ' });
      return;
    }
    await route.fulfill({ json: simulatedResponse(body, controls.mode) });
  });
  return controls;
}
export function simulatedResponse(request: AiRequest, mode = 'ok'): AiResponse {
  const fact = request.context.facts.find((f) => f.kind === 'step') ?? request.context.facts[0];
  return {
    aiVersion: '2.0.0',
    kind: 'explain.response',
    requestId: request.requestId,
    configRevision:
      mode === 'stale' ? '11111111-1111-4111-8111-111111111111' : request.configRevision,
    confirmationId: request.confirmationId,
    contextId: request.context.contextId,
    runRef: request.context.runRef,
    inputRevision: request.context.inputRevision,
    cursor: request.context.cursor,
    producer: 'provider-api-adapter',
    provider: {
      providerId: request.provider.providerId,
      configVersion: '2.0.0',
      requestedModel: request.provider.model,
      returnedModel: request.provider.model,
    },
    content: {
      summary:
        mode === 'html'
          ? '<img src="https://must-not-fetch.invalid/test">模拟返回，仅验证纯文本显示。'
          : '模拟返回，仅验证接口与引用；不是实际模型解释。',
      explanations: [
        {
          factIds: [mode === 'badref' ? 'f12' : fact.factId],
          text: '此处只验证已提供事实的定位能力，不代表AI质量验收。',
        },
      ],
      suggestions: ['模拟建议，未经执行验证。'],
      limitations: '本测试没有调用官方API。',
    },
    timing: { elapsedMs: 1 },
  };
}
export async function settings(page: Page) {
  await page.goto('/#/settings?panel=ai');
  await expect(page.getByRole('heading', { name: 'AI解释（可选）', exact: true })).toBeVisible();
  await expect(page.getByTestId('learning-save-status')).not.toHaveAttribute(
    'data-save-status',
    'loading',
  );
}
export async function enable(page: Page, provider: 'openai' | 'deepseek' = 'openai') {
  await settings(page);
  await page.getByRole('combobox', { name: 'AI服务', exact: true }).selectOption(provider);
  await page.getByRole('combobox', { name: 'AI模型', exact: true }).selectOption(models[provider]);
  await page.getByLabel('你自己的API Key', { exact: true }).fill(sentinel);
  await page.getByRole('switch', { name: '验证并开启AI解释' }).click();
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('你自己的API Key', { exact: true })).toHaveValue('');
}
export async function workbench(page: Page, source: string) {
  await page.getByRole('link', { name: '前往C代码工作台', exact: true }).click();
  await expect(page.getByTestId('custom-code-page')).toBeVisible();
  await page.getByRole('textbox', { name: 'C 代码', exact: true }).fill(source);
  await page.getByRole('button', { name: '运行代码', exact: true }).click();
  await expect(page.getByTestId('custom-code-page')).toHaveAttribute(
    'data-status',
    /ready|rejected/,
  );
  const slider = page.getByRole('slider', { name: '执行步骤', exact: true });
  if (await slider.isEnabled()) await slider.fill((await slider.getAttribute('max'))!);
  if (source.includes('sum')) {
    const output = await page.evaluate(() => {
      const packets =
        (window as Window & { __aiRust?: { kind: string; raw: string }[] }).__aiRust ?? [];
      const packet = packets.findLast((p) => p.kind === 'result');
      const result = packet ? JSON.parse(packet.raw) : null;
      return (
        result?.trace?.steps.findLast((step: { kind: string }) => step.kind === 'output.append')
          ?.seq ?? null
      );
    });
    if (output !== null) await slider.fill(String(output));
  }
}
export async function preview(page: Page) {
  await page.getByRole('button', { name: '预览本次AI请求', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认本次发送内容', exact: true })).toBeVisible();
}
export async function send(page: Page) {
  await preview(page);
  await page.getByRole('button', { name: '确认并发送本次内容', exact: true }).click();
}
export async function native(page: Page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases(),
      result: Record<string, unknown> = {};
    for (const info of databases) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const names = Array.from(db.objectStoreNames).sort(),
        rows: Record<string, unknown> = {};
      if (names.length)
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(names, 'readonly');
          for (const name of names) {
            const store = tx.objectStore(name),
              all = store.getAll(),
              keys = store.getAllKeys();
            all.onsuccess = () => {
              rows[name] = { rows: all.result, keys: [] };
            };
            keys.onsuccess = () => {
              (rows[name] as { keys: unknown[] }).keys = keys.result;
            };
          }
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      result[info.name] = { version: db.version, names, rows };
      db.close();
    }
    return {
      databases: result,
      local: Object.fromEntries(Object.entries(localStorage).sort()),
      session: Object.fromEntries(Object.entries(sessionStorage).sort()),
    };
  });
}
export async function evidence(page: Page, controls: Controls, info: TestInfo) {
  const workers = await page.evaluate(
    () => (window as Window & { __aiRust?: unknown[] }).__aiRust ?? [],
  );
  const record = {
    label: 'PUBLIC AUTHORED C / ACTUAL RUST; AI ANSWERS SIMULATED, NO OFFICIAL API CALL',
    credentialCalls: 0,
    modelCalls: 0,
    workerPackets: workers,
    aiRequests: controls.requests,
    simulatedVerifications: controls.verifies,
    sensitiveHeaderValuesRecorded: false,
    consoleErrors: controls.consoleErrors,
    externalBrowserRequests: controls.external,
  };
  expect(controls.consoleErrors).toEqual([]);
  expect(controls.external).toEqual([]);
  expect(JSON.stringify(record)).not.toContain(sentinel);
  await writeFile(
    info.outputPath('actual-rust-and-simulated-api.json'),
    JSON.stringify(record, null, 2),
  );
}
