/* global document, window, navigator, innerWidth, innerHeight, devicePixelRatio */
// Actual production inputs and native UI edits. No source/result injection.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { correctStarter } from '../tests/browser/block-ui.ts';
import { performanceCases, performanceExercises } from './performance-workloads.mjs';
import { performanceBrowserOptions } from './performance-browser.mjs';
import { installPerformanceObserver, readPerformanceAudit } from './performance-observer.mjs';
import { startPerformanceServer } from './serve-performance.mjs';
import { workspaceDir } from './process.mjs';
import { capturePerformanceHost, qualifyPerformanceHost } from './performance-host.mjs';

const browserName = process.env.PERF_BROWSER ?? 'chrome';
const label = process.env.PERF_LABEL ?? `execution-${browserName}`;
assert.match(label, /^[a-z0-9-]+$/);
const repeats = Number(process.env.PERF_REPEATS ?? 10);
assert.ok(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 10);
const definitions = [
  ...performanceCases.map((entry) => ({ ...entry, kind: 'case' })),
  ...performanceExercises.map((key) => ({ key, exerciseId: key, kind: 'exercise' })),
];
const selectedKeys = process.env.PERF_CASE_KEYS?.split(',');
const selected = selectedKeys
  ? definitions.filter((entry) => selectedKeys.includes(entry.key))
  : definitions;
assert.ok(selected.length > 0);
if (selectedKeys) assert.equal(selected.length, new Set(selectedKeys).size);
const practice = JSON.parse(
  readFileSync(join(workspaceDir, 'web/public/content/practice/course-practice-1.0.0.json')),
);
const caseView = JSON.parse(readFileSync(join(workspaceDir, 'content/c/p0/case-view-1.0.0.json')));
const output = join(workspaceDir, '.artifacts/11.4', label);
assert.ok(!existsSync(output), 'Use a new PERF_LABEL; earlier evidence is immutable');
mkdirSync(output);
const writeNew = (name, value) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? {
        n: sorted.length,
        min: sorted[0],
        median:
          (sorted[Math.floor((sorted.length - 1) / 2)] +
            sorted[Math.ceil((sorted.length - 1) / 2)]) /
          2,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        max: sorted.at(-1),
      }
    : { n: 0, min: null, median: null, p95: null, max: null };
}
function environment() {
  const gl = document.createElement('canvas').getContext('webgl');
  const extension = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    userAgent: navigator.userAgent,
    viewport: [innerWidth, innerHeight],
    devicePixelRatio,
    visibility: document.visibilityState,
    focus: document.hasFocus(),
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
  };
}
let service;
let browser;
const report = {
  task: '11.4',
  baseline: 'PERF-BASE-01 V1.0 / BUDGET-P0 V1.0',
  kind: 'production UI complete execution and real-session review',
  startedAt: new Date().toISOString(),
  browser: browserName,
  repeatsPerModuleState: repeats,
  selectedKeys: selected.map((entry) => entry.key),
  expectedFormalWorkloads: 61,
  expectedFormalExecutionsPerBrowser: 1220,
  expectedFormalReviewsPerBrowser: 30,
  thresholds: { executionMs: 500, reviewMs: 2000, originalSafetyMs: 1000 },
  cacheBoundary:
    'Each cohort uses a fresh context and cleared HTTP cache. Before the cold click, source preparation may only instantiate a published input declaration template; no execution Module compilation or Worker may occur. The cold real execute then supplies the cached readonly Module for the subsequent warm execute; every call/group uses a fresh Worker.',
  measurement:
    'Trusted native click captured in the document, through complete product validation and the initial playable projection after two rAF callbacks. Visible projection and successful native result/output checks are required. Private Worker phases overlap and cannot be added; complete WASM-call time includes bindgen copying and retained-model cleanup. Metadata collection and hashing happen after the timed endpoint.',
  suppliedHostConditions: JSON.parse(
    readFileSync(
      join(workspaceDir, process.env.PERF_HOST_REPORT ?? '.artifacts/11.4/conditions-host.json'),
    ),
  ),
  hashes: Object.fromEntries(
    [
      'package-lock.json',
      'Cargo.lock',
      'scripts/performance-execution.mjs',
      'scripts/performance-observer.mjs',
      'scripts/performance-workloads.mjs',
      'web/src/generated/c_viz_wasm_bg.wasm',
    ].map((path) => [path, sha(readFileSync(join(workspaceDir, path)))]),
  ),
  cohorts: [],
  harnessFailures: [],
  samples: [],
  reviews: [],
};

