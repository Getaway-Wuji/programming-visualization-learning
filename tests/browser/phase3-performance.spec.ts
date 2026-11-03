/* eslint-disable @typescript-eslint/no-explicit-any -- Passive CDP/Worker measurements have variable technical metadata. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { installPhase2Probe, readPhase2Probe } from './phase2-performance-probe';
import { waitForPhase2Archive } from './phase2-ready';
import {
  capturePerformanceHost,
  qualifyPerformanceHost,
} from '../../scripts/phase2-performance-host.mjs';

const output = `.artifacts/11.4/${process.env.TASK_EVIDENCE_LABEL}/p2`;
const descending = Array.from({ length: 30 }, (_, i) => 30 - i);
const definitions = [
  {
    id: 'custom-c30',
    route: '/custom-code',
    root: '[data-testid="custom-code-page"]',
    stateAttribute: 'data-status',
    runLabel: '运行代码',
    slider: 'input[aria-label="执行步骤"]',
    input: descending,
    stdout: '465',
    language: 'c',
  },
  {
    id: 'strict-lis30',
    route: '/advanced/algorithms/case.cpp.strict-lis',
    root: '[data-testid="advanced-algorithm-workspace"]',
    stateAttribute: 'data-state',
    runLabel: '运行C++算法',
    slider: 'input[aria-label="算法执行步骤"]',
    input: descending,
    stdout: '1\n',
    language: 'cpp',
  },
  {
    id: 'kmp30',
    route: '/advanced/algorithms/case.cpp.kmp',
    root: '[data-testid="kmp-workspace"]',
    stateAttribute: 'data-state',
    runLabel: '运行C++ KMP',
    slider: 'input[aria-label="算法执行步骤"]',
    input: ['a'.repeat(29) + 'b', 'a'.repeat(29) + 'c'],
    stdout: '-1\n',
    language: 'cpp',
  },
] as const;
const navigation = [
  ['/custom-code', '[data-testid="custom-code-page"]'],
  ['/advanced/algorithms/case.cpp.strict-lis', '[data-testid="advanced-algorithm-workspace"]'],
  ['/generated-practice', '[data-testid="generated-recommendation"][data-state="ready"]'],
  ['/weaknesses', '[data-testid="weakness-status"][data-state="ready"]'],
  ['/study-notes', '.note-filter-fields select'],
] as const;

async function prepare(page: Page, d: (typeof definitions)[number]) {
  await page.goto('/#' + d.route);
  await waitForPhase2Archive(page);
  if (d.id === 'custom-c30') {
    await page.getByRole('button', { name: '编辑代码', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'C 代码', exact: true })
      .fill(
        '#include <stdio.h>\nint main(){int a[30];int sum=0;for(int i=0;i<30;i=i+1){scanf("%d",&a[i]);sum=sum+a[i];}printf("%d",sum);return 0;}',
      );
    await page.getByRole('textbox', { name: '整数输入', exact: true }).fill(descending.join(' '));
  } else if (d.id === 'strict-lis30') {
    await page.getByTestId('algorithm-input').fill(descending.join(' '));
  } else {
    await page.getByTestId('kmp-text-input').fill(d.input[0]);
    await page.getByTestId('kmp-pattern-input').fill(d.input[1]);
  }
  await page.evaluate((definition) => {
    (window as any).phase2Perf.configuration = { ...definition, terminalStates: ['ready'] };
  }, d);
}

test('P2 current entry pages and maximum supported interactive workloads keep qualified timings and original deadlines', async ({
  browser,
}) => {
  test.setTimeout(600000);
  mkdirSync(output, { recursive: true });
  const report: any = {
    task: '20.4',
    registration: '1.0.79',
    method:
      '11.4 shared aggregate 20/5Mbps, 40ms RTT, Brotli HTTPS; trusted click to full accepted result plus two animation frames',
    navigation: [],
    execution: [],
    failures: [],
    hostStart: capturePerformanceHost(output, 'start'),
  };
  try {
    for (const [route, selector] of navigation)
      for (let index = 1; index <= 5; index++) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          serviceWorkers: 'block',
        });
        try {
          for (const mode of ['cold', 'warm']) {
            const page = await context.newPage();
            await page.bringToFront();
            await page.addInitScript((selector) => {
              const scope = window as any;
              scope.p3Entry = null;
              const inspect = () => {
                const shell = document.querySelector('.app-shell');
                if (
                  scope.p3Entry !== null ||
                  !document.querySelector(selector) ||
                  shell?.getAttribute('data-learning-storage-status') !== 'ready' ||
                  shell?.getAttribute('data-learning-reading-status') !== 'ready' ||
                  shell?.getAttribute('data-learning-practice-status') !== 'ready'
                )
                  return;
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    if (scope.p3Entry === null)
                      scope.p3Entry = {
                        elapsedMs: performance.now(),
                        visibility: document.visibilityState,
                        focus: document.hasFocus(),
                      };
                  }),
                );
              };
              document.addEventListener('DOMContentLoaded', () => {
                new MutationObserver(inspect).observe(document.documentElement, {
                  subtree: true,
                  childList: true,
                  attributes: true,
                });
                inspect();
              });
            }, selector);
            await page.goto('/#' + route);
            await page.waitForFunction(() => (window as any).p3Entry !== null, null, {
              timeout: 10000,
            });
            const sample = await page.evaluate(() => ({
              ...(window as any).p3Entry,
              resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
            }));
            report.navigation.push({
              route,
              index,
              mode,
              ...sample,
              passed: sample.elapsedMs <= 2000 && sample.visibility === 'visible' && sample.focus,
            });
            await page.close();
          }
        } catch (error) {
          report.failures.push({ route, index, error: String(error) });
        } finally {
          await context.close();
        }
      }
    for (const d of definitions)
      for (let index = 1; index <= 10; index++) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          serviceWorkers: 'block',
        });
        try {
          const page = await context.newPage();
          await page.bringToFront();
          await page.addInitScript(installPhase2Probe);
          await prepare(page, d);
          for (const mode of ['cold-module', 'warm-module']) {
            const before = await page.evaluate(readPhase2Probe, false);
            await page.getByRole('button', { name: d.runLabel, exact: true }).click();
            await expect(page.locator(d.root)).toHaveAttribute(d.stateAttribute, 'ready');
            await page.waitForFunction(() =>
              Number.isFinite((window as any).phase2Perf.intents.at(-1)?.end),
            );
            const audit = await page.evaluate(readPhase2Probe, true);
            const intent = audit.intents.at(-1);
            const workers = audit.workers.slice(before.workers.length);
            const worker = workers[0];
            const elapsedMs = intent.end - intent.start;
            const threshold = mode === 'cold-module' ? 800 : 600;
            const valid =
              workers.length === 1 &&
              worker.ok === true &&
              worker.terminatedAt !== null &&
              worker.resultMetadata?.steps > 0 &&
              worker.requestMetadata?.language === d.language &&
              JSON.stringify(worker.requestMetadata.input) ===
                JSON.stringify({ kind: d.id === 'kmp30' ? 'lines' : 'integers', values: d.input });
            report.execution.push({
              id: d.id,
              index,
              mode,
              elapsedMs,
              original500Ms: elapsedMs <= 500,
              acceptedThresholdMs: threshold,
              valid,
              intent,
              worker,
              resources: audit.resources,
              passed:
                valid &&
                elapsedMs <= threshold &&
                elapsedMs < 1000 &&
                intent.visibility === 'visible' &&
                intent.focus &&
                (mode === 'cold-module' ? before.compilations === 0 : before.compilations > 0),
            });
            const slider = page.locator(d.slider);
            await slider.fill((await slider.getAttribute('max'))!);
            await expect(page.getByTestId('custom-output')).toHaveText(d.stdout);
          }
        } catch (error) {
          report.failures.push({ id: d.id, index, error: String(error) });
        } finally {
          await context.close();
        }
      }
  } finally {
    report.hostEnd = capturePerformanceHost(output, 'end');
    report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
    writeFileSync(`${output}/measurements.json`, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    });
  }
  expect(report.failures).toEqual([]);
  expect(report.qualification.satisfied).toBe(true);
  expect(report.navigation).toHaveLength(50);
  expect(report.execution).toHaveLength(60);
  expect(report.navigation.every((r: any) => r.passed)).toBe(true);
  expect(report.execution.every((r: any) => r.passed)).toBe(true);
});
