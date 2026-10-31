/* eslint-disable @typescript-eslint/no-explicit-any -- Raw browser/CDP observation records have version-dependent metadata. */
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { openAnswer } from './notebook-helpers';
import { native } from './achievement-helpers';
import { installPhase2Probe, readPhase2Probe } from './phase2-performance-probe';
import {
  capturePerformanceHost,
  qualifyPerformanceHost,
} from '../../scripts/phase2-performance-host.mjs';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';

const label = process.env.TASK_EVIDENCE_LABEL!;
const output = `.artifacts/11.4/${label}`;
mkdirSync(output, { recursive: true });
const pilot = process.env.PHASE2_PERF_PILOT === '1',
  repeat = pilot ? 1 : 10;
const descending = Array.from({ length: 30 }, (_, i) => 30 - i).join(' ');
const practiceInputs = (
  JSON.parse(readFileSync('content/c/p05/course-1.0.0.json', 'utf8')) as {
    exercises: { id: string; tests: { input: Record<string, unknown> }[] }[];
  }
).exercises
  .find((e) => e.id === 'exercise.c.bubble-sort')!
  .tests.map((t) => t.input);
const definitions = [
  {
    id: 'c-bubble30',
    route: '/visualize/case.c.bubble-sort',
    root: '[data-testid="case-execution"]',
    stateAttribute: 'data-state',
    terminalStates: ['completed'],
    runLabel: '运行示例',
    slider: 'input[aria-label="执行步骤"]',
  },
  {
    id: 'visible-practice-bubble6',
    route: '/practice/exercise.c.bubble-sort',
    root: '[data-testid="practice-execution"]',
    stateAttribute: 'data-state',
    terminalStates: ['passed'],
    runLabel: '提交练习',
    slider: 'input[aria-label="执行步骤"]',
  },
  {
    id: 'c-pair30',
    route: '/compare',
    root: '[data-testid="comparison-page"]',
    stateAttribute: 'data-phase',
    terminalStates: ['settled'],
    runLabel: '运行两种算法',
    slider: 'input[aria-label="对比步骤"]',
  },
  {
    id: 'cpp-pair30',
    route: '/compare?pair=cpp-recursive',
    root: '[data-testid="recursive-comparison"]',
    stateAttribute: 'data-phase',
    terminalStates: ['settled'],
    runLabel: '运行两份C++',
    slider: 'input[aria-label="C++对比统一步骤"]',
  },
  {
    id: 'memory-hanoi5',
    route: '/memory?example=hanoi&view=stack',
    root: '[data-testid="memory-workspace"]',
    stateAttribute: 'data-state',
    terminalStates: ['ready'],
    runLabel: '运行样例',
    slider: 'input[aria-label="执行步骤"]',
  },
  {
    id: 'cpp-quick30-sorted',
    route: '/algorithms/case.cpp.quick-sort',
    root: '[data-testid="sort-workspace"]',
    stateAttribute: 'data-state',
    terminalStates: ['ready'],
    runLabel: '运行C++案例',
    slider: 'input[aria-label="C++排序执行步骤"]',
  },
] as const;
const navigation = [
  ['home', '/', '[data-testid="home-continue-learning"]'],
  ['courses', '/courses', '[data-course-lesson]'],
  [
    'lesson',
    '/lessons/lesson.c.variables-output',
    '[data-testid="lesson-reading"][data-state="ready"]',
  ],
  ['practice', '/practice/exercise.c.echo', '[data-testid="practice-editor-layout"]'],
  ['cases', '/cases', '[data-page-id="PAGE-05"] a[href*="visualize"]'],
  ['case', '/visualize/case.c.assignment', '[data-testid="input-panel"]'],
  ['settings', '/settings', '[data-testid="learning-save-status"][data-save-status="ready"]'],
  ['c-pair', '/compare', '[data-testid="input-field-values"]'],
  ['cpp-pair', '/compare?pair=cpp-recursive', '[data-testid="pair-input"]'],
  ['memory', '/memory?example=hanoi&view=stack', '[data-testid="memory-workspace"]'],
  ['classic', '/classics/case.cpp.hanoi', '[data-testid="classic-input"]'],
];
const write = (name: string, value: any) =>
  writeFileSync(`${output}/${name}.json`, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const stats = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b),
    n = sorted.length;
  return {
    n,
    min: sorted[0] ?? null,
    median: n ? sorted[Math.floor(n / 2)] : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
    max: sorted.at(-1) ?? null,
  };
};
async function ready(p: Page) {
  await expect(p.locator('.app-shell')).toHaveAttribute(
    'data-learning-storage-status',
    p05CourseRelease.registered ? 'ready' : /^(ready|unsaved)$/,
  );
  await expect(p.locator('.app-shell')).toHaveAttribute('data-learning-reading-status', 'ready');
  await expect(p.locator('.app-shell')).toHaveAttribute(
    'data-learning-practice-status',
    p05CourseRelease.registered ? 'ready' : 'failed',
  );
  await expect
    .poll(async () => (await native(p)).meta.activePackageRef.id)
    .toBe(p05CourseRelease.registered ? 'content.c.p05' : 'content.c.p0');
  if (p05CourseRelease.registered)
    await expect.poll(async () => (await native(p)).settings.goalTemplate).not.toBeNull();
  await expect(p.locator('.app-shell')).toHaveAttribute(
    'data-learning-storage-status',
    p05CourseRelease.registered ? 'ready' : /^(ready|unsaved)$/,
  );
}
async function prepare(p: Page, d: (typeof definitions)[number]) {
  if (d.id === 'visible-practice-bubble6') {
    await openAnswer(p, 'exercise.c.bubble-sort');
    await ready(p);
    await p
      .getByTestId('block-workspace-preference')
      .getByRole('combobox', { name: '积木显示', exact: true })
      .selectOption('show');
    await expect(p.getByTestId('practice-editor-layout')).toHaveAttribute(
      'data-blocks-visible',
      'yes',
    );
    await expect(p.locator('[aria-label="积木工作区"] .blocklySvg')).toBeVisible();
    await p
      .getByTestId('practice-execution')
      .getByRole('button', { name: '准备代码', exact: true })
      .click();
  } else {
    await p.goto('/#' + d.route);
    await ready(p);
    if (d.id === 'c-bubble30' || d.id === 'c-pair30') {
      await p.getByTestId('input-field-values').fill(descending);
      await p
        .getByRole('button', {
          name: d.id === 'c-pair30' ? '应用输入并准备' : '应用输入并准备',
          exact: true,
        })
        .click();
    } else if (d.id === 'cpp-pair30') {
      await p.getByTestId('pair-input').fill(descending);
      await p.getByRole('button', { name: '应用共同输入', exact: true }).click();
    } else if (d.id === 'memory-hanoi5')
      await p.getByRole('spinbutton', { name: '汉诺塔盘数', exact: true }).fill('5');
    else
      await p.getByTestId('sort-input').fill(Array.from({ length: 30 }, (_, i) => i + 1).join(' '));
  }
  await expect(p.getByRole('button', { name: d.runLabel, exact: true })).toBeEnabled();
  await p.getByRole('button', { name: d.runLabel, exact: true }).scrollIntoViewIfNeeded();
  await p.evaluate((config) => {
    (window as any).phase2Perf.configuration = config;
  }, d);
}
async function captureSample(p: Page, d: (typeof definitions)[number]) {
  const before = await p.evaluate(readPhase2Probe, false);
  let failure: string | null = null;
  try {
    await p.getByRole('button', { name: d.runLabel, exact: true }).click();
    await p.waitForFunction(
      () => {
        const a = (window as any).phase2Perf;
        return a.intents.at(-1)?.end !== null && a.intents.length > 0;
      },
      null,
      { timeout: 6000 },
    );
  } catch (e) {
    failure = String(e);
  }
  const audit = await p.evaluate(readPhase2Probe, false),
    intent = audit.intents.at(-1);
  const lanes = await p
    .locator(
      d.id === 'c-pair30'
        ? '.comparison-lane[data-testid^="comparison-lane-"]'
        : d.id === 'cpp-pair30'
          ? '.comparison-lane[data-testid^="pair-lane-"]'
          : '[data-testid="no-pair-lanes"]',
    )
    .evaluateAll((xs) =>
      xs.map((x) => ({
        phase: x.getAttribute('data-phase'),
        length: Number(x.getAttribute('data-length')),
      })),
    );
  const expectedRuns = d.id === 'visible-practice-bubble6' ? 6 : d.id.includes('pair30') ? 2 : 1;
  const terminalUi = await p.locator(d.root).getAttribute(d.stateAttribute);
  return { before, failure, audit, intent, lanes, expectedRuns, terminalUi };
}
function materializeSample(
  d: (typeof definitions)[number],
  mode: string,
  index: number,
  capture: Awaited<ReturnType<typeof captureSample>>,
  packets: Awaited<ReturnType<typeof readPhase2Probe>>,
) {
  const { before, failure, audit, intent, lanes, expectedRuns, terminalUi } = capture;
  const workers = packets.workers.slice(before.workers.length, audit.workers.length);
  const executions = workers.filter(
    (w: any) => w.requestMetadata && (w.kind === 'execute' || w.kind === 'extended-execute'),
  );
  const actualInputs = executions.map((w: any) => w.requestMetadata.input);
  const scaleVerified =
    d.id === 'memory-hanoi5'
      ? actualInputs[0]?.[0] === 5
      : d.id === 'visible-practice-bubble6'
        ? actualInputs.at(-1)?.values?.values?.length === 30
        : actualInputs.every((input: any) =>
            Array.isArray(input) ? input.length === 30 : input?.values?.values?.length === 30,
          );
  const expectedValues = Array.from({ length: 30 }, (_, i) =>
    d.id === 'cpp-quick30-sorted' ? i + 1 : 30 - i,
  );
  const inputMatchesIntent =
    d.id === 'visible-practice-bubble6'
      ? actualInputs.length === practiceInputs.length &&
        actualInputs.every((input: any, i: number) =>
          isDeepStrictEqual(input?.values, practiceInputs[i]),
        )
      : d.id === 'memory-hanoi5'
        ? isDeepStrictEqual(actualInputs[0], [5])
        : actualInputs.every((input: any) =>
            isDeepStrictEqual(Array.isArray(input) ? input : input?.values?.values, expectedValues),
          );
  const result = {
    id: d.id,
    mode,
    index,
    failure,
    terminalUi,
    intent,
    lanes,
    expectedRuns,
    actualInputs,
    scaleVerified,
    inputMatchesIntent,
    elapsedMs: intent?.end != null ? intent.end - intent.start : null,
    moduleActuallyCold: before.compilations === 0,
    compilationsBefore: before.compilations,
    environment: audit.environment,
    workers,
    valid:
      !failure &&
      !!intent?.end &&
      intent.focus &&
      intent.visibility === 'visible' &&
      executions.length === expectedRuns &&
      scaleVerified &&
      inputMatchesIntent &&
      executions.every(
        (w: any) =>
          w.ok === true &&
          w.terminatedAt !== null &&
          w.resultMetadata?.terminal?.status === 'completed',
      ) &&
      (!d.id.includes('pair30') ||
        (lanes.length === 2 && lanes.every((x) => x.phase === 'accepted' && x.length > 0))),
    original500Ms: !!intent?.end && intent.end - intent.start <= 500,
    acceptedThresholdMs: before.compilations === 0 ? 800 : 600,
  };
  const boundaries = executions.map((w: any, at: number) => ({
    index: at + 1,
    from: at === 0 ? intent?.start : executions[at - 1].terminatedAt,
    to: at === executions.length - 1 ? intent?.end : w.terminatedAt,
    cold: at === 0 && before.compilations === 0,
  }));
  Object.assign(result, {
    executionPartitions: boundaries.map(
      (b: {
        index: number;
        from: number | null | undefined;
        to: number | null | undefined;
        cold: boolean;
      }) => ({
        ...b,
        elapsedMs: b.to != null && b.from != null ? b.to - b.from : null,
        acceptedThresholdMs: b.cold ? 800 : 600,
      }),
    ),
    compound: expectedRuns > 1,
    originalGroup500Ms: result.original500Ms,
    groupWithinSingleExecutionTolerance:
      result.elapsedMs !== null && result.elapsedMs <= result.acceptedThresholdMs,
    groupWithinUnchangedDeadline: result.elapsedMs !== null && result.elapsedMs < 1000,
  });
  write(`${d.id}-${mode}-${index}`, result);
  return result;
}
async function sample(p: Page, d: (typeof definitions)[number], mode: string, index: number) {
  const capture = await captureSample(p, d);
  return materializeSample(d, mode, index, capture, await p.evaluate(readPhase2Probe, true));
}

