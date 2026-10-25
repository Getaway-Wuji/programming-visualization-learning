/* global window, performance */
// Formal navigation measurements: real production pages, no preparation clicks,
// generated execution results, product-method calls, or altered clocks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { release, totalmem, version as osVersion } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { workspaceDir } from './process.mjs';
import { capturePerformanceHost, qualifyPerformanceHost } from './performance-host.mjs';
import { performancePages } from './performance-workloads.mjs';
import { startPerformanceServer } from './serve-performance.mjs';
import { performanceBrowserOptions } from './performance-browser.mjs';
import {
  installPageProbe,
  readPageProbe,
  readArchiveMetadata,
  fixedArchive,
  classifyPageCacheEvidence,
} from './performance-page-observer.mjs';

const browserName = process.env.PERF_BROWSER ?? 'chrome';
assert.ok(['chrome', 'edge'].includes(browserName), 'PERF_BROWSER must be chrome or edge');
const label = process.env.PERF_LABEL ?? `pages-${browserName}`;
assert.match(label, /^[a-z0-9-]+$/);
const repeats = Number(process.env.PERF_REPEATS ?? 5);
assert.ok(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 5);
const requestedIds = process.env.PERF_PAGE_IDS?.split(',');
const definitions = requestedIds
  ? performancePages.filter((definition) => requestedIds.includes(definition.id))
  : performancePages;
assert.equal(performancePages.length, 7);
assert.ok(definitions.length > 0);
if (requestedIds) {
  assert.equal(new Set(requestedIds).size, requestedIds.length, 'Duplicate PAGE IDs are invalid');
  assert.equal(definitions.length, requestedIds.length, 'Unknown PAGE ID');
}
const output = join(workspaceDir, '.artifacts/11.4', label);
assert.ok(!existsSync(output), 'Use a new PERF_LABEL; previous measurements are immutable');
mkdirSync(output);
const writeNewJson = (name, value) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requiredCommonStates = ['storage', 'reading', 'practice'];
const observationWindowMs = 5000;

async function observeNetwork(context, page) {
  const session = await context.newCDPSession(page);
  const entries = new Map();
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: false });
  session.on('Network.requestWillBeSent', (event) => {
    entries.set(event.requestId, {
      requestId: event.requestId,
      url: event.request.url,
      method: event.request.method,
      type: event.type,
      timestamp: event.timestamp,
      memoryCache: false,
    });
  });
  session.on('Network.requestServedFromCache', (event) => {
    if (entries.has(event.requestId)) entries.get(event.requestId).memoryCache = true;
  });
  session.on('Network.responseReceived', (event) => {
    if (!entries.has(event.requestId)) return;
    const response = event.response;
    const headers = Object.fromEntries(
      Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    Object.assign(entries.get(event.requestId), {
      status: response.status,
      mimeType: response.mimeType,
      protocol: response.protocol,
      fromDiskCache: response.fromDiskCache ?? false,
      fromServiceWorker: response.fromServiceWorker ?? false,
      contentEncoding: headers['content-encoding'] ?? 'identity',
      contentLength: headers['content-length'] ?? null,
      cacheControl: headers['cache-control'] ?? null,
      etag: headers.etag ?? null,
      responseTiming: response.timing,
      tls: response.securityDetails
        ? {
            protocol: response.securityDetails.protocol,
            cipher: response.securityDetails.cipher,
            subjectName: response.securityDetails.subjectName,
            issuer: response.securityDetails.issuer,
          }
        : null,
    });
  });
  session.on('Network.responseReceivedExtraInfo', (event) => {
    if (entries.has(event.requestId))
      entries.get(event.requestId).actualNetworkStatus = event.statusCode;
  });
  session.on('Network.loadingFinished', (event) => {
    if (entries.has(event.requestId)) {
      entries.get(event.requestId).encodedTransferredBytes = event.encodedDataLength;
      entries.get(event.requestId).finishedTimestamp = event.timestamp;
    }
  });
  session.on('Network.loadingFailed', (event) => {
    if (entries.has(event.requestId))
      Object.assign(entries.get(event.requestId), {
        failed: event.errorText,
        cancelled: event.canceled ?? false,
      });
  });
  return { session, entries };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, min: null, median: null, p95: null, max: null };
  return {
    n: sorted.length,
    min: sorted[0],
    median:
      (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) /
      2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  };
}

