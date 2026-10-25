import { expect, test } from '@playwright/test';
import type { ProbeResult } from './harness/types';

test('production React entry renders without loading the engine', async ({
  page,
  browser,
}, testInfo) => {
  const engineRequests: string[] = [];
  page.on('request', (request) => {
    if (/\.wasm(?:\?|$)|probe\.worker/.test(request.url())) engineRequests.push(request.url());
  });
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['content-type']).toMatch(/text\/html/);
  expect(response?.headers()['cache-control']).toBe('no-cache');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('让每一步，都看得明白。');
  await expect(page.getByText('本地学习', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /登录|注册/ })).toHaveCount(0);
  expect(engineRequests).toEqual([]);
  await testInfo.attach('browser-version', { body: browser.version(), contentType: 'text/plain' });
  await page.screenshot({ path: testInfo.outputPath('react-entry.png'), fullPage: true });
});

test('cold and warm Module runs call real Rust in fresh workers', async ({
  page,
  browser,
  request,
}, testInfo) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const wasmRequests: string[] = [];
  page.on('request', (entry) => {
    if (/\.wasm(?:\?|$)/.test(entry.url())) wasmRequests.push(entry.url());
  });
  const response = await page.goto('/checks/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['cache-control']).toBe('no-cache');
  await expect(page.getByRole('status')).toHaveText('内部检查入口已就绪；引擎按需加载。');
  expect(wasmRequests).toEqual([]);

  const cold: ProbeResult = await page.evaluate(() => window.runBuildProbe({ nonce: 73 }));
  const coldRequestCount = wasmRequests.length;
  const warm: ProbeResult = await page.evaluate(() =>
    window.runBuildProbe({ nonce: 0xffffffff, warm: true }),
  );
  expect(wasmRequests).toHaveLength(coldRequestCount);
  expect(coldRequestCount).toBeGreaterThan(0);
  expect(cold.moduleMode).toBe('cold');
  expect(warm.moduleMode).toBe('warm');
  expect(cold.workerId).toBe(1);
  expect(warm.workerId).toBe(2);
  expect(warm.workerInstanceId).not.toBe(cold.workerInstanceId);
  expect(warm.timings.fetchMs).toBe(0);
  expect(warm.timings.compileMs).toBe(0);

  for (const [probeResult, nonce] of [
    [cold, 73],
    [warm, 0xffffffff],
  ] as const) {
    expect(probeResult.probe).toEqual({
      kind: 'build-probe',
      probeVersion: '1.0.0',
      nonce,
      engineVersion: '0.1.0',
      interpreterReady: false,
    });
    expect(probeResult.terminated).toBe(true);
    expect(probeResult.bufferBytes).toBeGreaterThan(0);
    expect(probeResult.bufferBytes).toBeLessThan(1024);
    expect(probeResult.memory.maximumPages).toBe(2048);
    expect(probeResult.memory.currentPages).toBeGreaterThan(0);
    expect(probeResult.memory.currentPages).toBeLessThanOrEqual(2048);
    expect(probeResult.memory.growBeyondMaximumRejected).toBe(true);
    expect(probeResult.mimeType).toMatch(/^application\/wasm(?:;|$)/i);
    expect(
      probeResult.imports.some((entry) => /wasi|shared/i.test(`${entry.module}/${entry.name}`)),
    ).toBe(false);
    expect(
      probeResult.exports.some(
        (entry) => entry.kind === 'function' && entry.name === 'build_probe',
      ),
    ).toBe(true);
    for (const duration of Object.values(probeResult.timings)) {
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(0);
    }
  }

  const wasm = await request.get(cold.wasmUrl);
  expect(wasm.status()).toBe(200);
  expect(wasm.headers()['content-type']).toMatch(/^application\/wasm(?:;|$)/i);
  expect(wasm.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(cold.wasmUrl).toMatch(/\/checks\/assets\/[^/]+-[a-zA-Z0-9_-]+\.wasm$/);
  const javascriptAssets = await page
    .locator('script[src]')
    .evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).src));
  expect(javascriptAssets.length).toBeGreaterThan(0);
  for (const assetUrl of javascriptAssets) {
    const asset = await request.get(assetUrl);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['content-type']).toMatch(/(?:text|application)\/javascript/);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  }
  expect(failures).toEqual([]);
  await testInfo.attach('browser-version', { body: browser.version(), contentType: 'text/plain' });
  await testInfo.attach('build-probe-measurements', {
    body: JSON.stringify({ cold, warm }, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: testInfo.outputPath('build-probe.png'), fullPage: true });
});

test('missing WASM rejects and a later cold run recovers', async ({ page, request }) => {
  await page.goto('/checks/');
  await expect(page.getByRole('status')).toHaveText('内部检查入口已就绪；引擎按需加载。');
  const failure = await page.evaluate(async () => {
    try {
      await window.runBuildProbe({ nonce: 91, missing: true });
      return { rejected: false, message: '' };
    } catch (error) {
      return { rejected: true, message: error instanceof Error ? error.message : String(error) };
    }
  });
  expect(failure.rejected).toBe(true);
  expect(failure.message).toBe('WASM 资源加载失败（HTTP 404）。');
  await expect(page.getByRole('status')).toHaveText(failure.message);
  await expect(page.locator('#probe-result')).toHaveText('');
  const missing = await request.get('/checks/missing-engine.wasm');
  expect(missing.status()).toBe(404);
  const recovered = await page.evaluate(() => window.runBuildProbe({ nonce: 92 }));
  expect(recovered.probe.nonce).toBe(92);
  expect(recovered.workerId).toBe(1);
  expect(recovered.terminated).toBe(true);
});