async function measure(page, cdp, definition, mode, repeat, cohort) {
  const panel = page.getByTestId(
    definition.kind === 'case' ? 'case-execution' : 'practice-execution',
  );
  const before = await page.evaluate(readPerformanceAudit);
  const beforeEnvironment = await page.evaluate(environment);
  const label = definition.kind === 'case' ? '运行示例' : '提交练习';
  const intentIndex = before.intents.length;
  let failure = null;
  try {
    await panel.getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(
      ({ label, intentIndex }) => {
        const audit = window.__performanceAudit;
        const intent = audit.intents[intentIndex];
        return (
          audit.intents.length === intentIndex + 1 && intent?.label === label && intent.end !== null
        );
      },
      { label, intentIndex },
      { timeout: 5000 },
    );
  } catch (error) {
    failure = { message: error.message };
  }
  const after = await page.evaluate(readPerformanceAudit);
  const afterEnvironment = await page.evaluate(environment);
  const intent = after.intents.length === intentIndex + 1 ? after.intents[intentIndex] : null;
  const workers = after.workers.slice(before.workers.length);
  const expectedGroups =
    definition.kind === 'case'
      ? 1
      : practice.exercises.find((entry) => entry.id === definition.exerciseId).tests.length;
  const state = await panel.getAttribute('data-state');
  let judgementEvidence = null;
  if (definition.kind === 'exercise') {
    const subject = practice.exercises.find((entry) => entry.id === definition.exerciseId);
    const groups = await panel
      .getByTestId('practice-feedback')
      .locator(':scope > ul')
      .first()
      .locator(':scope > li')
      .allTextContents();
    const actualStdout = await panel
      .getByTestId('practice-stdout')
      .textContent()
      .catch(() => null);
    const inputText = await panel
      .getByTestId('practice-input')
      .locator('code')
      .textContent()
      .catch(() => null);
    let inputMatches = false;
    try {
      inputMatches =
        JSON.stringify(JSON.parse(inputText)) === JSON.stringify(subject.tests.at(-1).input);
    } catch {
      /* Missing or malformed actual UI input is a failed sample. */
    }
    judgementEvidence = {
      expectedKeys: subject.tests.map((entry) => entry.caseKey),
      groups,
      allGroupsPassed:
        groups.length === subject.tests.length &&
        groups.every(
          (value, index) => value.trim() === `${subject.tests[index].caseKey}：本组通过`,
        ),
      lastStdoutMatches: actualStdout === subject.tests.at(-1).expectedStdout,
      retainedInputMatches: inputMatches,
    };
  }
  const outputMatches =
    definition.kind !== 'case' ||
    (await panel
      .getByTestId('execution-output')
      .textContent()
      .catch(() => null)) === definition.stdout;
  const sourceField = panel.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
  const source = (await sourceField.count()) ? await sourceField.inputValue() : null;
  const exercise =
    definition.kind === 'exercise'
      ? practice.exercises.find((entry) => entry.id === definition.exerciseId)
      : null;
  const program =
    definition.kind === 'case'
      ? caseView.catalogs.find((entry) => entry.subject.id === definition.caseId).program
      : practice.programs.find((entry) => entry.id === exercise.programRef.id);
  const input = definition.kind === 'case' ? definition.values : exercise.tests.at(-1).input;
  const declarations = program.bindings.map((binding) => {
    const value = input[binding.inputKey];
    const text =
      binding.targetKind === 'scalar' && typeof value === 'number'
        ? `int ${binding.targetName} = ${value};`
        : binding.targetKind === 'logical-length' && Array.isArray(value)
          ? `int ${binding.targetName} = ${value.length};`
          : binding.targetKind === 'array' && Array.isArray(value)
            ? `int ${binding.targetName}[${Math.max(1, value.length)}] = {${value.length ? value.join(', ') : '0'}};`
            : null;
    return {
      bindingKey: binding.bindingKey,
      matches: text !== null && source?.includes(text) === true,
    };
  });
  const metrics = await cdp.send('Performance.getMetrics');
  const wholeMs = intent?.end == null ? null : intent.end - intent.at;
  const moduleStateConfirmed =
    mode === 'cold'
      ? before.compilations.length === 0 &&
        before.workers.length === 0 &&
        after.compilations.length === 1 &&
        after.compilations[0].start >= intent?.at &&
        after.compilations[0].succeeded
      : before.compilations.length === 1 && after.compilations.length === 1;
  const last = workers.at(-1);
  const maximumActiveWorkers = after.workers.reduce(
    (maximum, worker) =>
      Math.max(
        maximum,
        after.workers.filter(
          (other) =>
            other.createdAt <= worker.createdAt &&
            (other.terminatedAt === null || other.terminatedAt > worker.createdAt),
        ).length,
      ),
    0,
  );
  const controls = {
    trustedClick: intent?.label === label && intent.trusted,
    newIntent: after.intents.length === intentIndex + 1,
    warmPreparation:
      mode !== 'warm' ||
      (cohort.warmPreparation?.readyToRun === true &&
        cohort.warmPreparation.coldFailurePreserved &&
        cohort.warmPreparation.noAdditionalCompilation &&
        cohort.warmPreparation.noAdditionalWorker),
    moduleStateConfirmed,
    freshWorkers:
      workers.length === expectedGroups &&
      workers.every((entry) => entry.kind === 'execute') &&
      new Set(workers.map((entry) => entry.operationId)).size === expectedGroups,
    maximumOneWorker: maximumActiveWorkers === 1,
    noOlderLiveWorker: after.workers.every((entry) => entry.terminatedAt !== null),
    sharedReadonlyModule: workers.every((entry) => entry.moduleId === 1),
    workersTerminated: workers.every((entry) => entry.terminatedAt !== null),
    foreground:
      beforeEnvironment.focus &&
      afterEnvironment.focus &&
      beforeEnvironment.visibility === 'visible' &&
      afterEnvironment.visibility === 'visible',
    correctViewport:
      beforeEnvironment.viewport[0] === 1440 &&
      beforeEnvironment.viewport[1] === 900 &&
      beforeEnvironment.devicePixelRatio === 1,
    completeRustTrace: last?.terminal === 'completed' && last.completeness === 'complete',
    playableInitialProjection:
      intent?.playable === true &&
      intent.paintVisible === true &&
      intent.cursor === '0' &&
      Number(intent.length) > 0,
    resultCorrect: state === (definition.kind === 'case' ? 'completed' : 'passed') && outputMatches,
    exerciseGroupsCorrect:
      judgementEvidence === null ||
      (judgementEvidence.allGroupsPassed &&
        judgementEvidence.lastStdoutMatches &&
        judgementEvidence.retainedInputMatches),
    sourceCorrect:
      source !== null &&
      declarations.every((entry) => entry.matches) &&
      (await sourceField.getAttribute('readonly')) !== null,
    privateTimings:
      workers.length > 0 &&
      workers.every(
        (entry) =>
          Array.isArray(entry.technical?.rust) &&
          entry.technical.rust.length === 27 &&
          entry.technical.rust[0] === 1 &&
          entry.technical.rust[13] === 1 &&
          entry.technical.rust[26] === 0 &&
          entry.technical.rust.every(Number.isFinite) &&
          Number.isFinite(entry.technical.wholeWasmCallMs),
      ),
    boundedWasm:
      workers.length > 0 &&
      workers.every((entry) => entry.technical?.wasmPages > 0 && entry.technical.wasmPages <= 2048),
  };
  const sample = {
    id: `${definition.key}-${mode}-${repeat}`,
    key: definition.key,
    kind: definition.kind,
    mode,
    repeat,
    cohortId: cohort.id,
    failure,
    environment: beforeEnvironment,
    afterEnvironment,
    maximumActiveWorkers,
    wholeMs,
    state,
    expectedGroups,
    judgementEvidence,
    sourceSha256: source === null ? null : sha(source),
    sourceChecks: declarations,
    intentIndex,
    cursor: await panel
      .getByTestId('player-controls')
      .getAttribute('data-cursor')
      .catch(() => null),
    length: await panel
      .getByTestId('player-controls')
      .getAttribute('data-length')
      .catch(() => null),
    controls,
    passed:
      !failure && Object.values(controls).every(Boolean) && wholeMs !== null && wholeMs <= 500,
    intent,
    compilations: after.compilations,
    workers,
    totalWorkersAfter: after.workers.length,
    pageMetrics: metrics.metrics,
    resources: after.resources,
    longTasks: after.longTasks,
  };
  writeNew(`${sample.id}.json`, sample);
  report.samples.push(sample);
  cohort.samples.push(sample.id);
  console.log(JSON.stringify({ id: sample.id, wholeMs, state, controls, passed: sample.passed }));
  if (repeat === 1)
    await page.screenshot({ path: join(output, `${sample.id}.png`), fullPage: true });
  return sample;
}