let service;
let browser;
const report = {
  task: '11.4',
  baseline: 'PERF-BASE-01 V1.0 / BUDGET-P0 V1.0',
  startedAt: new Date().toISOString(),
  kind: 'formal production navigation measurements; direct routes only, real-submission review measured separately',
  browser: browserName,
  browserVersion: null,
  selectedPageIds: definitions.map((definition) => definition.id),
  repeatsPerState: repeats,
  debugRun: !!requestedIds || repeats !== 5,
  expectedFormalPages: 7,
  expectedFormalSamples: 70,
  os: { release: release(), version: osVersion(), totalMemoryBytes: totalmem() },
  suppliedHostConditions: JSON.parse(
    readFileSync(
      join(workspaceDir, process.env.PERF_HOST_REPORT ?? '.artifacts/11.4/conditions-host.json'),
    ),
  ),
  toolSha256: hash(readFileSync(new URL(import.meta.url))),
  pageObserverSha256: hash(
    readFileSync(new URL('./performance-page-observer.mjs', import.meta.url)),
  ),
  workloadDefinitionsSha256: hash(
    readFileSync(new URL('./performance-workloads.mjs', import.meta.url)),
  ),
  browserConfigurationSha256: hash(
    readFileSync(new URL('./performance-browser.mjs', import.meta.url)),
  ),
  packageLockSha256: hash(readFileSync(join(workspaceDir, 'package-lock.json'))),
  thresholds: { everyCompleteNavigationMs: 2000, observationWindowMs, repeatsPerState: 5 },
  cacheProtocol: {
    cold: 'Fresh isolated context and Network.clearBrowserCache; Service Workers blocked; no engine precompile or prepare click',
    warm: 'Fresh context first loads the same route and waits for complete real DOM, consumer and workspace readiness; closes that page, then opens a new page in the same context with its HTTP cache; semantic learning state stays the fresh default archive. Direct reuse and conditional revalidation are distinct; Resource Timing alone does not prove warm cache.',
    codeCache:
      'Fresh isolated page/renderer contexts and explicit Chromium browser-cache clearing for cold; no claim to disable unrelated browser implementation caches beyond these controls',
  },
  timing:
    'Navigation performance.startTime (normally zero) to required actual DOM and public consumer-state ready after two rAF callbacks; shell-only timestamps never pass workspace entry',
  scope:
    'Seven direct routes. PAGE-06 here is case mode; practice-review timing needs a real retained submission and is outside this navigation matrix.',
  samples: [],
  cohorts: [],
};

