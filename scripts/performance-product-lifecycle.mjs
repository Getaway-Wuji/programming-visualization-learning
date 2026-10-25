/* global window, document, performance, MutationObserver, requestAnimationFrame, navigator, innerWidth, innerHeight, devicePixelRatio */
// Real product controls only. This observer never keeps Worker, Module or result buffers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { chromium } from '@playwright/test';
import { correctStarter, wrongEcho } from '../tests/browser/block-ui.ts';
import { performanceBrowserOptions } from './performance-browser.mjs';
import { performanceCases } from './performance-workloads.mjs';
import { startPerformanceServer } from './serve-performance.mjs';
import { workspaceDir } from './process.mjs';
import { capturePerformanceHost, qualifyPerformanceHost } from './performance-host.mjs';

const browserName = process.env.PERF_BROWSER ?? 'chrome';
assert.ok(
  ['chrome', 'edge'].includes(browserName),
  'Stock Firefox is a separate, unimplemented run',
);
const label = process.env.PERF_LABEL ?? `product-lifecycle-${browserName}`;
assert.match(label, /^product-lifecycle-[a-z0-9-]+$/);
const rounds = Number(process.env.PERF_ROUNDS ?? 50);
assert.ok(Number.isSafeInteger(rounds) && rounds >= 2 && rounds <= 50 && rounds % 2 === 0);
const workload = performanceCases.find((entry) => entry.key === 'bubble-sort-maximum');
assert.equal(workload?.caseId, 'case.c.bubble-sort');
assert.equal(workload.values.values.length, 30);
const output = join(workspaceDir, '.artifacts/11.4', label);
assert.ok(!existsSync(output), 'Use a new PERF_LABEL; earlier evidence is immutable');
mkdirSync(output);
const writeNew = (name, value) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function installLifecycleObserver() {
  const audit = (window.__productLifecycle = {
    version: 1,
    workers: [],
    compilations: [],
    intents: [],
    edits: [],
    transitions: [],
    maximumActiveWorkers: 0,
    moduleCount: 0,
    globalListeners: {},
    listenerOperations: [],
  });
  const modules = new WeakMap();
  const callbacks = new WeakMap();
  let callbackId = 0;
  const activeListeners = new Set();
  for (const [name, target] of [
    ['window', window],
    ['document', document],
  ]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    const track = (type, listener, options, added) => {
      if (!['scroll', 'resize', 'visibilitychange'].includes(type) || !listener) return;
      if (!callbacks.has(listener)) callbacks.set(listener, ++callbackId);
      const capture = typeof options === 'boolean' ? options : options?.capture === true;
      const key = `${name}:${type}:${callbacks.get(listener)}:${capture}`;
      if (added) activeListeners.add(key);
      else activeListeners.delete(key);
      audit.globalListeners = {};
      for (const active of activeListeners) {
        const field = active.split(':').slice(0, 2).join(':');
        audit.globalListeners[field] = (audit.globalListeners[field] ?? 0) + 1;
      }
      audit.listenerOperations.push({ at: performance.now(), type, target: name, added, key });
    };
    target.addEventListener = (type, listener, options) => {
      track(type, listener, options, true);
      return add(type, listener, options);
    };
    target.removeEventListener = (type, listener, options) => {
      track(type, listener, options, false);
      return remove(type, listener, options);
    };
  }
  const originalCompile = WebAssembly.compile;
  WebAssembly.compile = async (...args) => {
    const record = { start: performance.now(), end: null, succeeded: false };
    audit.compilations.push(record);
    try {
      const module = await Reflect.apply(originalCompile, WebAssembly, args);
      record.succeeded = true;
      return module;
    } finally {
      record.end = performance.now();
    }
  };
  const OriginalWorker = window.Worker;
  window.Worker = class ObservedWorker extends OriginalWorker {
    constructor(url, options) {
      super(url, options);
      const record = {
        id: audit.workers.length + 1,
        url: String(url),
        createdAt: performance.now(),
        sentAt: null,
        receivedAt: null,
        terminatedAt: null,
        terminateCalls: 0,
        messages: 0,
        messagesAfterTermination: 0,
        kind: null,
        operationId: null,
        moduleId: null,
        responseBytes: null,
        ok: null,
        technical: null,
      };
      audit.workers.push(record);
      audit.maximumActiveWorkers = Math.max(
        audit.maximumActiveWorkers,
        audit.workers.filter((entry) => entry.terminatedAt === null).length,
      );
      this.addEventListener('message', (event) => {
        record.messages++;
        if (record.terminatedAt !== null) record.messagesAfterTermination++;
        record.receivedAt = performance.now();
        record.ok = event.data?.ok ?? null;
        record.responseBytes = event.data?.buffer?.byteLength ?? null;
        const technical = event.data?.technical;
        // Only a fixed bounded numeric vector is copied. No buffer, event,
        // Worker, Module, source, trace, request or result is retained here.
        if (technical && Array.isArray(technical.rust) && technical.rust.length === 27)
          record.technical = {
            wholeWasmCallMs: technical.wholeWasmCallMs,
            wasmPages: technical.wasmPages,
            rust: technical.rust.map((entry) => (Number.isFinite(entry) ? entry : null)),
          };
      });
      const send = this.postMessage.bind(this);
      this.postMessage = (...args) => {
        record.sentAt = performance.now();
        record.kind = args[0]?.kind ?? null;
        record.operationId = args[0]?.operationId ?? null;
        const module = args[0]?.module;
        if (module instanceof WebAssembly.Module) {
          if (!modules.has(module)) modules.set(module, ++audit.moduleCount);
          record.moduleId = modules.get(module);
        }
        return send(...args);
      };
      const terminate = this.terminate.bind(this);
      this.terminate = () => {
        record.terminateCalls++;
        record.terminatedAt ??= performance.now();
        return terminate();
      };
    }
  };
  const snapshot = () => {
    const panel = document.querySelector(
      '[data-testid="case-execution"], [data-testid="practice-execution"]',
    );
    const controls = panel?.querySelector('[data-testid="player-controls"]');
    return {
      state: panel?.getAttribute('data-state') ?? null,
      cursor: controls?.getAttribute('data-cursor') ?? null,
      length: controls?.getAttribute('data-length') ?? null,
      playerStatus: controls?.getAttribute('data-player-status') ?? null,
      traceCursor:
        panel?.querySelector('[data-testid="trace-view"]')?.getAttribute('data-cursor') ?? null,
      resultSteps: panel?.querySelector('[data-testid="execution-steps"]')?.textContent ?? null,
      output:
        panel?.querySelector('[data-testid="execution-output"], [data-testid="practice-stdout"]')
          ?.textContent ?? null,
      activeWorkers: audit.workers.filter((entry) => entry.terminatedAt === null).length,
    };
  };
  document.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest?.('button');
      const label = button?.textContent.trim();
      if (!['运行示例', '取消运行', '提交练习', '取消提交'].includes(label)) return;
      const live = audit.workers.filter((entry) => entry.terminatedAt === null);
      audit.intents.push({
        label,
        at: performance.now(),
        trusted: event.isTrusted,
        before: snapshot(),
        liveAtClick: live.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          sentAt: entry.sentAt,
          receivedAt: entry.receivedAt,
        })),
        end: null,
        stable: null,
      });
    },
    true,
  );
  document.addEventListener(
    'input',
    (event) =>
      audit.edits.push({
        at: performance.now(),
        trusted: event.isTrusted,
        testId: event.target.getAttribute?.('data-testid') ?? null,
        label: event.target.getAttribute?.('aria-label') ?? null,
      }),
    true,
  );
  let lastSignature;
  const pending = new WeakSet();
  const inspect = () => {
    const state = snapshot();
    const signature = JSON.stringify(state);
    if (signature !== lastSignature) {
      lastSignature = signature;
      audit.transitions.push({ at: performance.now(), ...state });
    }
    const intent = audit.intents.at(-1);
    if (!intent || intent.end !== null || pending.has(intent)) return;
    const cancelling = ['取消运行', '取消提交'].includes(intent.label);
    const terminal = cancelling
      ? state.state === 'cancelled' && state.activeWorkers === 0
      : state.state !== null &&
        !['running', 'preparing', 'ready', 'unprepared', 'loading'].includes(state.state) &&
        state.activeWorkers === 0;
    if (!terminal) return;
    pending.add(intent);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const stable = snapshot();
        if (
          stable.state !== state.state ||
          stable.activeWorkers !== 0 ||
          (cancelling && stable.state !== 'cancelled')
        ) {
          pending.delete(intent);
          return;
        }
        intent.end = performance.now();
        intent.stable = stable;
      }),
    );
  };
  const observe = () =>
    new MutationObserver(inspect).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });
  if (document.documentElement) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });
}