async function readRunReadiness(page, definition) {
  return page.evaluate(
    ({ selector, label }) => {
      const panel = document.querySelector(selector);
      const code = panel?.querySelector('[data-testid="code-panel"] textarea');
      const button = [...(panel?.querySelectorAll('button') ?? [])].find(
        (item) => item.textContent.trim() === label,
      );
      return {
        state: panel?.getAttribute('data-state') ?? null,
        sourcePresent: !!code?.value,
        readonly: !!code?.readOnly,
        runPresent: !!button,
        runEnabled: !!button && !button.disabled,
      };
    },
    {
      selector: `[data-testid="${definition.kind === 'case' ? 'case-execution' : 'practice-execution'}"]`,
      label: definition.kind === 'case' ? '运行示例' : '提交练习',
    },
  );
}

async function prepareWarm(page, definition, cohort, cold) {
  const before = await readRunReadiness(page, definition);
  const beforeAudit = await page.evaluate(readPerformanceAudit);
  const recovery = (cohort.warmPreparation = {
    coldSampleId: cold.id,
    coldPassed: cold.passed,
    coldFailurePreserved: report.samples.includes(cold),
    before,
    needed: !before.sourcePresent || !before.readonly || !before.runEnabled,
    action: null,
    readyToRun: false,
    beforeCompilations: beforeAudit.compilations.length,
    beforeWorkers: beforeAudit.workers.length,
  });
  const selector = `[data-testid="${definition.kind === 'case' ? 'case-execution' : 'practice-execution'}"]`;
  let preparationError;
  try {
    if (recovery.needed) {
      // Preserve the cold failure. Restore only through the existing native
      // preparation command; no execution is retried or injected.
      await page.waitForFunction((selector) => {
        const panel = document.querySelector(selector);
        return (
          !!panel && !['running', 'preparing', 'loading'].includes(panel.getAttribute('data-state'))
        );
      }, selector);
      recovery.action = definition.kind === 'case' ? '准备运行样例' : '准备代码';
      await page
        .locator(selector)
        .getByRole('button', { name: recovery.action, exact: true })
        .click();
      await page.waitForFunction(
        ({ selector, label }) => {
          const panel = document.querySelector(selector);
          const code = panel?.querySelector('[data-testid="code-panel"] textarea');
          return (
            panel?.getAttribute('data-state') === 'ready' &&
            !!code?.value &&
            code.readOnly &&
            [...panel.querySelectorAll('button')].some(
              (button) => button.textContent.trim() === label && !button.disabled,
            )
          );
        },
        { selector, label: definition.kind === 'case' ? '运行示例' : '提交练习' },
      );
    }
  } catch (error) {
    recovery.failure = { message: error.message, stack: error.stack };
    preparationError = error;
  } finally {
    try {
      recovery.after = await readRunReadiness(page, definition);
      const afterAudit = await page.evaluate(readPerformanceAudit);
      recovery.afterCompilations = afterAudit.compilations.length;
      recovery.afterWorkers = afterAudit.workers.length;
      recovery.noAdditionalCompilation = recovery.beforeCompilations === recovery.afterCompilations;
      recovery.noAdditionalWorker = recovery.beforeWorkers === recovery.afterWorkers;
      recovery.readyToRun =
        recovery.after.sourcePresent &&
        recovery.after.readonly &&
        recovery.after.runEnabled &&
        (!recovery.needed || recovery.after.state === 'ready');
    } catch (error) {
      recovery.observationFailure = { message: error.message, stack: error.stack };
      preparationError ??= error;
    }
    writeNew(`${definition.key}-warm-recovery-${cohort.repeat}.json`, recovery);
  }
  if (preparationError) throw preparationError;
}