async function navigate(context, definition, mode, repeat, prewarm = false) {
  const requiredStates = [...requiredCommonStates];
  if (definition.id === 'PAGE-01') requiredStates.push('reward', 'goal', 'profile');
  if (definition.id === 'PAGE-07') requiredStates.push('profile');
  const page = await context.newPage();
  const network = await observeNetwork(context, page);
  const workers = [];
  const errors = [];
  page.on('worker', (worker) => workers.push({ url: worker.url() }));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(installPageProbe, {
    definition,
    observationWindowMs,
    requiredStates,
  });
  await page.bringToFront();
  const serverStartIndex = service.getRequestCount();
  let failure = null;
  try {
    if (mode === 'cold' || prewarm) await network.session.send('Network.clearBrowserCache');
    await page.goto(`${service.origin}/#${definition.route}`, {
      waitUntil: 'commit',
      timeout: 15_000,
    });
    await page.waitForFunction(
      ({ observationWindowMs }) =>
        !!window.__navigationPerformanceAudit?.complete?.paintAt ||
        performance.now() >= observationWindowMs,
      { observationWindowMs },
      { timeout: 15_000, polling: 50 },
    );
  } catch (error) {
    failure = { message: error.message };
  }
  let audit;
  let archive;
  try {
    audit = await page.evaluate(readPageProbe);
    archive = await page.evaluate(readArchiveMetadata);
  } catch (error) {
    failure ??= { message: error.message };
  }
  const navigationStart = audit?.navigation?.[0]?.startTime ?? 0;
  const completeMs = audit?.complete ? audit.complete.paintAt - navigationStart : null;
  const serverRequests = service.snapshotRequests(serverStartIndex);
  const resourceUrls = [...network.entries.values()]
    .map((entry) => entry.url)
    .concat((audit?.resources ?? []).map((entry) => entry.name));
  const networkSameOrigin = resourceUrls.every(
    (value) => !/^https?:/.test(value) || new URL(value).origin === service.origin,
  );
  const foreground =
    audit?.environment.visibility === 'visible' &&
    audit?.environment.hasFocus === true &&
    audit?.visibilityChanges.every((entry) => entry.state === 'visible');
  const correctViewport =
    audit?.environment.viewport[0] === 1440 &&
    audit?.environment.viewport[1] === 900 &&
    audit?.environment.visualViewport?.scale === 1 &&
    audit?.environment.devicePixelRatio === 1;
  const noServiceWorker = audit?.environment.serviceWorkerControlled === false;
  const archiveConfirmed = !!archive && fixedArchive(archive);
  const cacheEvidence = classifyPageCacheEvidence({
    origin: service.origin,
    network: [...network.entries.values()],
    resources: audit?.resources ?? [],
    serverRequests,
    mode,
    prewarm,
  });
  const cacheStateConfirmed = cacheEvidence.confirmed;
  const engine = audit?.engine;
  const noExecutionModule =
    !!engine &&
    engine.compilations === 0 &&
    engine.streamingCompilations === 0 &&
    engine.workers.length === 0 &&
    workers.length === 0 &&
    !resourceUrls.some((url) => /\.wasm(?:\?|$)/.test(url));
  const readinessConfirmed =
    !failure &&
    errors.length === 0 &&
    completeMs !== null &&
    foreground &&
    correctViewport &&
    noServiceWorker &&
    networkSameOrigin &&
    archiveConfirmed &&
    noExecutionModule;
  const result = {
    id: `${definition.id}-${mode}-${repeat}${prewarm ? '-prewarm' : ''}`,
    pageId: definition.id,
    route: definition.route,
    mode,
    repeat,
    prewarm,
    failure,
    shellMs: audit?.shell ? audit.shell.paintAt - navigationStart : null,
    contentMs: audit?.content ? audit.content.paintAt - navigationStart : null,
    completeMs,
    workspaceEntry: definition.workspace ?? null,
    workspaceReady:
      audit?.complete?.stateAtPaint.workspaceReady ?? audit?.lastState?.workspaceReady,
    completeWithinThreshold: completeMs !== null && completeMs <= 2000,
    readinessConfirmed,
    controls: {
      foreground,
      correctViewport,
      noServiceWorker,
      networkSameOrigin,
      archiveConfirmed,
      cacheStateConfirmed,
      noExecutionModule,
    },
    cacheEvidence,
    serverRequests,
    serverRequestStartIndex: serverStartIndex,
    passed: readinessConfirmed && completeMs <= 2000 && cacheStateConfirmed,
    pageErrors: errors,
    workers,
    archive,
    audit,
    network: [...network.entries.values()],
  };
  if (!prewarm && repeat === 1)
    await page.screenshot({ path: join(output, `${result.id}.png`), fullPage: true });
  await page.close();
  return result;
}