function readLifecycleAudit() {
  return window.__productLifecycle;
}

function readProductState() {
  const panel = document.querySelector(
    '[data-testid="case-execution"], [data-testid="practice-execution"]',
  );
  const controls = panel?.querySelector('[data-testid="player-controls"]');
  const view = panel?.querySelector('[data-testid="trace-view"]');
  const source = panel?.querySelector('textarea[aria-label="当前执行的 C 代码"]');
  return {
    route: window.location.hash,
    state: panel?.getAttribute('data-state') ?? null,
    cursor: controls?.getAttribute('data-cursor') ?? null,
    length: controls?.getAttribute('data-length') ?? null,
    playerStatus: controls?.getAttribute('data-player-status') ?? null,
    traceCursor: view?.getAttribute('data-cursor') ?? null,
    views: document.querySelectorAll('[data-testid="trace-view"]').length,
    resultSteps: panel?.querySelector('[data-testid="execution-steps"]')?.textContent ?? null,
    output:
      panel?.querySelector('[data-testid="execution-output"], [data-testid="practice-stdout"]')
        ?.textContent ?? null,
    summaries: [
      ...(panel?.querySelectorAll('[data-testid="practice-feedback"] > ul:first-of-type > li') ??
        []),
    ].map((entry) => entry.textContent.trim()),
    sourcePresent: !!source,
    sourceLength: source?.value.length ?? 0,
    sourceReadonly: source?.hasAttribute('readonly') ?? null,
    sourceContainsThirty: source?.value.includes('int n = 30;') ?? false,
    activeWorkers: window.__productLifecycle.workers.filter((entry) => entry.terminatedAt === null)
      .length,
    environment: {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      devicePixelRatio,
      visible: document.visibilityState,
      focused: document.hasFocus(),
    },
  };
}

