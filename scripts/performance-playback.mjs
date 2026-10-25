/* global window, document, performance, PerformanceObserver, MutationObserver, requestAnimationFrame, innerWidth, innerHeight, devicePixelRatio, navigator, screen, location, crypto, atob, Blob, createImageBitmap */
// Native, unaccelerated playback of a real Rust-produced 30-item reverse trace.
// rAF is scheduling evidence; CDP drawing and decoded screenshots are separate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { release, totalmem, version as osVersion } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { performanceBrowserOptions } from './performance-browser.mjs';
import { installPerformanceObserver } from './performance-observer.mjs';
import { performanceCases } from './performance-workloads.mjs';
import { workspaceDir } from './process.mjs';
import { capturePerformanceHost, qualifyPerformanceHost } from './performance-host.mjs';
import { startPerformanceServer } from './serve-performance.mjs';

const startupMs = 2000;
const stableMs = 30_000;
const captureMs = startupMs + stableMs;
const frameMeasureName = 'cviz.player.frame';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const categories = [
  '-*',
  'devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.layers',
  'disabled-by-default-devtools.screenshot',
  'cc',
  'viz',
  'benchmark',
  'blink.user_timing',
  'toplevel',
];

export function playbackStats(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const n = sorted.length;
  return {
    n,
    min: n ? sorted[0] : null,
    median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null,
    p95: n ? sorted[Math.ceil(n * 0.95) - 1] : null,
    max: n ? sorted[n - 1] : null,
  };
}
const intervals = (timestamps) =>
  timestamps.slice(1).map((value, index) => value - timestamps[index]);

/** Plain test observation only: no product methods, trace injection, synthetic
 * state, changed timers, changed playback speed, or forced GC. */
export function installPlaybackProbe({ startMark, endMark, captureMs, frameMeasureName }) {
  const audit = (window.__playbackPerformanceAudit = {
    startMark,
    endMark,
    captureMs,
    armed: false,
    startAt: null,
    endAt: null,
    recording: false,
    raf: [],
    changes: [],
    statusChanges: [],
    frameWork: [],
    longTasks: [],
    actions: [],
    visibility: [{ at: performance.now(), state: document.visibilityState }],
    focus: [{ at: performance.now(), value: document.hasFocus() }],
    supports: { longtask: false, measure: false },
  });
  let cursor = null;
  let status = null;
  const rectOf = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const intersects = (rect, clip) =>
    !!rect &&
    rect.width > 0 &&
    rect.height > 0 &&
    rect.x < Math.min(innerWidth, clip.x + clip.width) &&
    rect.x + rect.width > Math.max(0, clip.x) &&
    rect.y < Math.min(innerHeight, clip.y + clip.height) &&
    rect.y + rect.height > Math.max(0, clip.y);
  // A noncryptographic DOM fingerprint detects state/attribute changes without
  // retaining code, input, output or raw trace values in measurement metadata.
  function fingerprint(element) {
    let value = 2166136261;
    const text = element?.outerHTML ?? '';
    for (let index = 0; index < text.length; index++)
      value = Math.imul(value ^ text.charCodeAt(index), 16777619);
    return (value >>> 0).toString(16).padStart(8, '0');
  }
  function snapshot() {
    const controls = document.querySelector('[data-testid="player-controls"]');
    const view = document.querySelector('[data-testid="trace-view"]');
    const array = view?.querySelector('[data-testid="trace-array"][data-logical-length="30"]');
    const chart = array?.querySelector('.array-chart-scroll');
    const chartRect = rectOf(chart);
    const cells = [...(array?.querySelectorAll('[data-testid="trace-array-cell"]') ?? [])];
    return {
      at: performance.now(),
      cursor: Number(controls?.getAttribute('data-cursor')),
      status: controls?.getAttribute('data-player-status') ?? null,
      length: Number(controls?.getAttribute('data-length')),
      rate: controls?.querySelector('select[aria-label="播放速度"]')?.value ?? null,
      logicalLength: array ? Number(array.getAttribute('data-logical-length')) : null,
      renderedCells: cells.length,
      visibleCells: chartRect
        ? cells.filter((cell) => intersects(rectOf(cell), chartRect)).length
        : 0,
      chartRect,
      traceRect: rectOf(view),
      domFingerprint: fingerprint(view),
      stepKind:
        view?.querySelector('[data-testid="step-summary"]')?.getAttribute('data-step-kind') ?? null,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
    };
  }
  const inspect = () => {
    if (!audit.recording) return;
    const controls = document.querySelector('[data-testid="player-controls"]');
    const nextCursor = controls?.getAttribute('data-cursor');
    const nextStatus = controls?.getAttribute('data-player-status');
    if (nextCursor !== cursor) {
      cursor = nextCursor;
      audit.changes.push(snapshot());
    }
    if (nextStatus !== status) {
      status = nextStatus;
      audit.statusChanges.push({ at: performance.now(), status: nextStatus });
    }
  };
  function frame(timestamp) {
    if (!audit.recording) return;
    audit.raf.push(timestamp);
    if (timestamp - audit.startAt >= captureMs) {
      inspect();
      audit.endAt = performance.now();
      audit.endState = snapshot();
      performance.mark(endMark, { startTime: audit.endAt });
      audit.recording = false;
    } else requestAnimationFrame(frame);
  }
  function start(event) {
    if (!audit.armed || audit.startAt !== null) return;
    const controls = document.querySelector('[data-testid="player-controls"]');
    if (controls?.getAttribute('data-player-status') === 'playing' || !event.isTrusted) return;
    audit.startAt = performance.now();
    performance.mark(startMark, { startTime: audit.startAt });
    audit.recording = true;
    audit.initialState = snapshot();
    inspect();
    requestAnimationFrame(frame);
  }
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        (event.code !== 'Space' && event.key !== ' ') ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      const target = event.target;
      if (
        !target?.closest?.('[data-testid="player-workspace"]') ||
        target.closest('input,textarea,select,button,a,[contenteditable="true"]')
      )
        return;
      audit.actions.push({ at: performance.now(), kind: 'Space', trusted: event.isTrusted });
      start(event);
    },
    true,
  );
  document.addEventListener('visibilitychange', () =>
    audit.visibility.push({ at: performance.now(), state: document.visibilityState }),
  );
  for (const name of ['focus', 'blur'])
    window.addEventListener(name, () =>
      audit.focus.push({ at: performance.now(), value: document.hasFocus() }),
    );
  const begin = () =>
    new MutationObserver(inspect).observe(document.documentElement, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  if (document.documentElement) begin();
  else document.addEventListener('DOMContentLoaded', begin, { once: true });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        if (entry.name === frameMeasureName)
          audit.frameWork.push({
            start: entry.startTime,
            duration: entry.duration,
            cursor: entry.detail?.cursor ?? null,
            operation: entry.detail?.operation ?? null,
          });
    }).observe({ type: 'measure', buffered: true });
    audit.supports.measure = true;
  } catch {
    /* Missing support stays explicitly unmeasured. */
  }
  try {
    if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          audit.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
      audit.supports.longtask = true;
    }
  } catch {
    /* Not substituted with Paint or rAF durations. */
  }
}

