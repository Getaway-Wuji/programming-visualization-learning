/* global document, window */
// Exploratory production measurements. Prepared runs are explicitly warmModule.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { performanceCases } from './performance-workloads.mjs';
import { installPerformanceObserver, readPerformanceAudit } from './performance-observer.mjs';
import { workspaceDir } from './process.mjs';
import { startPerformanceServer } from './serve-performance.mjs';

const origin = 'https://127.0.0.1:4190';
const browserName = process.env.PERF_BROWSER ?? 'chrome';
const label = process.env.PERF_LABEL ?? 'pilot-before';
assert.match(label, /^[a-z0-9-]+$/);
const output = join(workspaceDir, '.artifacts/11.4', label);
assert.ok(!existsSync(output), 'Use a new PERF_LABEL; previous measurements are immutable');
mkdirSync(output);
const service = await startPerformanceServer({ logPrefix: `.artifacts/11.4/${label}/network` });
const browser = await chromium.launch({
  channel: browserName === 'edge' ? 'msedge' : 'chrome',
  headless: false,
  args: ['--disable-extensions', '--force-device-scale-factor=1'],
});
const report = {
  evidenceLevel: 'exploratory-not-formal-coldModule',
  browser: browserName,
  version: browser.version(),
  cases: [],
};
try {
  for (const key of ['assignment-negative', 'bubble-sort-maximum', 'selection-sort-maximum']) {
    const sample = performanceCases.find((entry) => entry.key === key);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    await context.addInitScript(installPerformanceObserver);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await page.goto(`${origin}/#/visualize/${sample.caseId}`);
    await page.getByTestId('input-panel').waitFor();
    for (const [name, value] of Object.entries(sample.values))
      await page
        .getByTestId(`input-field-${name}`)
        .fill(Array.isArray(value) ? (value.length ? value.join(', ') : '[]') : String(value));
    const panel = page.getByTestId('case-execution');
    await panel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
    await page.waitForFunction(
      () =>
        ['ready', 'failed'].includes(
          document.querySelector('[data-testid="case-execution"]')?.getAttribute('data-state'),
        ),
      null,
      { timeout: 5000 },
    );
    if ((await panel.getAttribute('data-state')) === 'ready') {
      for (let repeat = 0; repeat < 3; repeat++) {
        await panel.getByRole('button', { name: '运行示例', exact: true }).click();
        await page.waitForFunction(
          () => window.__performanceAudit.intents.at(-1)?.end !== null,
          null,
          { timeout: 5000 },
        );
        await page.evaluate(readPerformanceAudit);
      }
    }
    const audit = await page.evaluate(readPerformanceAudit);
    report.cases.push({
      key,
      audit,
      finalState: await panel.getAttribute('data-state'),
      outputMatches:
        (await page
          .getByTestId('execution-output')
          .textContent()
          .catch(() => '')) === sample.stdout,
    });
    await page.screenshot({ path: join(output, `${key}.png`), fullPage: true });
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        key,
        state: report.cases.at(-1).finalState,
        intents: audit.intents.map((entry) => ({
          label: entry.label,
          ms: entry.end - entry.at,
          state: entry.state,
        })),
        workers: audit.workers.map((entry) => ({
          kind: entry.kind,
          ms: entry.receivedAt - entry.sentAt,
          bytes: entry.responseBytes,
          stats: entry.stats,
        })),
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
  await service.stop();
}