test('P1 current production navigation and maximum-scale real execution use qualified HTTPS network and unchanged deadlines', async ({
  browser,
}) => {
  const report: any = {
    task: '16.10',
    pilot,
    repeat,
    network: 'Shared aggregate20Mbps down/5Mbps up/40ms RTT, real Brotli HTTPS, scoped SPKI only',
    navigation: [],
    execution: [],
    failures: [],
    rustTimingBoundary:
      'P0 technical/stats retain actual Rust timing boundaries; P1/Memory provide no separate Rust timer, null is unmeasured. End-to-end always includes full product validation and two-frame initial paint.',
  };
  report.hostStart = capturePerformanceHost(output, 'start');
  write('configuration', {
    definitions,
    navigation,
    repeat,
    navigationRepeats: pilot ? 1 : 5,
    originalThresholds: { navigation: 2000, execution: 500, safety: 1000 },
    acceptedExecution: { cold: 800, warm: 600 },
    playback: {
      startupMs: 2000,
      stableMs: 30000,
      rate: 4,
      frameP95: 16.67,
      rafP95: 20,
      largeGapRatio: 0.01,
    },
  });
  try {
    for (const [id, route, selector] of navigation)
      for (let i = 1; i <= (pilot ? 1 : 5); i++) {
        const c = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          serviceWorkers: 'block',
        });
        try {
          for (const mode of ['cold', 'warm']) {
            const p = await c.newPage();
            await p.bringToFront();
            await p.addInitScript(
              ({ selector, registered }) => {
                const scope = window as any;
                scope.phase2Navigation = { end: null };
                const inspect = () => {
                  if (scope.phase2Navigation.end !== null) return;
                  const target = document.querySelector(selector),
                    shell = document.querySelector('.app-shell');
                  if (
                    target &&
                    target.getBoundingClientRect().height > 0 &&
                    ['ready', ...(registered ? [] : ['unsaved'])].includes(
                      shell?.getAttribute('data-learning-storage-status') ?? '',
                    ) &&
                    shell?.getAttribute('data-learning-reading-status') === 'ready' &&
                    shell?.getAttribute('data-learning-practice-status') ===
                      (registered ? 'ready' : 'failed')
                  )
                    requestAnimationFrame(() =>
                      requestAnimationFrame(() => {
                        if (scope.phase2Navigation.end === null)
                          scope.phase2Navigation.end = performance.now();
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
              },
              { selector, registered: p05CourseRelease.registered },
            );
            await p.goto('/#' + route);
            await ready(p);
            await p.waitForFunction(() => (window as any).phase2Navigation.end !== null, null, {
              timeout: 10000,
            });
            const observed = await p.evaluate(async () => {
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
              return {
                initialDomElapsedMs: (window as any).phase2Navigation.end,
                elapsedMs: performance.now(),
                storageStatus: document
                  .querySelector('.app-shell')
                  ?.getAttribute('data-learning-storage-status'),
                readingStatus: document
                  .querySelector('.app-shell')
                  ?.getAttribute('data-learning-reading-status'),
                practiceStatus: document
                  .querySelector('.app-shell')
                  ?.getAttribute('data-learning-practice-status'),
                visibility: document.visibilityState,
                focus: document.hasFocus(),
                resources: performance.getEntriesByType('resource').map((r) => r.toJSON()),
              };
            });
            report.navigation.push({
              id,
              mode,
              index: i,
              ...observed,
              passed:
                observed.elapsedMs <= 2000 &&
                (p05CourseRelease.registered
                  ? observed.storageStatus === 'ready'
                  : ['ready', 'unsaved'].includes(observed.storageStatus ?? '')) &&
                observed.readingStatus === 'ready' &&
                observed.practiceStatus === (p05CourseRelease.registered ? 'ready' : 'failed') &&
                observed.visibility === 'visible' &&
                observed.focus,
            });
            await p.close();
          }
        } catch (e) {
          report.failures.push({ id, index: i, navigation: true, error: String(e) });
        } finally {
          await c.close();
        }
      }
    for (const d of definitions)
      for (let i = 1; i <= repeat; i++) {
        const c = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          serviceWorkers: 'block',
        });
        try {
          const p = await c.newPage();
          await p.bringToFront();
          await p.addInitScript(installPhase2Probe);
          await prepare(p, d);
          const cold = await captureSample(p, d),
            warm = await captureSample(p, d),
            packets = await p.evaluate(readPhase2Probe, true);
          report.execution.push(materializeSample(d, 'first-context', i, cold, packets));
          report.execution.push(materializeSample(d, 'warm-module', i, warm, packets));
        } catch (e) {
          report.failures.push({ id: d.id, index: i, execution: true, error: String(e) });
        } finally {
          await c.close();
        }
      }
  } finally {
    report.hostEnd = capturePerformanceHost(output, 'end');
    report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
    report.summary = {
      navigation: stats(report.navigation.map((r: any) => r.elapsedMs)),
      execution: stats(report.execution.map((r: any) => r.elapsedMs)),
      original500Deviations: report.execution.filter((r: any) => !r.original500Ms).length,
    };
    write('measurements', report);
  }
  expect(report.failures).toEqual([]);
  expect(report.qualification.satisfied).toBe(true);
  expect(report.navigation.every((r: any) => r.passed)).toBe(true);
  expect(
    report.execution.every(
      (r: any) =>
        r.valid &&
        r.groupWithinUnchangedDeadline &&
        r.executionPartitions.every(
          (part: any) => part.elapsedMs !== null && part.elapsedMs <= part.acceptedThresholdMs,
        ),
    ),
  ).toBe(true);
});