export function readPlaybackProbe() {
  const gl = document.createElement('canvas').getContext('webgl');
  const extension = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    ...window.__playbackPerformanceAudit,
    environment: {
      userAgent: navigator.userAgent,
      viewport: [innerWidth, innerHeight],
      devicePixelRatio,
      visualViewport: window.visualViewport
        ? {
            width: window.visualViewport.width,
            height: window.visualViewport.height,
            scale: window.visualViewport.scale,
          }
        : null,
      screen: [screen.width, screen.height],
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
      hardwareConcurrency: navigator.hardwareConcurrency,
      origin: location.origin,
      serviceWorkerControlled: !!navigator.serviceWorker?.controller,
    },
    resources: performance.getEntriesByType('resource').map((entry) => ({
      url: entry.name,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      duration: entry.duration,
    })),
  };
}

/** Decode the same observed result only after execution has completed. No raw
 * source/input/output/trace escapes into the saved timing metadata. */
export function readRealExecution(expectedStdout) {
  const audit = window.__performanceAudit;
  const retained = audit.buffers.at(-1);
  const worker = retained ? audit.workers[retained.workerIndex] : null;
  if (!retained || worker?.kind !== 'execute') throw new Error('No observed real execution buffer');
  const result = JSON.parse(new TextDecoder().decode(retained.buffer));
  audit.buffers = [];
  return {
    producer: result.producer,
    identity: result.identity,
    engineRef: result.engineRef,
    packageRef: result.packageRef,
    budgetRef: result.budgetRef,
    terminal: result.terminal.status,
    stats: result.stats,
    trace: {
      steps: result.trace?.steps.length,
      checkpoints: result.trace?.checkpoints.length,
      completeness: result.trace?.completeness,
    },
    domOutputMatches:
      document.querySelector('[data-testid="execution-output"]')?.textContent === expectedStdout,
    workers: audit.workers,
    intents: audit.intents,
  };
}

export function readObservableState() {
  const view = document.querySelector('[data-testid="trace-view"]');
  const source = document.querySelector('[data-testid="code-panel"]');
  const controls = document.querySelector('[data-testid="player-controls"]');
  return {
    cursor: Number(controls?.getAttribute('data-cursor')),
    status: controls?.getAttribute('data-player-status'),
    // Used transiently for an SHA-256 equality check, never persisted as content.
    canonical: JSON.stringify({
      view: view?.outerHTML,
      sourceLocation: source?.querySelector('[data-testid="source-location"]')?.textContent,
      sourceHighlights: [...(source?.querySelectorAll('mark[data-testid]') ?? [])].map((mark) =>
        Object.fromEntries(
          ['data-testid', 'data-byte-start', 'data-byte-end', 'data-start', 'data-end'].map(
            (name) => [name, mark.getAttribute(name)],
          ),
        ),
      ),
    }),
  };
}