try {
  report.hostConditions = capturePerformanceHost(output, 'start');
  service = await startPerformanceServer({ logPrefix: `.artifacts/11.4/${label}/network` });
  report.server = service.metadata;
  const browserOptions = performanceBrowserOptions(browserName, service.metadata);
  report.browserConfiguration = browserOptions;
  browser = await chromium.launch(browserOptions.launchOptions);
  report.browserVersion = browser.version();
  const browserSession = await browser.newBrowserCDPSession();
  report.browserProtocolVersion = await browserSession.send('Browser.getVersion');
  await browserSession.detach();
  for (const definition of definitions) {
    for (const mode of ['cold', 'warm']) {
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const cohort = {
          id: `${definition.id}-${mode}-${repeat}`,
          pageId: definition.id,
          mode,
          repeat,
        };
        report.cohorts.push(cohort);
        let context;
        try {
          context = await browser.newContext(browserOptions.contextOptions);
          let prewarm = null;
          if (mode === 'warm') {
            prewarm = await navigate(context, definition, mode, repeat, true);
            writeNewJson(`${prewarm.id}.json`, prewarm);
          }
          const sample = await navigate(context, definition, mode, repeat);
          if (prewarm)
            sample.prewarm = {
              shellMs: prewarm.shellMs,
              contentMs: prewarm.contentMs,
              completeMs: prewarm.completeMs,
              failure: prewarm.failure,
              audit: prewarm.audit,
              network: prewarm.network,
              archiveConfirmed: prewarm.controls.archiveConfirmed,
              readinessConfirmed: prewarm.readinessConfirmed,
            };
          if (prewarm && (!prewarm.readinessConfirmed || !prewarm.controls.cacheStateConfirmed)) {
            sample.controls.prewarmConfirmed = false;
            sample.passed = false;
          } else if (prewarm) sample.controls.prewarmConfirmed = true;
          report.samples.push(sample);
          cohort.sampleId = sample.id;
          writeNewJson(`${sample.id}.json`, sample);
          console.log(
            JSON.stringify({
              id: sample.id,
              shellMs: sample.shellMs,
              completeMs: sample.completeMs,
              workspaceReady: sample.workspaceReady,
              controls: sample.controls,
              passed: sample.passed,
            }),
          );
        } catch (error) {
          cohort.failure = { message: error.message, stack: error.stack };
          report.harnessFailures ??= [];
          report.harnessFailures.push({ cohortId: cohort.id, ...cohort.failure });
          console.log(JSON.stringify({ cohortId: cohort.id, failure: cohort.failure }));
        } finally {
          try {
            await context?.close();
            cohort.contextClosed = true;
          } catch (error) {
            cohort.cleanupFailure = { message: error.message };
            report.cleanupFailures ??= [];
            report.cleanupFailures.push(cohort.cleanupFailure);
          }
          writeNewJson(`${cohort.id}-cohort.json`, cohort);
        }
      }
    }
  }
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.cleanupErrors = [...(report.cleanupFailures ?? [])];
  try {
    await browser?.close();
  } catch (error) {
    report.cleanupErrors.push({ component: 'owned browser', message: error.message });
    process.exitCode = 1;
  }
  try {
    await service?.stop();
  } catch (error) {
    report.cleanupErrors.push({ component: 'owned performance server', message: error.message });
    process.exitCode = 1;
  }
  try {
    report.hostConditionsEnd = capturePerformanceHost(output, 'end');
  } catch (error) {
    report.hostCaptureFailure = { message: error.message };
  }
  report.endedAt = new Date().toISOString();
  report.summary = performancePages.flatMap((definition) =>
    ['cold', 'warm'].map((mode) => {
      const samples = report.samples.filter(
        (sample) => sample.pageId === definition.id && sample.mode === mode,
      );
      return {
        pageId: definition.id,
        route: definition.route,
        mode,
        expected: 5,
        observed: samples.length,
        passed: samples.filter((sample) => sample.passed).length,
        missingReadyEndpoint: samples.filter((sample) => sample.completeMs === null).length,
        shellMs: stats(
          samples.flatMap((sample) => (sample.shellMs === null ? [] : [sample.shellMs])),
        ),
        completeMs: stats(
          samples.flatMap((sample) => (sample.completeMs === null ? [] : [sample.completeMs])),
        ),
        allSamplesPass: samples.length === 5 && samples.every((sample) => sample.passed),
      };
    }),
  );
  report.complete =
    !report.debugRun &&
    definitions.length === 7 &&
    repeats === 5 &&
    report.samples.length === 70 &&
    report.cohorts.length === 70 &&
    report.summary.every((entry) => entry.observed === 5);
  report.hostBaseline = qualifyPerformanceHost(report.hostConditions, report.hostConditionsEnd);
  report.allSamplesPass =
    report.hostBaseline.satisfied &&
    report.complete &&
    report.cleanupErrors.length === 0 &&
    !report.failure &&
    !report.harnessFailures?.length &&
    report.samples.every((sample) => sample.passed);
  writeNewJson('report.json', report);
  if (!report.allSamplesPass) process.exitCode = 1;
}