const noTrace = (state) =>
  (state.length === '0' || state.length === null) &&
  (state.cursor === '' || state.cursor === null) &&
  (state.traceCursor === '' || state.traceCursor === null) &&
  (state.output === null || state.output === '（无输出）');
const privateTimingsValid = (worker) =>
  worker?.ok === true &&
  Number.isFinite(worker.technical?.wholeWasmCallMs) &&
  worker.technical.rust.length === 27 &&
  worker.technical.rust.every(Number.isFinite) &&
  worker.technical.rust[0] === 1 &&
  worker.technical.rust[13] === 1 &&
  worker.technical.rust[26] === 0 &&
  worker.technical.wasmPages > 0 &&
  worker.technical.wasmPages <= 2048;

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

function memoryTrend(samples, pick) {
  const points = samples
    .filter((entry) => entry.stage === 'rounds')
    .map((entry) => ({ after: entry.after, value: pick(entry) }))
    .filter((entry) => Number.isFinite(entry.value));
  if (!points.length) return { available: false, points: [] };
  const meanX = points.reduce((sum, entry) => sum + entry.after, 0) / points.length;
  const meanY = points.reduce((sum, entry) => sum + entry.value, 0) / points.length;
  const denominator = points.reduce((sum, entry) => sum + (entry.after - meanX) ** 2, 0);
  return {
    available: true,
    points,
    first: points[0].value,
    last: points.at(-1).value,
    delta: points.at(-1).value - points[0].value,
    linearSlopePerRound: denominator
      ? points.reduce((sum, entry) => sum + (entry.after - meanX) * (entry.value - meanY), 0) /
        denominator
      : null,
    range: stats(points.map((entry) => entry.value)),
    interpretation: 'Descriptive unforced-GC trend only; slope and delta do not classify a leak.',
  };
}

function windowsProcessMemory(processes) {
  if (process.platform !== 'win32')
    return { available: false, reason: 'Windows host query unavailable' };
  const ids = [...new Set(processes.map((entry) => Number(entry.id)))];
  if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))
    return { available: false, reason: 'Owned browser did not provide valid OS process IDs' };
  try {
    // Only digits from this owned browser's CDP SystemInfo process inventory are interpolated.
    const command = `$taskProcessIds = @(${ids.join(',')}); $taskProcessRows = foreach ($taskProcessId in $taskProcessIds) { $taskProcess = Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue; if ($taskProcess) { [pscustomobject]@{ id = $taskProcess.Id; name = $taskProcess.ProcessName; workingSetBytes = $taskProcess.WorkingSet64; privateBytes = $taskProcess.PrivateMemorySize64; pagedBytes = $taskProcess.PagedMemorySize64; cpuSeconds = $taskProcess.CPU } } }; ConvertTo-Json -InputObject @($taskProcessRows) -Compress`;
    const text = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      },
    );
    const rows = JSON.parse(text.replace(/^\uFEFF/, ''));
    return {
      available: true,
      scope: 'OS IDs returned immediately beforehand by this owned browser CDP session only',
      requestedIds: ids,
      exitedOrUnavailableIds: ids.filter((id) => !rows.some((entry) => entry.id === id)),
      rows,
      totals: {
        workingSetBytes: rows.reduce((sum, entry) => sum + entry.workingSetBytes, 0),
        privateBytes: rows.reduce((sum, entry) => sum + entry.privateBytes, 0),
      },
      caveat:
        'Process exits and native allocators vary; working sets may share physical pages. Summed working sets are not unique resident memory, and private bytes are not a trace-retention counter.',
    };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