export function summarizePlaybackWindow(audit, start, duration) {
  const end = start + duration;
  const raf = audit.raf.filter((at) => at >= start && at <= end);
  const gaps = intervals(raf);
  const work = audit.frameWork.filter(
    (entry) =>
      entry.operation === 'tick' && entry.start >= start && entry.start + entry.duration <= end,
  );
  const changes = audit.changes.filter((entry) => entry.at >= start && entry.at <= end);
  const longTasks = audit.longTasks.filter(
    (entry) => entry.start < end && entry.start + entry.duration > start,
  );
  const rafStats = playbackStats(gaps);
  const workStats = playbackStats(work.map((entry) => entry.duration));
  const excessive = gaps.filter((gap) => gap > 33.3).length;
  const gapRatio = gaps.length ? excessive / gaps.length : null;
  return {
    startMs: start,
    endMs: end,
    durationMs: duration,
    rafCallbackCount: raf.length,
    rafGapMs: rafStats,
    rafGapOver33_3Ms: excessive,
    rafGapOver33_3Ratio: gapRatio,
    appFrameWorkMs: workStats,
    applicationMarkerObserved: work.length > 0,
    applicationBoundary:
      'Actual controller tick before projection, snapshot, publish and React waiting, through BasicTraceView useLayoutEffect DOM commit of that exact view. Excludes subsequent browser Paint and learning-coverage rAF work.',
    domCursorChanges: changes.length,
    domFingerprints: new Set(changes.map((entry) => entry.domFingerprint)).size,
    stepGapMs: playbackStats(intervals(changes.map((entry) => entry.at))),
    everyObservedCursorSequential: changes
      .slice(1)
      .every((entry, index) => entry.cursor === changes[index].cursor + 1),
    allObservedArraysHave30Cells:
      changes.length > 0 &&
      changes.every((entry) => entry.logicalLength === 30 && entry.renderedCells === 30),
    minimumVisibleCells: changes.length
      ? Math.min(...changes.map((entry) => entry.visibleCells))
      : null,
    longTasks: {
      count: longTasks.length,
      durationMs: playbackStats(longTasks.map((entry) => entry.duration)),
      entries: longTasks,
    },
    thresholds: { applicationP95Ms: 16.67, rafP95Ms: 20, rafGapOver33_3Ratio: 0.01 },
    metricPasses: {
      applicationWork: work.length ? workStats.p95 <= 16.67 : null,
      rafP95: gaps.length ? rafStats.p95 <= 20 : null,
      rafLargeGapRatio: gapRatio === null ? null : gapRatio <= 0.01,
    },
  };
}

/** Only named drawing/presentation events are counted. Paint records are paint
 * operations, not frames; DrawFrame records are submissions, not proof of a
 * physical display presentation. Unknown pipelines remain unmeasured. */