async function traceEnd(session: CDPSession, path: string) {
  const complete = new Promise<any>((r) => session.once('Tracing.tracingComplete', r));
  await session.send('Tracing.end');
  const event = await complete;
  writeFileSync(path, '', { flag: 'wx' });
  for (;;) {
    const chunk = await session.send('IO.read', { handle: event.stream });
    appendFileSync(path, chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
    if (chunk.eof) break;
  }
  await session.send('IO.close', { handle: event.stream });
}
test('P1 archive initialization diagnostic observes real cold storage without changing state', async ({
  browser,
}) => {
  for (const [id, route] of [
    ['home-1', '/'],
    ['home-2', '/'],
    ['home-3', '/'],
    ['home-4', '/'],
    ['home-5', '/'],
    ['courses', '/courses'],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    });
    try {
      for (const mode of ['cold', 'warm']) {
        const page = await context.newPage();
        await page.bringToFront();
        await page.addInitScript(
          ({ registered }) => {
            const scope = window as any;
            scope.phase2Navigation = { end: null };
            const inspect = () => {
              if (scope.phase2Navigation.end !== null) return;
              const target = document.querySelector(
                  '[data-testid="home-continue-learning"], [data-course-lesson]',
                ),
                shell = document.querySelector('.app-shell');
              if (
                target &&
                target.getBoundingClientRect().height > 0 &&
                shell?.getAttribute('data-learning-storage-status') === 'ready' &&
                shell?.getAttribute('data-learning-reading-status') === 'ready' &&
                shell?.getAttribute('data-learning-practice-status') ===
                  (registered ? 'ready' : 'failed')
              )
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    if (scope.phase2Navigation.end === null)
                      scope.phase2Navigation.end = performance.now();
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
          },
          { registered: p05CourseRelease.registered },
        );
        await page.goto('/#' + route);
        let readinessFailure: string | null = null;
        try {
          await ready(page);
        } catch (e) {
          readinessFailure = String(e).split('\n')[0];
        }
        await page.waitForTimeout(1800);
        const ui = await page.evaluate(() => ({
          shell: document.querySelector('.app-shell')?.outerHTML.slice(0, 1300),
          status: [...document.querySelectorAll('[data-testid="learning-save-status"]')].map(
            (e) => ({ text: e.textContent, html: e.outerHTML }),
          ),
          body: document.body.innerText.slice(0, 4000),
        }));
        write(`initialization-${id}-${mode}`, {
          readinessFailure,
          ui,
          archive: await native(page),
          boundary:
            'Read-only cold/warm initial-state diagnosis with the original passive navigation observer; no storage edits or automatic retries.',
        });
        await page.screenshot({
          path: `${output}/initialization-${id}-${mode}.png`,
          fullPage: true,
        });
        await page.close();
      }
    } finally {
      await context.close();
    }
  }
});
test('P1 validation CPU diagnostic preserves all validation and original deadlines', async ({
  page: p,
}) => {
  const d = definitions.find((x) => x.id === 'c-pair30')!;
  await p.addInitScript(installPhase2Probe);
  await p.bringToFront();
  await prepare(p, d);
  const first = await sample(p, d, 'diagnostic-first', 1);
  const session = await p.context().newCDPSession(p);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  await session.send('Profiler.start');
  const second = await sample(p, d, 'diagnostic-warm', 1);
  const { profile } = await session.send('Profiler.stop');
  await session.detach();
  write('diagnostic-profile', profile);
  write('diagnostic-summary', {
    first,
    second,
    boundary: 'CPU diagnostic adds sampling overhead; never a formal performance pass.',
  });
});
test('P1 two30-item panels and real recursion stack remain responsive for three independent30-second stable playbacks', async ({
  browser,
}) => {
  test.skip(pilot, 'Pilot checks setup and timings before the longer formal playback.');
  const playbackOutput = `${output}/playback-host`;
  mkdirSync(playbackOutput, { recursive: true });
  const report: any = {
    task: '16.10',
    hostStart: capturePerformanceHost(playbackOutput, 'start'),
    cases: [],
    failures: [],
    boundary:
      'Timer callback entry→MutationObserver after cursor DOM commit is a conservative application pipeline upper bound, with unchanged native125ms delay. CDP drawing/submission is separate from physical panel presentation.',
  };
  const recordings: any[] = [];
  try {
    for (const id of ['c-pair30', 'cpp-pair30', 'memory-hanoi5']) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: 'block',
      });
      try {
        const p = await context.newPage();
        await p.addInitScript(installPhase2Probe);
        const d = definitions.find((x) => x.id === id)!;
        await p.bringToFront();
        await prepare(p, d);
        const execution = await sample(p, d, 'playback-preparation', 1);
        expect(execution.valid).toBe(true);
        const rate =
          id === 'c-pair30'
            ? '对比回放速度'
            : id === 'cpp-pair30'
              ? 'C++对比回放速度'
              : '内存播放速度';
        await p.getByRole('combobox', { name: rate, exact: true }).selectOption('4');
        const root = p.locator(d.root);
        await root.locator(d.slider).fill('0');
        const control =
          id === 'memory-hanoi5' ? p.locator('.memory-stage') : p.locator('.comparison-controls');
        await control.scrollIntoViewIfNeeded();
        const session = await p.context().newCDPSession(p);
        await session.send('Tracing.start', {
          transferMode: 'ReturnAsStream',
          categories:
            'devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-devtools.screenshot,cc,viz,benchmark,blink.user_timing,toplevel',
        });
        const start = await p.evaluate((id) => {
          const a = (window as any).phase2Perf;
          a.recording = true;
          a.lastCursor = 0;
          a.startAt = performance.now();
          performance.mark('phase2-' + id);
          return a.startAt;
        }, id);
        await control
          .getByRole('button', { name: id === 'memory-hanoi5' ? '播放' : '播放对比', exact: true })
          .click();
        await p.waitForTimeout(2200);
        await p.screenshot({ path: `${output}/${id}-start.png`, fullPage: true });
        await p.waitForTimeout(15000);
        await p.screenshot({ path: `${output}/${id}-middle.png`, fullPage: true });
        await p.waitForTimeout(15000);
        await p.screenshot({ path: `${output}/${id}-end.png`, fullPage: true });
        const audit = await p.evaluate(readPhase2Probe, false);
        await p.evaluate(() => {
          (window as any).phase2Perf.recording = false;
        });
        await control
          .getByRole('button', { name: id === 'memory-hanoi5' ? '暂停' : '暂停对比', exact: true })
          .click();
        const tracePath = `${output}/${id}-trace.json`;
        await traceEnd(session, tracePath);
        await session.detach();
        recordings.push({ id, start, audit, tracePath });
      } catch (error) {
        report.failures.push({ id, error: String(error) });
      } finally {
        await context.close();
      }
    }
    // No large trace parsing/compression runs between measured cases.
    for (const { id, start, audit, tracePath } of recordings) {
      const traceBytes = readFileSync(tracePath),
        trace = JSON.parse(traceBytes.toString('utf8'));
      writeFileSync(`${output}/${id}-trace.json.gz`, gzipSync(traceBytes), {
        flag: 'wx',
      });
      const stableStart = start + 2000,
        stableEnd = stableStart + 30000,
        raf = audit.raf.filter((t: number) => t >= stableStart && t <= stableEnd),
        gaps = raf.slice(1).map((t: number, i: number) => t - raf[i]),
        commits = audit.commits.filter((r: any) => r.at >= stableStart && r.at <= stableEnd),
        work = stats(commits.map((r: any) => r.duration)),
        rafStats = stats(gaps),
        ratio = gaps.filter((v: number) => v > 33.3).length / gaps.length;
      const mark = trace.traceEvents.find((r: any) => r.name === 'phase2-' + id),
        offset = mark.ts - start * 1000,
        events = trace.traceEvents.filter(
          (r: any) => r.ts >= offset + stableStart * 1000 && r.ts <= offset + stableEnd * 1000,
        ),
        draw = events.filter((r: any) => r.name === 'DrawFrame').length,
        paint = events.filter((r: any) => r.name === 'Paint').length,
        images = events
          .filter((r: any) => r.name === 'Screenshot' && r.args?.snapshot)
          .map((r: any) =>
            createHash('sha256').update(Buffer.from(r.args.snapshot, 'base64')).digest('hex'),
          );
      report.cases.push({
        id,
        stableDurationMs: 30000,
        rate: 4,
        cursorStart: commits[0]?.cursor,
        cursorEnd: commits.at(-1)?.cursor,
        applicationPipelineUpperBoundMs: work,
        rafGapMs: rafStats,
        over33_3Ratio: ratio,
        drawEvents: draw,
        paintEvents: paint,
        screenshotFrames: images.length,
        distinctEncodedScreenshots: new Set(images).size,
        allSequential: commits
          .slice(1)
          .every((r: any, i: number) => r.cursor === commits[i].cursor + 1),
        allForeground: commits.every((r: any) => r.visibility === 'visible' && r.focus),
        passed:
          work.n > 100 &&
          work.p95 !== null &&
          work.p95 <= 16.67 &&
          rafStats.p95 !== null &&
          rafStats.p95 <= 20 &&
          ratio <= 0.01 &&
          draw > 0 &&
          paint > 0 &&
          new Set(images).size > 2,
        audit,
      });
    }
  } finally {
    report.hostEnd = capturePerformanceHost(playbackOutput, 'end');
    report.qualification = qualifyPerformanceHost(report.hostStart, report.hostEnd);
    write('playback', report);
  }
  expect(report.qualification.satisfied).toBe(true);
  expect(report.failures).toEqual([]);
  expect(report.cases).toHaveLength(3);
  expect(report.cases.every((r: any) => r.passed && r.allSequential && r.allForeground)).toBe(true);
});