let service;
let browser;
let context;
const report = {
  task: '11.4',
  kind: 'real product single-view alternating completion/cancellation and cleanup',
  startedAt: new Date().toISOString(),
  browser: browserName,
  roundsRequested: rounds,
  expectedFormalRounds: 50,
  workload: { key: workload.key, caseId: workload.caseId, inputLength: 30, input: workload.values },
  thresholds: { cancelStablePaintMs: 100, originalSafetyMs: 1000, normalExecutionMsSeparate: 500 },
  normalExecutionTimingInterpretation:
    'Completion timings are retained here but not used to waive the separate 500 ms execution matrix. A valid lifecycle completion must still be a real accepted full-size program result.',
  observationBoundary:
    'No /checks API, injected execution inputs/results, raw result retention, forced GC, protocol changes, test clock, delayed Worker, changed budget or copied trace. Native UI controls and genuine isTrusted events are required. Worker metadata contains fixed numeric private phases and byte lengths only; Module and callback IDs use WeakMap.',
  memoryInterpretation:
    'Repeated post-settlement JS heap, DOM counters, WASM pages and owned browser OS process samples are trend observations. Natural GC and native process allocators may make them non-monotonic. No fixed leak threshold is invented, no single forced GC is used, and these observations alone cannot prove every internal trajectory/subscription/timer or host allocation is released.',
  listenerBoundary:
    'Instrumentation observes add/remove pairs only for window/document scroll, resize and visibilitychange. It records strings/numbers with weak callback IDs. Product uses ordinary explicit removal for these handlers; this is not an inventory of all internal React or service subscriptions.',
  stockFirefox: {
    measured: false,
    reason:
      'This script supports installed native Chrome/Edge only; stock Firefox requires its own native driver and must not inherit these results.',
  },
  suppliedHostConditions: JSON.parse(
    readFileSync(
      isAbsolute(process.env.PERF_HOST_REPORT ?? '')
        ? process.env.PERF_HOST_REPORT
        : join(
            workspaceDir,
            process.env.PERF_HOST_REPORT ?? '.artifacts/11.4/conditions-host.json',
          ),
    ),
  ),
  hashes: Object.fromEntries(
    [
      'scripts/performance-product-lifecycle.mjs',
      'scripts/performance-browser.mjs',
      'scripts/serve-performance.mjs',
      'web/src/generated/c_viz_wasm_bg.wasm',
      'web/src/components/CaseExecution.tsx',
      'web/src/practice/session.ts',
      'web/src/practice/react.tsx',
      'web/src/player/controller.ts',
      'web/src/player/model.ts',
      'web/src/engine/execution-client.ts',
    ].map((path) => [path, sha(readFileSync(join(workspaceDir, path)))]),
  ),
  rounds: [],
  memorySamples: [],
  extraChecks: {},
};

async function memorySample(page, cdp, browserCdp, after, stage) {
  const at = new Date().toISOString();
  const [metrics, dom, audit, processInfo, pageMemory] = await Promise.all([
    cdp.send('Performance.getMetrics').catch((error) => ({ unavailable: error.message })),
    cdp.send('Memory.getDOMCounters').catch((error) => ({ unavailable: error.message })),
    page.evaluate(readLifecycleAudit),
    browserCdp.send('SystemInfo.getProcessInfo').catch((error) => ({ unavailable: error.message })),
    page.evaluate(() => {
      const memory = performance.memory;
      return memory
        ? {
            used: memory.usedJSHeapSize,
            total: memory.totalJSHeapSize,
            limit: memory.jsHeapSizeLimit,
          }
        : null;
    }),
  ]);
  const sample = {
    at,
    after,
    stage,
    metrics,
    dom,
    optionalPageMemory: pageMemory,
    workerCount: audit.workers.length,
    liveWorkers: audit.workers.filter((entry) => entry.terminatedAt === null).length,
    maximumActiveWorkers: audit.maximumActiveWorkers,
    cachedModuleIdsObserved: audit.moduleCount,
    compileCalls: audit.compilations.length,
    globalListeners: audit.globalListeners,
    lastCompletedWasmPages:
      audit.workers.findLast((entry) => entry.technical)?.technical.wasmPages ?? null,
    processInfo,
    processMemory: processInfo.processInfo
      ? windowsProcessMemory(processInfo.processInfo)
      : { available: false, reason: processInfo.unavailable },
  };
  report.memorySamples.push(sample);
  writeNew(`memory-${stage}-${after}.json`, sample);
  return sample;
}

async function waitIntent(page, index, label) {
  await page.waitForFunction(
    ({ index, label }) => {
      const audit = window.__productLifecycle;
      return (
        audit.intents.length === index + 1 &&
        audit.intents[index]?.label === label &&
        audit.intents[index].end !== null
      );
    },
    { index, label },
    { timeout: 5000 },
  );
  return (await page.evaluate(readLifecycleAudit)).intents[index];
}