export function analyzePlaybackTrace(trace, audit) {
  const events = trace.traceEvents ?? [];
  const marker = events.find(
    (event) => event.name === audit.startMark && Number.isFinite(event.ts),
  );
  if (!marker)
    return {
      clockAligned: false,
      reason: 'Page monotonic start mark absent from raw CDP trace',
      screenshots: [],
    };
  const offsetUs = marker.ts - audit.startAt * 1000;
  const rendererPid = marker.pid;
  const inventory = new Map();
  for (const event of events)
    if (/(frame|paint|draw|swap|present)/i.test(event.name ?? '')) {
      const key = `${event.name}|${event.cat}|${event.pid}|${event.tid}|${event.ph}`;
      const entry = inventory.get(key) ?? {
        name: event.name,
        category: event.cat,
        pid: event.pid,
        tid: event.tid,
        phase: event.ph,
        count: 0,
      };
      entry.count++;
      inventory.set(key, entry);
    }
  const screenshots = events
    .filter((event) => event.name === 'Screenshot' && typeof event.args?.snapshot === 'string')
    .map((event) => ({
      ts: event.ts,
      pageMs: (event.ts - offsetUs) / 1000,
      pid: event.pid,
      data: event.args.snapshot,
    }));
  function windowEvents(start, duration) {
    const from = offsetUs + start * 1000;
    const until = from + duration * 1000;
    const selected = events.filter((event) => event.ts >= from && event.ts <= until);
    const names = [
      'DrawFrame',
      'Paint',
      'FramePresented',
      'FrameDisplayed',
      'Display::DrawAndSwap',
      'Display::FrameDisplayed',
      'SubmitCompositorFrame',
    ];
    const pipelines = names.map((name) => {
      const all = selected.filter(
        (event) => event.name === name && !['B', 'b', 'M'].includes(event.ph),
      );
      const renderer = all.filter((event) => event.pid === rendererPid);
      // Other-process compositor events are retained separately. They are never
      // silently merged into a renderer frame or called physical presentation.
      const timestamps = [...new Set(renderer.map((event) => event.ts))].sort((a, b) => a - b);
      return {
        name,
        rendererEvents: renderer.length,
        ownedBrowserAllProcesses: all.length,
        rendererUniqueTimestamps: timestamps.length,
        rendererEventRatePerSecond: timestamps.length / (duration / 1000),
        rendererGapMs: playbackStats(intervals(timestamps).map((gap) => gap / 1000)),
        durationMs: playbackStats(
          renderer.filter((event) => Number.isFinite(event.dur)).map((event) => event.dur / 1000),
        ),
      };
    });
    return {
      startMs: start,
      endMs: start + duration,
      durationMs: duration,
      pipelines,
      rendererPaintObserved: pipelines.some(
        (entry) => entry.name === 'Paint' && entry.rendererEvents > 0,
      ),
      rendererDrawFrameObserved: pipelines.some(
        (entry) => entry.name === 'DrawFrame' && entry.rendererEvents > 0,
      ),
      presentationSignalObserved: pipelines.some(
        (entry) =>
          ['FramePresented', 'FrameDisplayed', 'Display::FrameDisplayed'].includes(entry.name) &&
          entry.ownedBrowserAllProcesses > 0,
      ),
      possibleDroppedFrameEvents: selected
        .filter((event) => /(DroppedFrame|DropFrame)/.test(event.name ?? ''))
        .map((event) => ({
          name: event.name,
          ts: event.ts,
          pid: event.pid,
          tid: event.tid,
          args: event.args,
        })),
      screenshotCount: screenshots.filter(
        (entry) => entry.pageMs >= start && entry.pageMs <= start + duration,
      ).length,
    };
  }
  return {
    clockAligned: true,
    offsetUs,
    rendererPid,
    clockEvidence: {
      name: marker.name,
      traceTimestampUs: marker.ts,
      pageTimestampMs: audit.startAt,
    },
    startup: windowEvents(audit.startAt, startupMs),
    stable: windowEvents(audit.startAt + startupMs, stableMs),
    inventory: [...inventory.values()].sort((a, b) => a.name.localeCompare(b.name)),
    screenshots,
    interpretation:
      'Default playback advances one real DSL step every 500 ms at 1x. Event gaps during unchanged teaching state are retained and cannot by themselves be labelled dropped 60-fps animation frames. rAF callback count is never used as actual drawn-frame count.',
  };
}