try {
  report.hostConditions = capturePerformanceHost(output, 'start');
  service = await startPerformanceServer({ logPrefix: `.artifacts/11.4/${label}/network` });
  const options = performanceBrowserOptions(browserName, service.metadata);
  browser = await chromium.launch(options.launchOptions);
  report.browserVersion = browser.version();
  report.server = service.metadata;
  report.certificateAcceptance = options.certificateAcceptance;
  for (const definition of selected) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const cohort = {
        id: `${definition.key}-cohort-${repeat}`,
        key: definition.key,
        kind: definition.kind,
        repeat,
        phase: 'context-create',
        samples: [],
        contextClosed: false,
      };
      report.cohorts.push(cohort);
      let context;
      let page;
      try {
        context = await browser.newContext(options.contextOptions);
        cohort.phase = 'observer-and-cache-setup';
        await context.addInitScript(installPerformanceObserver);
        page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.clearBrowserCache');
        await cdp.send('Performance.enable');
        await page.bringToFront();
        const route =
          definition.kind === 'case'
            ? `/visualize/${definition.caseId}`
            : `/practice/${definition.exerciseId}`;
        cohort.phase = 'navigation';
        await page.goto(`${service.origin}/#${route}`);
        const panel = page.getByTestId(
          definition.kind === 'case' ? 'case-execution' : 'practice-execution',
        );
        await panel.locator('[data-testid="code-panel"] textarea').waitFor();
        cohort.phase = 'source-preparation';
        if (definition.kind === 'case') {
          for (const [key, value] of Object.entries(definition.values))
            await page
              .getByTestId(`input-field-${key}`)
              .fill(
                Array.isArray(value) ? (value.length ? value.join(', ') : '[]') : String(value),
              );
          await panel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
        } else await correctStarter(page, definition.exerciseId);
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-testid="case-execution"], [data-testid="practice-execution"]')
              ?.getAttribute('data-state') === 'ready',
        );
        cohort.phase = 'cold-execution';
        const cold = await measure(page, cdp, definition, 'cold', repeat, cohort);
        cohort.phase = 'warm-preparation';
        await prepareWarm(page, definition, cohort, cold);
        cohort.phase = 'warm-execution';
        const warm = await measure(page, cdp, definition, 'warm', repeat, cohort);
        if (definition.kind === 'exercise' && repeat <= 5 && warm.state === 'passed') {
          cohort.phase = 'review';
          const beforeReview = await page.evaluate(readPerformanceAudit);
          const reviewEnvironment = await page.evaluate(environment);
          const reviewIndex = beforeReview.intents.length;
          await panel.getByRole('link', { name: '查看本次复盘', exact: true }).click();
          await page.waitForFunction(
            (reviewIndex) => {
              const audit = window.__performanceAudit;
              return (
                audit.intents.length === reviewIndex + 1 &&
                audit.intents[reviewIndex]?.label === '查看本次复盘' &&
                audit.intents[reviewIndex]?.end !== null
              );
            },
            reviewIndex,
            { timeout: 5000 },
          );
          const audit = await page.evaluate(readPerformanceAudit);
          const reviewAfterEnvironment = await page.evaluate(environment);
          const intent = audit.intents[reviewIndex];
          const reviewPanel = page.getByTestId('practice-execution');
          const reviewSource = await reviewPanel
            .getByRole('textbox', { name: '当前执行的 C 代码', exact: true })
            .inputValue();
          const subject = practice.exercises.find((entry) => entry.id === definition.exerciseId);
          const controls = {
            trustedClick: intent?.trusted === true && intent?.label === '查看本次复盘',
            newIntent: audit.intents.length === reviewIndex + 1,
            foreground:
              reviewEnvironment.focus &&
              reviewAfterEnvironment.focus &&
              reviewEnvironment.visibility === 'visible' &&
              reviewAfterEnvironment.visibility === 'visible',
            correctViewport: [reviewEnvironment, reviewAfterEnvironment].every(
              (value) =>
                value.viewport[0] === 1440 &&
                value.viewport[1] === 900 &&
                value.devicePixelRatio === 1,
            ),
            noRerun:
              audit.workers.length === beforeReview.workers.length &&
              audit.compilations.length === beforeReview.compilations.length,
            realSession:
              warm.controls.completeRustTrace &&
              warm.controls.resultCorrect &&
              warm.controls.exerciseGroupsCorrect &&
              warm.controls.sourceCorrect,
            route: new URL(page.url()).hash.endsWith(`/${definition.exerciseId}/review`),
            retainedSource: sha(reviewSource) === warm.sourceSha256,
            retainedOutput:
              (await reviewPanel.getByTestId('practice-stdout').textContent()) ===
              subject.tests.at(-1).expectedStdout,
            retainedCursor:
              intent?.cursor === warm.cursor && Number(intent?.length) === Number(warm.length),
            playable: intent?.playable === true && intent?.paintVisible === true,
          };
          const review = {
            id: `${definition.key}-review-${repeat}`,
            key: definition.key,
            repeat,
            wholeMs: intent.end - intent.at,
            intent,
            environment: reviewEnvironment,
            afterEnvironment: reviewAfterEnvironment,
            workersBefore: warm.totalWorkersAfter,
            workersAfter: audit.workers.length,
            noRerun: audit.workers.length === warm.totalWorkersAfter,
            realSession: warm.controls.completeRustTrace,
            controls,
            passed: intent.end - intent.at <= 2000 && Object.values(controls).every(Boolean),
          };
          report.reviews.push(review);
          writeNew(`${review.id}.json`, review);
          cohort.review = review.id;
        } else if (definition.kind === 'exercise' && repeat <= 5) {
          cohort.reviewSkipped = {
            expected: true,
            reason: 'The warm execution did not produce a passed real session',
            warmSampleId: warm.id,
            warmState: warm.state,
          };
        }
        cohort.phase = 'complete';
      } catch (error) {
        cohort.failure = { phase: cohort.phase, message: error.message, stack: error.stack };
        report.harnessFailures.push({ cohortId: cohort.id, ...cohort.failure });
        if (page && !page.isClosed()) {
          cohort.failurePage = await page
            .evaluate(() => ({ url: window.location.href, text: document.body?.innerText }))
            .catch((error) => ({ observationFailure: error.message }));
          try {
            const name = `${cohort.id}-failure.png`;
            await page.screenshot({ path: join(output, name), fullPage: true });
            cohort.failureScreenshot = name;
          } catch (error) {
            cohort.failureScreenshotError = error.message;
          }
        }
        console.log(JSON.stringify({ cohortId: cohort.id, failure: cohort.failure }));
      } finally {
        try {
          await context?.close();
          cohort.contextClosed = true;
        } catch (error) {
          cohort.cleanupFailure = {
            phase: 'context-cleanup',
            message: error.message,
            stack: error.stack,
          };
          report.harnessFailures.push({ cohortId: cohort.id, ...cohort.cleanupFailure });
        }
        writeNew(`${cohort.id}.json`, cohort);
      }
    }
  }
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.cleanupErrors = [];
  for (const [name, action] of [
    ['owned browser', () => browser?.close()],
    ['owned server', () => service?.stop()],
  ]) {
    try {
      await action();
    } catch (error) {
      report.cleanupErrors.push({ component: name, message: error.message });
    }
  }
  try {
    report.hostConditionsEnd = capturePerformanceHost(output, 'end');
  } catch (error) {
    report.hostCaptureFailure = { message: error.message };
  }
  report.endedAt = new Date().toISOString();
  report.complete =
    !report.failure &&
    report.harnessFailures.length === 0 &&
    report.cleanupErrors.length === 0 &&
    selected.length === 61 &&
    repeats === 10 &&
    report.cohorts.length === 610 &&
    report.cohorts.every((cohort) => cohort.contextClosed) &&
    report.samples.length === 1220 &&
    report.reviews.length === 30;
  report.reviewsComplete = report.reviews.length === 30;
  report.summary = selected.flatMap((definition) =>
    ['cold', 'warm'].map((mode) => {
      const samples = report.samples.filter(
        (entry) => entry.key === definition.key && entry.mode === mode,
      );
      return {
        key: definition.key,
        mode,
        timingsMs: stats(samples.map((entry) => entry.wholeMs)),
        failed: samples.filter((entry) => !entry.passed).length,
      };
    }),
  );
  report.hostBaseline = qualifyPerformanceHost(report.hostConditions, report.hostConditionsEnd);
  report.allSamplesPass =
    report.hostBaseline.satisfied &&
    report.complete &&
    report.reviewsComplete &&
    report.samples.every((entry) => entry.passed) &&
    report.reviews.every((entry) => entry.passed);
  writeNew('report.json', report);
  if (!report.allSamplesPass) process.exitCode = 1;
}