try {
  report.hostConditions = capturePerformanceHost(output, 'start');
  service = await startPerformanceServer({ logPrefix: `.artifacts/11.4/${label}/network` });
  const options = performanceBrowserOptions(browserName, service.metadata);
  browser = await chromium.launch(options.launchOptions);
  context = await browser.newContext(options.contextOptions);
  report.server = service.metadata;
  report.browserVersion = browser.version();
  report.certificateAcceptance = options.certificateAcceptance;
  await context.addInitScript(installLifecycleObserver);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const browserCdp = await browser.newBrowserCDPSession();
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await page.bringToFront();
  await page.goto(`${service.origin}/#/visualize/${workload.caseId}`);
  const panel = page.getByTestId('case-execution');
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="case-execution"]')?.getAttribute('data-state') ===
      'ready',
  );
  await page.getByTestId('input-field-values').fill(workload.values.values.join(', '));
  await panel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="case-execution"]')?.getAttribute('data-state') ===
      'ready',
  );
  const source = panel.getByRole('textbox', { name: '当前执行的 C 代码', exact: true });
  report.sourceSha256 = sha(await source.inputValue());
  report.initial = await page.evaluate(readProductState);
  report.beforeRounds = await page.evaluate(readLifecycleAudit);
  assert.equal(
    report.beforeRounds.workers.length,
    0,
    'Published preparation must leave the first execution cold',
  );
  assert.equal(
    report.beforeRounds.compilations.length,
    0,
    'No passive or preparation Module compilation',
  );
  assert.equal(report.initial.sourceContainsThirty, true);
  assert.equal(report.initial.sourceReadonly, true);
  await memorySample(page, cdp, browserCdp, 0, 'rounds');
  for (let round = 1; round <= rounds; round++) {
    const cancel = round % 2 === 0;
    const before = await page.evaluate(readLifecycleAudit);
    const runIndex = before.intents.length;
    await panel.getByRole('button', { name: '运行示例', exact: true }).click();
    let cancelIntent = null;
    let failure = null;
    try {
      if (cancel) {
        await page.waitForFunction(
          (beforeWorkers) => {
            const audit = window.__productLifecycle;
            const worker = audit.workers[beforeWorkers];
            return (
              audit.workers.length === beforeWorkers + 1 &&
              worker?.kind === 'execute' &&
              worker.sentAt !== null &&
              worker.receivedAt === null &&
              worker.terminatedAt === null &&
              document
                .querySelector('[data-testid="case-execution"]')
                ?.getAttribute('data-state') === 'running'
            );
          },
          before.workers.length,
          { timeout: 5000, polling: 1 },
        );
        await panel.getByRole('button', { name: '取消运行', exact: true }).click();
        cancelIntent = await waitIntent(page, runIndex + 1, '取消运行');
      } else await waitIntent(page, runIndex, '运行示例');
    } catch (error) {
      failure = { message: error.message };
    }
    const audit = await page.evaluate(readLifecycleAudit);
    const stable = await page.evaluate(readProductState);
    const worker = audit.workers[before.workers.length];
    const runIntent = audit.intents[runIndex];
    // This is outside cancellation timing. It gives queued native work a chance
    // to arrive; a late terminal replacement is preserved as a failed round.
    await page.waitForTimeout(150);
    const lateAudit = await page.evaluate(readLifecycleAudit);
    const late = await page.evaluate(readProductState);
    const controls = {
      noHarness: !new URL(page.url()).hash.includes('/checks'),
      trustedRun: runIntent?.trusted === true && runIntent.label === '运行示例',
      exactIntentCount: audit.intents.length === runIndex + (cancel ? 2 : 1),
      freshDispatchedWorker:
        audit.workers.length === before.workers.length + 1 &&
        worker?.kind === 'execute' &&
        worker.sentAt !== null &&
        typeof worker.operationId === 'string',
      boundedSingleWorker: audit.maximumActiveWorkers === 1 && stable.activeWorkers === 0,
      workerTerminated: worker?.terminatedAt !== null && worker?.terminateCalls === 1,
      noLateWorkerMessages: lateAudit.workers.every(
        (entry) => entry.messagesAfterTermination === 0,
      ),
      oneReadonlyModule:
        audit.moduleCount === 1 &&
        worker?.moduleId === 1 &&
        audit.compilations.length === 1 &&
        audit.compilations[0].succeeded,
      realSourceAndScale:
        stable.sourcePresent &&
        stable.sourceReadonly &&
        stable.sourceContainsThirty &&
        sha(await source.inputValue()) === report.sourceSha256,
      foreground:
        stable.environment.visible === 'visible' &&
        stable.environment.focused &&
        late.environment.visible === 'visible' &&
        late.environment.focused,
      exactViewport:
        stable.environment.viewport[0] === 1440 &&
        stable.environment.viewport[1] === 900 &&
        stable.environment.devicePixelRatio === 1,
      oneView: stable.views === 1,
      expectedOutcome: cancel
        ? stable.state === 'cancelled' && noTrace(stable)
        : stable.state === 'completed' &&
          Number(stable.length) > 0 &&
          stable.cursor === '0' &&
          stable.output === workload.stdout &&
          privateTimingsValid(worker),
      trustedDispatchedCancel:
        !cancel ||
        (cancelIntent?.trusted === true &&
          cancelIntent.before.state === 'running' &&
          cancelIntent.liveAtClick.length === 1 &&
          cancelIntent.liveAtClick[0].kind === 'execute' &&
          cancelIntent.liveAtClick[0].sentAt !== null &&
          cancelIntent.liveAtClick[0].receivedAt === null),
      cancelStablePaint:
        !cancel ||
        (cancelIntent?.end != null &&
          cancelIntent.end - cancelIntent.at <= 100 &&
          noTrace(cancelIntent.stable)),
      noLateReplacement:
        JSON.stringify(stable) === JSON.stringify(late) &&
        lateAudit.intents.length === audit.intents.length &&
        lateAudit.workers.length === audit.workers.length,
    };
    const sample = {
      round,
      requested: cancel ? 'cancelled' : 'completed',
      failure,
      completionMs: !cancel && runIntent?.end != null ? runIntent.end - runIntent.at : null,
      cancelMs: cancelIntent?.end != null ? cancelIntent.end - cancelIntent.at : null,
      intent: runIntent,
      cancelIntent,
      worker,
      stable,
      late,
      transitionRange: lateAudit.transitions.slice(before.transitions.length),
      controls,
      passed: !failure && Object.values(controls).every(Boolean),
    };
    report.rounds.push(sample);
    writeNew(`round-${String(round).padStart(2, '0')}.json`, sample);
    console.log(
      JSON.stringify({
        round,
        requested: sample.requested,
        state: stable.state,
        cancelMs: sample.cancelMs,
        passed: sample.passed,
        controls,
      }),
    );
    if (round % 5 === 0) await memorySample(page, cdp, browserCdp, round, 'rounds');
    if (failure)
      throw new Error(
        `Round ${round} could not finish the real requested action: ${failure.message}`,
      );
  }
  report.afterRounds = await page.evaluate(readLifecycleAudit);
  await page.screenshot({ path: join(output, 'after-rounds.png'), fullPage: true });

  // The alternating sequence ends cancelled. Obtain a separate genuine accepted
  // trace before editing so invalidation is not tested against an already empty view.
  const beforeInputRun = await page.evaluate(readLifecycleAudit);
  await panel.getByRole('button', { name: '运行示例', exact: true }).click();
  await waitIntent(page, beforeInputRun.intents.length, '运行示例');
  const acceptedBeforeInput = await page.evaluate(readProductState);
  assert.equal(acceptedBeforeInput.state, 'completed');
  assert.ok(Number(acceptedBeforeInput.length) > 0);
  assert.equal(acceptedBeforeInput.output, workload.stdout);
  // A native input edit must clear the last run, then generate different real C.
  const beforeInput = await page.evaluate(readLifecycleAudit);
  const changedValues = [...workload.values.values];
  changedValues[0] = 29;
  await page.getByTestId('input-field-values').fill(changedValues.join(', '));
  const edited = await page.evaluate(readProductState);
  await panel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="case-execution"]')?.getAttribute('data-state') ===
      'ready',
  );
  const changedSourceText = await source.inputValue();
  const changedSource = sha(changedSourceText);
  const prepared = await page.evaluate(readProductState);
  const afterInput = await page.evaluate(readLifecycleAudit);
  report.extraChecks.inputEdit = {
    acceptedBeforeInput,
    edited,
    prepared,
    changedSourceSha256: changedSource,
    controls: {
      trustedEdit:
        afterInput.edits.length > beforeInput.edits.length &&
        afterInput.edits.slice(beforeInput.edits.length).every((entry) => entry.trusted),
      sourceAndTraceInvalidated:
        edited.state === 'unprepared' &&
        edited.sourceLength === 0 &&
        edited.resultSteps === null &&
        edited.views === 0 &&
        noTrace(edited),
      changedRealReadonlySource:
        prepared.sourceReadonly &&
        changedSource !== report.sourceSha256 &&
        prepared.sourceContainsThirty,
      changedArrayDeclaration: changedSourceText.includes(
        `int values[30] = {${changedValues.join(', ')}};`,
      ),
      noExecutionOrRecompile:
        afterInput.workers.length === beforeInput.workers.length &&
        afterInput.compilations.length === beforeInput.compilations.length,
    },
  };

  // Leave a playing genuine case trace and verify actual handler removal and no
  // old view revival after more than the original 500 ms player tick interval.
  const beforeExtra = await page.evaluate(readLifecycleAudit);
  await panel.getByRole('button', { name: '运行示例', exact: true }).click();
  await waitIntent(page, beforeExtra.intents.length, '运行示例');
  assert.equal(
    await panel.getAttribute('data-state'),
    'completed',
    'Cleanup check needs a real completed trace',
  );
  await page
    .getByTestId('player-controls')
    .getByRole('button', { name: '播放', exact: true })
    .click();
  const playing = await page.evaluate(readProductState);
  const listenersWithCase = (await page.evaluate(readLifecycleAudit)).globalListeners;
  await page.getByRole('link', { name: 'C 语言课程', exact: true }).first().click();
  await page.getByTestId('course-reading').waitFor();
  await page.waitForTimeout(650);
  const afterLeave = await page.evaluate(readLifecycleAudit);
  const left = await page.evaluate(readProductState);
  report.extraChecks.caseLeave = {
    playing,
    left,
    listenersWithCase,
    listenersAfterLeave: afterLeave.globalListeners,
    controls: {
      wasPlaying: playing.playerStatus === 'playing',
      noViewOrSourceRevival:
        left.route === '#/courses' &&
        left.views === 0 &&
        left.state === null &&
        !left.sourcePresent,
      noLiveWorker:
        left.activeWorkers === 0 &&
        afterLeave.workers.every((entry) => entry.terminatedAt !== null),
      caseHandlersRemoved:
        (afterLeave.globalListeners['window:scroll'] ?? 0) === 0 &&
        (afterLeave.globalListeners['window:resize'] ?? 0) === 0 &&
        (afterLeave.globalListeners['document:visibilitychange'] ?? 0) <
          (listenersWithCase['document:visibilitychange'] ?? 0),
      noNewExecution: afterLeave.workers.length === beforeExtra.workers.length + 1,
    },
  };
  await memorySample(page, cdp, browserCdp, rounds, 'case-left');

  // Code-edit invalidation uses the real accessible Blockly editor, never an
  // injected source string or a protocol/harness shortcut.
  await page.locator('a[href="#/lessons/lesson.c.variables-output"]').first().click();
  await page.locator('a[href="#/practice/exercise.c.echo"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="practice-execution"]')?.getAttribute('data-state') ===
      'ready',
  );
  await correctStarter(page, 'exercise.c.echo');
  const practicePanel = page.getByTestId('practice-execution');
  const beforeSubmit = await page.evaluate(readLifecycleAudit);
  await practicePanel.getByRole('button', { name: '提交练习', exact: true }).click();
  await waitIntent(page, beforeSubmit.intents.length, '提交练习');
  const passed = await page.evaluate(readProductState);
  const passedSourceText = await practicePanel
    .getByRole('textbox', { name: '当前执行的 C 代码', exact: true })
    .inputValue();
  const passedSourceSha256 = sha(passedSourceText);
  const beforeCodeEdit = await page.evaluate(readLifecycleAudit);
  await wrongEcho(page);
  const codeEdited = await page.evaluate(readProductState);
  const editedSourceText = await practicePanel
    .getByRole('textbox', { name: '当前执行的 C 代码', exact: true })
    .inputValue();
  const editedSourceSha256 = sha(editedSourceText);
  const echoWithNewline = 'printf("%d\\n", x);';
  const echoWithoutNewline = 'printf("%d", x);';
  await page.waitForTimeout(150);
  const codeLate = await page.evaluate(readProductState);
  const afterCodeEdit = await page.evaluate(readLifecycleAudit);
  const formatEdits = afterCodeEdit.edits
    .slice(beforeCodeEdit.edits.length)
    .filter((entry) => entry.label === '输出格式');
  report.extraChecks.blockCodeEdit = {
    passed,
    codeEdited,
    codeLate,
    passedSourceSha256,
    editedSourceSha256,
    controls: {
      genuineAcceptedSubmission:
        passed.state === 'passed' &&
        passed.summaries.length === 3 &&
        passed.summaries.every((entry) => entry.endsWith('：本组通过')) &&
        beforeCodeEdit.workers.length === beforeSubmit.workers.length + 3 &&
        beforeCodeEdit.workers.slice(beforeSubmit.workers.length).every(privateTimingsValid),
      trustedCodeEdit: formatEdits.length > 0 && formatEdits.every((entry) => entry.trusted),
      readonlyCChanged: codeEdited.sourceReadonly && passedSourceSha256 !== editedSourceSha256,
      outputStatementChanged:
        passedSourceText.includes(echoWithNewline) &&
        !passedSourceText.includes(echoWithoutNewline) &&
        editedSourceText.includes(echoWithoutNewline) &&
        !editedSourceText.includes(echoWithNewline),
      judgementAndTraceCleared:
        codeEdited.state === 'ready' && codeEdited.summaries.length === 0 && noTrace(codeEdited),
      noLateRestoration: JSON.stringify(codeEdited) === JSON.stringify(codeLate),
      noHiddenRerun: afterCodeEdit.workers.length === beforeCodeEdit.workers.length,
    },
  };
  await page.getByRole('link', { name: 'C 语言课程', exact: true }).first().click();
  await page.getByTestId('course-reading').waitFor();
  await page.waitForTimeout(650);
  report.finalProduct = await page.evaluate(readProductState);
  report.finalAudit = await page.evaluate(readLifecycleAudit);
  await memorySample(page, cdp, browserCdp, rounds, 'all-left');
  await page.screenshot({ path: join(output, 'after-cleanup.png'), fullPage: true });
  writeNew('extra-checks.json', report.extraChecks);
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const [name, action] of [
    ['context.close', () => context?.close()],
    ['browser.close', () => browser?.close()],
    ['server.stop', () => service?.stop()],
  ]) {
    try {
      await action();
    } catch (error) {
      (report.teardownErrors ??= []).push({ action: name, message: error.message });
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
    rounds === 50 &&
    report.rounds.length === 50 &&
    report.rounds.filter((entry) => entry.requested === 'completed').length === 25 &&
    report.rounds.filter((entry) => entry.requested === 'cancelled').length === 25;
  report.extraChecksPassed =
    Object.keys(report.extraChecks).length === 3 &&
    Object.values(report.extraChecks).every((entry) =>
      Object.values(entry.controls).every(Boolean),
    );
  report.summary = {
    completed: report.rounds.filter((entry) => entry.requested === 'completed' && entry.passed)
      .length,
    cancelled: report.rounds.filter((entry) => entry.requested === 'cancelled' && entry.passed)
      .length,
    failures: report.rounds.filter((entry) => !entry.passed).map((entry) => entry.round),
    cancellationMs: stats(report.rounds.map((entry) => entry.cancelMs)),
    completionMs: stats(report.rounds.map((entry) => entry.completionMs)),
    wasmPages: stats(report.rounds.map((entry) => entry.worker?.technical?.wasmPages)),
    maximumActiveWorkers: report.afterRounds?.maximumActiveWorkers ?? null,
    compileCalls: report.afterRounds?.compilations.length ?? null,
    moduleCount: report.afterRounds?.moduleCount ?? null,
    uniqueRoundWorkers: new Set(report.rounds.map((entry) => entry.worker?.id)).size,
    uniqueRoundOperations: new Set(report.rounds.map((entry) => entry.worker?.operationId)).size,
    forcedGcCalls: 0,
  };
  const metric = (sample, name) =>
    sample.metrics.metrics?.find((entry) => entry.name === name)?.value;
  report.memoryTrends = {
    jsHeapUsedBytes: memoryTrend(report.memorySamples, (entry) => metric(entry, 'JSHeapUsedSize')),
    jsHeapTotalBytes: memoryTrend(report.memorySamples, (entry) =>
      metric(entry, 'JSHeapTotalSize'),
    ),
    domNodes: memoryTrend(report.memorySamples, (entry) => entry.dom.nodes),
    jsEventListeners: memoryTrend(report.memorySamples, (entry) => entry.dom.jsEventListeners),
    lastCompletedWasmPages: memoryTrend(
      report.memorySamples,
      (entry) => entry.lastCompletedWasmPages,
    ),
    browserPrivateBytes: memoryTrend(
      report.memorySamples,
      (entry) => entry.processMemory.totals?.privateBytes,
    ),
    browserSummedWorkingSetBytes: memoryTrend(
      report.memorySamples,
      (entry) => entry.processMemory.totals?.workingSetBytes,
    ),
  };
  report.hostBaseline = qualifyPerformanceHost(report.hostConditions, report.hostConditionsEnd);
  report.lifecyclePass =
    report.hostBaseline.satisfied &&
    report.complete &&
    report.rounds.every((entry) => entry.passed) &&
    report.extraChecksPassed &&
    report.summary.maximumActiveWorkers === 1 &&
    report.summary.compileCalls === 1 &&
    report.summary.moduleCount === 1 &&
    report.summary.uniqueRoundWorkers === 50 &&
    report.summary.uniqueRoundOperations === 50 &&
    report.finalProduct?.views === 0 &&
    report.finalProduct?.activeWorkers === 0 &&
    !report.teardownErrors?.length;
  report.memoryLeakAcceptance =
    'Requires human comparison of repeated trends plus the independent source/test audit; this script does not claim zero leaks or assign a fabricated numeric memory threshold.';
  writeNew('report.json', report);
  if (!report.lifecyclePass) process.exitCode = 1;
}