async function finishTrace(session, output) {
  let timer;
  let listener;
  const complete = new Promise((resolveComplete, rejectComplete) => {
    listener = (event) => {
      clearTimeout(timer);
      resolveComplete(event);
    };
    session.once('Tracing.tracingComplete', listener);
    timer = setTimeout(
      () => rejectComplete(new Error('Tracing completion was not received')),
      15000,
    );
  });
  let event;
  try {
    [, event] = await Promise.all([session.send('Tracing.end'), complete]);
  } finally {
    clearTimeout(timer);
    session.off('Tracing.tracingComplete', listener);
  }
  assert.ok(event.stream, 'Chromium did not provide the requested raw trace stream');
  const target = join(output, 'playback.trace.json');
  const fd = openSync(target, 'wx');
  try {
    for (;;) {
      const part = await session.send('IO.read', { handle: event.stream, size: 1024 * 1024 });
      writeSync(fd, Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8'));
      if (part.eof) break;
    }
  } finally {
    closeSync(fd);
    await session.send('IO.close', { handle: event.stream });
  }
  return {
    dataLossOccurred: event.dataLossOccurred ?? null,
    rawFile: 'playback.trace.json',
    sha256: hash(readFileSync(target)),
  };
}

/** Pixel decoding occurs after playback and tracing have stopped. It reads
 * browser-produced screenshots; it never renders replacement algorithm state. */
async function decodeScreenshotPixels(page, rows, changes, viewport) {
  const input = rows.map((row) => {
    const nearest = changes.filter((change) => change.at <= row.pageMs).at(-1) ?? changes[0];
    return { pageMs: row.pageMs, data: row.data, crop: nearest?.chartRect ?? null };
  });
  return page.evaluate(
    async ({ input, viewport }) => {
      const result = [];
      let previous = null;
      for (const entry of input) {
        const bytes = Uint8Array.from(atob(entry.data), (value) => value.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const scaleX = canvas.width / viewport[0];
        const scaleY = canvas.height / viewport[1];
        const crop = entry.crop
          ? {
              x: Math.max(0, Math.floor(entry.crop.x * scaleX)),
              y: Math.max(0, Math.floor(entry.crop.y * scaleY)),
              right: Math.min(canvas.width, Math.ceil((entry.crop.x + entry.crop.width) * scaleX)),
              bottom: Math.min(
                canvas.height,
                Math.ceil((entry.crop.y + entry.crop.height) * scaleY),
              ),
            }
          : null;
        const valid = crop && crop.right > crop.x && crop.bottom > crop.y;
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let changedPixels = null;
        if (previous?.length === pixels.length) {
          changedPixels = 0;
          for (let i = 0; i < pixels.length; i += 4)
            if (
              pixels[i] !== previous[i] ||
              pixels[i + 1] !== previous[i + 1] ||
              pixels[i + 2] !== previous[i + 2] ||
              pixels[i + 3] !== previous[i + 3]
            )
              changedPixels++;
        }
        const sha = async (data) =>
          [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('');
        result.push({
          pageMs: entry.pageMs,
          width: canvas.width,
          height: canvas.height,
          rgbaSha256: await sha(pixels),
          changedPixels,
          changedPixelRatio: changedPixels === null ? null : changedPixels / (pixels.length / 4),
          arrayCrop: valid
            ? {
                ...crop,
                rgbaSha256: await sha(
                  ctx.getImageData(crop.x, crop.y, crop.right - crop.x, crop.bottom - crop.y).data,
                ),
              }
            : null,
        });
        previous = pixels;
      }
      return result;
    },
    { input, viewport },
  );
}

async function main() {
  const browserName = process.env.PERF_BROWSER ?? 'chrome';
  const label = process.env.PERF_LABEL ?? `playback-${browserName}`;
  const workloadKey = process.env.PERF_CASE ?? 'bubble-sort-maximum';
  assert.match(label, /^[a-z0-9-]+$/);
  assert.ok(
    ['bubble-sort-maximum', 'selection-sort-maximum'].includes(workloadKey),
    'Use a registered real reverse-30 sorting workload',
  );
  const sample = performanceCases.find((entry) => entry.key === workloadKey);
  assert.ok(sample);
  assert.deepEqual(
    sample.values.values,
    Array.from({ length: 30 }, (_, index) => 30 - index),
  );
  const output = join(workspaceDir, '.artifacts/11.4', label);
  assert.ok(!existsSync(output), 'Use a new PERF_LABEL; old evidence cannot be overwritten');
  mkdirSync(output);
  const writeJson = (name, value) =>
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const report = {
    task: '11.4',
    baseline: 'PERF-BASE-01 V1.0 / BUDGET-P0 V1.0',
    kind: 'Real reverse-30 single-view native playback: 2s startup plus 30s stable window',
    startedAt: new Date().toISOString(),
    browser: browserName,
    browserVersion: null,
    workload: workloadKey,
    workloadSha256: hash(Buffer.from(JSON.stringify(sample))),
    toolSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    packageLockSha256: hash(readFileSync(join(workspaceDir, 'package-lock.json'))),
    observerSha256: hash(readFileSync(new URL('./performance-observer.mjs', import.meta.url))),
    browserConfigurationSha256: hash(
      readFileSync(new URL('./performance-browser.mjs', import.meta.url)),
    ),
    suppliedHostConditions: JSON.parse(
      readFileSync(
        join(workspaceDir, process.env.PERF_HOST_REPORT ?? '.artifacts/11.4/conditions-host.json'),
      ),
    ),
    hostConditions: null,
    hostConditionsEnd: null,
    currentOs: { release: release(), version: osVersion(), totalMemoryBytes: totalmem() },
    observation: {
      startupMs,
      stableMs,
      captureMs,
      defaultRate: 1,
      defaultStepMs: 500,
      frameMeasureName,
      categories,
    },
    boundary:
      'Preparation and a successful complete real Rust execution are setup, not a cold-module or 500ms acceptance sample. No result injection, changed scheduling, acceleration, or omitted DSL state. All requests and Workers use the shared production HTTPS shaping service.',
    traceOverhead:
      'CDP timeline/compositor tracing, screenshot capture, rAF scheduling, per-cursor DOM fingerprint and rectangle reads add observation overhead; all raw measurements include it. Pixel decoding, WebGL query, cryptographic state hashing and functional checks run after the stable timing window.',
    privacy:
      'Only public project-authored fixtures are used. Technical JSON contains hashes/counts/timings; CDP trace screenshots preserve the actual public teaching UI. No private learner archive, raw result packet or user source is exported.',
    pageErrors: [],
    networkFailures: [],
    workers: [],
    cleanupErrors: [],
  };
  let service;
  let browser;
  let page;
  let session;
  let tracing = false;
  const bufferUsage = [];
  try {
    try {
      report.hostConditions = capturePerformanceHost(output, 'start');
    } catch (error) {
      report.hostCaptureFailure = { start: { message: error.message, stack: error.stack } };
      throw error;
    }
    assert.ok(
      qualifyPerformanceHost(report.hostConditions, undefined).checks.startQualified,
      'The live start snapshot must satisfy the reference machine, AC/Balanced power and exact active-display metadata at 59.9..60.1Hz',
    );
    service = await startPerformanceServer({ logPrefix: `.artifacts/11.4/${label}/network` });
    report.server = service.metadata;
    const browserOptions = performanceBrowserOptions(browserName, service.metadata);
    report.browserConfiguration = browserOptions;
    browser = await chromium.launch(browserOptions.launchOptions);
    report.browserVersion = browser.version();
    const browserSession = await browser.newBrowserCDPSession();
    report.browserProtocol = await browserSession.send('Browser.getVersion');
    await browserSession.detach();
    const context = await browser.newContext(browserOptions.contextOptions);
    await context.addInitScript(installPerformanceObserver);
    const startMark = `cviz.playback.${label}.start`;
    const endMark = `cviz.playback.${label}.end`;
    await context.addInitScript(installPlaybackProbe, {
      startMark,
      endMark,
      captureMs,
      frameMeasureName,
    });
    page = await context.newPage();
    session = await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.clearBrowserCache');
    const requests = [];
    session.on('Network.requestWillBeSent', (event) =>
      requests.push({ url: event.request.url, type: event.type, at: event.timestamp }),
    );
    session.on('Network.loadingFailed', (event) =>
      report.networkFailures.push({
        requestId: event.requestId,
        error: event.errorText,
        cancelled: event.canceled ?? false,
      }),
    );
    session.on('Tracing.bufferUsage', (event) => bufferUsage.push(event));
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('worker', (worker) => report.workers.push({ url: worker.url() }));
    await page.bringToFront();
    await page.goto(`${service.origin}/#/visualize/${sample.caseId}`, {
      waitUntil: 'commit',
      timeout: 15000,
    });
    await page.getByTestId('input-panel').waitFor({ timeout: 15000 });
    await page.getByTestId('input-field-values').fill(sample.values.values.join(', '));
    const panel = page.getByTestId('case-execution');
    await panel.getByRole('button', { name: '应用输入并准备', exact: true }).click();
    await page.waitForFunction(
      () =>
        ['ready', 'failed'].includes(
          document.querySelector('[data-testid="case-execution"]')?.getAttribute('data-state'),
        ),
      null,
      { timeout: 15000 },
    );
    assert.equal(await panel.getAttribute('data-state'), 'ready', 'Real input preparation failed');
    await panel.getByRole('button', { name: '运行示例', exact: true }).click();
    await page.waitForFunction(
      () => {
        const intent = window.__performanceAudit.intents.at(-1);
        return intent?.label === '运行示例' && intent.end !== null;
      },
      null,
      { timeout: 5000 },
    );
    assert.equal(
      await panel.getAttribute('data-state'),
      'completed',
      'Real Rust reverse-30 run did not complete; no fake playback is allowed',
    );
    report.execution = await page.evaluate(readRealExecution, sample.stdout);
    assert.equal(report.execution.producer, 'rust');
    assert.equal(report.execution.terminal, 'completed');
    assert.equal(report.execution.trace.completeness, 'complete');
    assert.ok(report.execution.trace.steps > 100);
    assert.equal(report.execution.domOutputMatches, true);
    const controls = page.getByTestId('player-controls');
    assert.equal(
      await controls.getByRole('combobox', { name: '播放速度' }).inputValue(),
      '1',
      'Measure the unmodified default 1x rate',
    );
    const initial = await page.evaluate(readObservableState);
    assert.equal(initial.cursor, 0);
    report.initialState = {
      cursor: initial.cursor,
      status: initial.status,
      sha256: hash(initial.canonical),
    };
    const array = page.locator('[data-testid="trace-array"][data-logical-length="30"]');
    let nativeSetupSteps = 0;
    while (!(await array.count()) && nativeSetupSteps < 20) {
      await controls.getByRole('button', { name: '前进', exact: true }).click();
      nativeSetupSteps++;
    }
    assert.equal(
      await array.count(),
      1,
      'The actual current state must contain one real 30-cell array',
    );
    assert.equal(await array.getByTestId('trace-array-cell').count(), 30);
    const chart = array.locator('.array-chart-scroll');
    await chart.scrollIntoViewIfNeeded();
    await chart.click({ position: { x: 12, y: 12 } });
    report.setup = {
      nativeForwardSteps: nativeSetupSteps,
      startCursor: Number(await controls.getAttribute('data-cursor')),
      arrayScrollBoundary:
        'All 30 cells are rendered; the unchanged product uses horizontal scrolling. Visible cell count and clipping are recorded rather than claiming every cell fits the 1440px viewport.',
    };
    assert.ok(
      report.execution.trace.steps - report.setup.startCursor > captureMs / 500 + 2,
      'Trace must remain playing for the entire unaccelerated observation',
    );
    await page.screenshot({ path: join(output, 'before-playback.png') });
    await session.send('Tracing.start', {
      categories: categories.join(','),
      options: 'record-as-much-as-possible',
      transferMode: 'ReturnAsStream',
      bufferUsageReportingInterval: 1000,
    });
    tracing = true;
    await page.evaluate(() => {
      window.__playbackPerformanceAudit.armed = true;
    });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__playbackPerformanceAudit.endAt !== null, null, {
      polling: 100,
      timeout: 45000,
    });
    await page.keyboard.press('Space');
    tracing = false;
    report.trace = await finishTrace(session, output);
    report.trace.bufferUsage = bufferUsage;
    report.audit = await page.evaluate(readPlaybackProbe);
    writeJson('playback-observations.json', report.audit);
    report.startup = summarizePlaybackWindow(report.audit, report.audit.startAt, startupMs);
    report.stable = summarizePlaybackWindow(
      report.audit,
      report.audit.startAt + startupMs,
      stableMs,
    );
    report.controls = {
      actualElapsedMs: report.audit.endAt - report.audit.startAt,
      fullStable30Seconds: report.audit.endAt - report.audit.startAt >= captureMs,
      nativeStartEventTrusted: report.audit.actions[0]?.trusted === true,
      firstPlayingAt:
        report.audit.statusChanges.find((entry) => entry.status === 'playing')?.at ?? null,
      stableRemainedPlaying:
        report.audit.statusChanges
          .filter((entry) => entry.at <= report.audit.startAt + startupMs)
          .at(-1)?.status === 'playing' &&
        report.audit.statusChanges
          .filter(
            (entry) =>
              entry.at >= report.audit.startAt + startupMs &&
              entry.at <= report.audit.startAt + captureMs,
          )
          .every((entry) => entry.status === 'playing'),
      endStillPlaying: report.audit.endState.status === 'playing',
      defaultRateUnchanged:
        report.audit.initialState.rate === '1' &&
        report.audit.endState.rate === '1' &&
        report.audit.changes.every((entry) => entry.rate === '1'),
      foreground:
        report.audit.initialState.visibility === 'visible' &&
        report.audit.initialState.hasFocus &&
        report.audit.changes.every((entry) => entry.visibility === 'visible' && entry.hasFocus) &&
        report.audit.visibility.every((entry) => entry.state === 'visible') &&
        report.audit.focus
          .filter((entry) => entry.at >= report.audit.startAt && entry.at <= report.audit.endAt)
          .every((entry) => entry.value) &&
        report.audit.environment.visibility === 'visible' &&
        report.audit.environment.hasFocus,
      viewport:
        report.audit.environment.viewport[0] === 1440 &&
        report.audit.environment.viewport[1] === 900 &&
        report.audit.environment.visualViewport.scale === 1,
      noServiceWorker: report.audit.environment.serviceWorkerControlled === false,
      sameOrigin:
        requests.every(
          (entry) => !/^https?:/.test(entry.url) || new URL(entry.url).origin === service.origin,
        ) && report.workers.every((entry) => new URL(entry.url).origin === service.origin),
    };
    report.requests = requests;
    const analysis = analyzePlaybackTrace(
      JSON.parse(readFileSync(join(output, 'playback.trace.json'), 'utf8')),
      report.audit,
    );
    const screenshots = analysis.screenshots.filter(
      (entry) =>
        entry.pageMs >= report.audit.startAt && entry.pageMs <= report.audit.startAt + captureMs,
    );
    mkdirSync(join(output, 'trace-screenshots'));
    report.traceScreenshots = [];
    for (let i = 0; i < screenshots.length; i++) {
      const frame = screenshots[i];
      const bytes = Buffer.from(frame.data, 'base64');
      const extension = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : 'jpeg';
      const name = `trace-screenshots/${String(i).padStart(4, '0')}.${extension}`;
      writeFileSync(join(output, name), bytes, { flag: 'wx' });
      report.traceScreenshots.push({
        file: name,
        pageMs: frame.pageMs,
        sha256: hash(bytes),
        bytes: bytes.length,
      });
    }
    delete analysis.screenshots;
    report.drawing = analysis;
    report.screenshotPixels = await decodeScreenshotPixels(
      page,
      screenshots,
      report.audit.changes,
      report.audit.environment.viewport,
    );
    const stablePixels = report.screenshotPixels.filter(
      (entry) =>
        entry.pageMs >= report.audit.startAt + startupMs &&
        entry.pageMs <= report.audit.startAt + captureMs,
    );
    report.visualEvidence = {
      stableScreenshotCount: stablePixels.length,
      stableDistinctWholeViewportPixelHashes: new Set(stablePixels.map((entry) => entry.rgbaSha256))
        .size,
      stableDistinctArrayCropPixelHashes: new Set(
        stablePixels.flatMap((entry) => (entry.arrayCrop ? [entry.arrayCrop.rgbaSha256] : [])),
      ).size,
      actualPixelsChanged: stablePixels.some((entry) => entry.changedPixels > 0),
      screenshotCadenceIsNotFrameRate: true,
    };
    await page.screenshot({ path: join(output, 'after-playback.png') });
    const paused = await page.evaluate(readObservableState);
    assert.equal(paused.status, 'paused');
    await page.waitForTimeout(650);
    const stillPaused = await page.evaluate(readObservableState);
    await page
      .getByTestId('player-controls')
      .getByRole('button', { name: '前进', exact: true })
      .click();
    const forward = await page.evaluate(readObservableState);
    await page
      .getByTestId('player-controls')
      .getByRole('button', { name: '后退', exact: true })
      .click();
    const restored = await page.evaluate(readObservableState);
    await page
      .getByTestId('player-controls')
      .getByRole('button', { name: '重播', exact: true })
      .click();
    const replay = await page.evaluate(readObservableState);
    await page
      .getByTestId('player-controls')
      .getByRole('button', { name: '暂停', exact: true })
      .click();
    report.nativeFunctional = {
      pause: {
        cursor: paused.cursor,
        after650msCursor: stillPaused.cursor,
        observableStateUnchanged: hash(paused.canonical) === hash(stillPaused.canonical),
      },
      forwardThenBack: {
        beforeCursor: paused.cursor,
        forwardCursor: forward.cursor,
        restoredCursor: restored.cursor,
        sha256Before: hash(paused.canonical),
        sha256Restored: hash(restored.canonical),
        observableStateRestored: hash(paused.canonical) === hash(restored.canonical),
      },
      replay: {
        observedFirstCursor: replay.cursor,
        observedStatus: replay.status,
        returnedInitialObservableState: hash(replay.canonical) === report.initialState.sha256,
      },
      boundary:
        'Native public controls, full currently rendered trace view including variables, arrays, events, counters and output are hashed. Hidden internal control-flow restoration is covered by product player tests, not inferred from DOM hashes. No scrub control is added or simulated.',
    };
    const metricValues = Object.values(report.stable.metricPasses);
    report.submetricConclusion = {
      metricsMeasured: metricValues.every((value) => value !== null),
      allThreeMetricsPass: metricValues.every((value) => value === true),
      actualDrawingEvidencePresent:
        report.trace.dataLossOccurred !== true &&
        analysis.clockAligned &&
        analysis.stable.rendererPaintObserved &&
        analysis.stable.rendererDrawFrameObserved &&
        report.visualEvidence.actualPixelsChanged,
      missingApplicationMarker: !report.stable.applicationMarkerObserved,
      sixtyFps:
        'No continuous 60-fps visual-change claim is inferred from rAF. Actual drawing/presentation cadence, static 500ms state intervals, screenshot pixels and physical refresh conditions require the recorded review.',
      completeAcceptance: null,
    };
  } catch (error) {
    report.failure = { message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    if (tracing)
      try {
        report.trace = await finishTrace(session, output);
      } catch (error) {
        report.cleanupErrors.push({ component: 'raw trace', message: error.message });
      }
    try {
      if (page && !report.audit) {
        report.audit = await page.evaluate(readPlaybackProbe);
        writeJson('playback-observations.json', report.audit);
      }
    } catch (error) {
      report.cleanupErrors.push({ component: 'partial page observations', message: error.message });
    }
    try {
      await browser?.close();
    } catch (error) {
      report.cleanupErrors.push({ component: 'owned browser', message: error.message });
    }
    try {
      await service?.stop();
    } catch (error) {
      report.cleanupErrors.push({ component: 'owned service', message: error.message });
    }
    try {
      report.hostConditionsEnd = capturePerformanceHost(output, 'end');
    } catch (error) {
      report.hostCaptureFailure = {
        ...report.hostCaptureFailure,
        end: { message: error.message, stack: error.stack },
      };
    }
    report.hostBaseline = qualifyPerformanceHost(report.hostConditions, report.hostConditionsEnd);
    const referenceHostConditions = report.hostBaseline.satisfied && !report.hostCaptureFailure;
    report.controls ??= {};
    report.controls.referenceHostConditions = referenceHostConditions;
    if (report.submetricConclusion)
      report.submetricConclusion.referenceHostConditions = referenceHostConditions;
    report.nativeFunctionalPassed =
      report.nativeFunctional?.pause.cursor === report.nativeFunctional?.pause.after650msCursor &&
      report.nativeFunctional?.pause.observableStateUnchanged === true &&
      report.nativeFunctional?.forwardThenBack.forwardCursor ===
        report.nativeFunctional?.forwardThenBack.beforeCursor + 1 &&
      report.nativeFunctional?.forwardThenBack.restoredCursor ===
        report.nativeFunctional?.forwardThenBack.beforeCursor &&
      report.nativeFunctional?.forwardThenBack.observableStateRestored === true &&
      report.nativeFunctional?.replay.observedFirstCursor === 0 &&
      report.nativeFunctional?.replay.observedStatus === 'playing' &&
      report.nativeFunctional?.replay.returnedInitialObservableState === true;
    report.allMeasuredChecksPass =
      referenceHostConditions &&
      !report.failure &&
      report.cleanupErrors.length === 0 &&
      Object.values(report.controls).every(Boolean) &&
      report.submetricConclusion?.allThreeMetricsPass === true &&
      report.submetricConclusion?.actualDrawingEvidencePresent === true &&
      report.nativeFunctionalPassed;
    if (!report.allMeasuredChecksPass) process.exitCode = 1;
    report.endedAt = new Date().toISOString();
    writeJson('report.json', report);
    console.log(
      JSON.stringify({
        label,
        browser: browserName,
        workload: workloadKey,
        failure: report.failure,
        stable: report.stable,
        visual: report.visualEvidence,
        conclusion: report.submetricConclusion,
        cleanupErrors: report.cleanupErrors,
      }),
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
