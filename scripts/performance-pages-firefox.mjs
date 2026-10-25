// Formal stock Firefox direct-route navigation. Only native WebDriver navigation
// and readonly page/archive observation; no prepare click or execution hook.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { release, totalmem, version as osVersion } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkEnvironment } from './environment.mjs';
import { workspaceDir } from './process.mjs';
import { capturePerformanceHost, qualifyPerformanceHost } from './performance-host.mjs';
import { performancePages } from './performance-workloads.mjs';
import { startPerformanceServer } from './serve-performance.mjs';
import {
  installPageProbe,
  readPageProbe,
  readArchiveMetadata,
  fixedArchive,
  classifyPageCacheEvidence,
} from './performance-page-observer.mjs';

const toolEnvironment = checkEnvironment({ bindgen: true });
const label = process.env.PERF_LABEL ?? 'pages-firefox';
assert.match(label, /^[a-z0-9-]+$/);
const repeats = Number(process.env.PERF_REPEATS ?? 5);
assert.ok(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 5);
const requestedIds = process.env.PERF_PAGE_IDS?.split(',');
const definitions = requestedIds
  ? performancePages.filter((definition) => requestedIds.includes(definition.id))
  : performancePages;
assert.ok(definitions.length > 0);
if (requestedIds) {
  assert.equal(new Set(requestedIds).size, requestedIds.length, 'Duplicate PAGE IDs are invalid');
  assert.equal(definitions.length, requestedIds.length, 'Unknown PAGE ID');
}
assert.equal(performancePages.length, 7);
const observationWindowMs = 5000;
const requiredCommonStates = ['storage', 'reading', 'practice'];
const driverPort = Number(process.env.PERF_DRIVER_PORT ?? 4455);
assert.ok(
  Number.isSafeInteger(driverPort) &&
    driverPort >= 1024 &&
    driverPort <= 65535 &&
    ![4192, 4193].includes(driverPort),
);
const driverOrigin = `http://127.0.0.1:${driverPort}`;
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
assert.ok(existsSync(binary) && existsSync(executable));
const output = join(workspaceDir, '.artifacts/11.4', label);
assert.ok(!existsSync(output), 'Use a new PERF_LABEL; prior raw measurements are immutable');
mkdirSync(output);
const writeNewJson = (name, value) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const profilePaths = new Set();
const report = {
  task: '11.4',
  baseline: 'PERF-BASE-01 V1.0 / BUDGET-P0 V1.0',
  kind: 'production direct-route navigation; real-submission review measured separately',
  browser: 'stock-Firefox',
  browserVersion: null,
  headful: true,
  viewport: [1440, 900],
  driverPort,
  startedAt: new Date().toISOString(),
  toolEnvironment,
  os: { release: release(), version: osVersion(), totalMemoryBytes: totalmem() },
  suppliedHostConditions: JSON.parse(
    readFileSync(
      join(workspaceDir, process.env.PERF_HOST_REPORT ?? '.artifacts/11.4/conditions-host.json'),
    ),
  ),
  selectedPageIds: definitions.map((definition) => definition.id),
  repeatsPerState: repeats,
  debugRun: !!requestedIds || repeats !== 5,
  expectedFormalPages: 7,
  expectedFormalSamples: 70,
  thresholds: { everyCompleteNavigationMs: 2000, observationWindowMs, repeatsPerState: 5 },
  certificateAcceptance: {
    acceptInsecureCerts: true,
    installedSystemTrust: false,
    boundary:
      'Only the owned, temporary Firefox HTTPS lab session accepts its task-local certificate. This is not public-deployment trust. acceptInsecureCerts does not prove HTTP cache warmth; an unobserved warm cache remains a failed control.',
  },
  cacheProtocol: {
    cold: 'Each measured sample starts a new native WebDriver session and distinct temporary Firefox profile, with no prior page, HTTP cache or Service Worker. No product preparation or execution is invoked.',
    warm: 'A new profile first loads the exact same route through complete shared DOM/consumer/workspace readiness. A new native tab is opened in that profile and the prior tab is closed before measured navigation; the learning archive stays the fresh default. Cache reuse, actual 304s and transfer sizes require recorded network evidence.',
    codeCache:
      'New native profiles isolate cold browser state. A measured warm page is a new document with no retained page Module. No claim is made to disable unrelated browser implementation caches beyond this isolation.',
    serviceWorker:
      'dom.serviceWorkers.enabled=false in the owned temporary profile, plus readonly controller/realm checks. No installed profile or browser-wide setting is changed.',
  },
  timing:
    'Navigation startTime to the unchanged shared real DOM/public consumer-state readiness after two rAF callbacks. WebDriver polling only waits for that page-owned endpoint. An endpoint later than 2000ms fails; observation continues up to 5000ms so slow and missing endpoints are retained.',
  scope:
    'PAGE-01 through PAGE-07 direct routes; PAGE-06 is case mode. No result injection, prepare button, engine check or frontend algorithm execution. Real retained-submission review is outside this 70-navigation matrix.',
  networkObservation: {
    protocol: 'WebDriver BiDi network events and same-origin Resource Timing',
    responseBodyCollection: false,
    specification: 'https://www.w3.org/TR/webdriver-bidi/#type-network-ResponseData',
    bytes:
      'BiDi bytesReceived/headersSize/bodySize and browser transferSize/encodedBodySize are recorded separately, without assuming missing fields are zero or equating HTTP bytes with TLS bytes. Raw server request/connection logs are preserved on cleanup.',
  },
  hashes: Object.fromEntries(
    [
      'package-lock.json',
      'Cargo.lock',
      'scripts/performance-pages-firefox.mjs',
      'scripts/performance-page-observer.mjs',
      'scripts/performance-pages.mjs',
      'scripts/performance-workloads.mjs',
      'web/src/generated/c_viz_wasm_bg.wasm',
    ].map((path) => [path, sha(readFileSync(join(workspaceDir, path)))]),
  ),
  cohorts: [],
  samples: [],
};
let driver;
let server;
let sessionId;
let bidi;
let failure;
let serviceLog = '';
let networkRows = new Map();
let javascriptErrors = [];
let workerRealms = [];

async function ensureFree(port) {
  await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
}
function ownedDriver() {
  const child = spawn(
    executable,
    ['--host', '127.0.0.1', '--port', String(driverPort), '--log', 'warn'],
    {
      cwd: workspaceDir,
      stdio: 'pipe',
      windowsHide: true,
    },
  );
  child.on('error', (error) => {
    serviceLog += `${error.stack ?? error.message}\n`;
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      serviceLog += chunk.toString();
    });
  return child;
}
async function driverReady() {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(driver.exitCode, null, serviceLog);
    try {
      const response = await fetch(`${driverOrigin}/status`, {
        signal: globalThis.AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).value?.ready) return;
    } catch {
      /* Only this owned driver is starting. */
    }
    await delay(100);
  }
  throw new Error(`11.4 owned Firefox driver did not start: ${serviceLog}`);
}
async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  throw new Error('The owned geckodriver did not stop; no unrelated process was stopped.');
}
async function wd(path, method = 'GET', body) {
  const response = await fetch(`${driverOrigin}${path}`, {
    method,
    signal: globalThis.AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok || data.value?.error)
    throw new Error(`WebDriver: ${JSON.stringify(data.value)}`);
  return data.value;
}
const js = (script, args = []) =>
  wd(`/session/${sessionId}/execute/sync`, 'POST', { script, args });

function selectedHeaders(headers) {
  const allowed = new Set([
    'content-encoding',
    'content-length',
    'cache-control',
    'etag',
    'last-modified',
    'vary',
  ]);
  return Object.fromEntries(
    (headers ?? []).flatMap((header) => {
      const name = header.name?.toLowerCase();
      return allowed.has(name) && header.value?.type === 'string'
        ? [[name, header.value.value]]
        : [];
    }),
  );
}
function observeBidi(method, params) {
  if (method === 'log.entryAdded') {
    if (params.type === 'javascript' && params.level === 'error')
      javascriptErrors.push({
        context: params.source?.context ?? null,
        text: params.text,
        timestamp: params.timestamp,
      });
    return;
  }
  if (method === 'script.realmCreated') {
    if (params.type?.endsWith('worker'))
      workerRealms.push({
        type: params.type,
        origin: params.origin,
        realm: params.realm,
        owners: params.owners ?? [],
      });
    return;
  }
  if (!method.startsWith('network.') || !params.request?.request) return;
  const request = params.request;
  const key = `${request.request}:${params.redirectCount}`;
  const row = networkRows.get(key) ?? {
    requestId: request.request,
    redirectCount: params.redirectCount,
    context: params.context,
    navigation: params.navigation,
    url: request.url,
    method: request.method,
    initiatorType: request.initiatorType ?? null,
    destination: request.destination ?? null,
    beforeRequestObserved: false,
    responseCompletedObserved: false,
  };
  row.requestTimings = request.timings;
  if (method === 'network.beforeRequestSent') {
    row.beforeRequestObserved = true;
    row.beforeRequestTimestamp = params.timestamp;
  }
  if (params.response) {
    const response = params.response;
    Object.assign(row, {
      responseUrl: response.url,
      status: response.status,
      protocol: response.protocol,
      fromCache: response.fromCache,
      mimeType: response.mimeType,
      bytesReceived: response.bytesReceived ?? null,
      headersSize: response.headersSize ?? null,
      bodySize: response.bodySize ?? null,
      decodedContentSize: response.content?.size ?? null,
      headers: selectedHeaders(response.headers),
    });
  }
  if (method === 'network.responseCompleted') {
    row.responseCompletedObserved = true;
    row.completedTimestamp = params.timestamp;
  }
  if (method === 'network.fetchError') {
    row.failed = params.errorText;
    row.failedTimestamp = params.timestamp;
  }
  networkRows.set(key, row);
}
async function connectBidi(url) {
  const socket = new globalThis.WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  const rejectPending = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject(error);
    }
    pending.clear();
  };
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === 'event') {
      observeBidi(message.method, message.params);
      return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timeout);
    if (message.type === 'success') item.resolve(message.result);
    else item.reject(new Error(`WebDriver BiDi: ${JSON.stringify(message)}`));
  });
  socket.addEventListener('close', () => rejectPending(new Error('WebDriver BiDi closed.')));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('BiDi connection timed out.'));
    }, 10000);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('BiDi connection failed.'));
      },
      { once: true },
    );
  });
  return {
    command(method, params) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`BiDi command timed out: ${method}`));
        }, 10000);
        pending.set(id, { resolve, reject, timeout });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error);
        }
      });
    },
    close() {
      rejectPending(new Error('BiDi session cleanup.'));
      socket.close();
    },
  };
}
async function setViewport() {
  let rect = { x: 0, y: 0, width: 1440, height: 900 };
  for (let attempt = 0; attempt < 4; attempt++) {
    await wd(`/session/${sessionId}/window/rect`, 'POST', rect);
    const actual = await js(
      'return {width:innerWidth,height:innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio};',
    );
    if (actual.width === 1440 && actual.height === 900) {
      assert.equal(actual.dpr, 1, 'The frozen CSS scale must remain 100%.');
      return actual;
    }
    rect = {
      x: 0,
      y: 0,
      width: actual.outerWidth + 1440 - actual.width,
      height: actual.outerHeight + 900 - actual.height,
    };
  }
  throw new Error('Native Firefox did not provide the required 1440×900 CSS viewport.');
}
async function endSession() {
  bidi?.close();
  bidi = undefined;
  if (sessionId) {
    await wd(`/session/${sessionId}`, 'DELETE');
    sessionId = undefined;
  }
}
async function newSession(definition, cohort) {
  networkRows = new Map();
  javascriptErrors = [];
  workerRealms = [];
  const session = await wd('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        webSocketUrl: true,
        acceptInsecureCerts: true,
        pageLoadStrategy: 'none',
        'moz:firefoxOptions': {
          binary,
          args: [],
          prefs: {
            'app.update.auto': false,
            'browser.shell.checkDefaultBrowser': false,
            'layout.css.devPixelsPerPx': '1.0',
            'intl.accept_languages': 'zh-CN,zh,en-US,en',
            'extensions.autoDisableScopes': 15,
            'dom.serviceWorkers.enabled': false,
          },
        },
      },
    },
  });
  sessionId = session.sessionId;
  const capabilities = session.capabilities;
  cohort.capabilities = capabilities;
  assert.equal(capabilities.browserName, 'firefox');
  assert.match(capabilities.browserVersion, /^158\./);
  assert.equal(capabilities['moz:headless'], false);
  assert.equal(typeof capabilities.webSocketUrl, 'string');
  assert.equal(typeof capabilities['moz:profile'], 'string');
  assert.equal(
    profilePaths.has(capabilities['moz:profile']),
    false,
    'Each sample requires a distinct new profile.',
  );
  profilePaths.add(capabilities['moz:profile']);
  assert.equal((await wd(`/session/${sessionId}/window/handles`)).length, 1);
  cohort.viewport = await setViewport();
  await wd(`/session/${sessionId}/timeouts`, 'POST', { script: 30000, pageLoad: 15000 });
  bidi = await connectBidi(capabilities.webSocketUrl);
  await bidi.command('session.subscribe', {
    events: [
      'network.beforeRequestSent',
      'network.responseStarted',
      'network.responseCompleted',
      'network.fetchError',
      'log.entryAdded',
      'script.realmCreated',
    ],
  });
  const requiredStates = [...requiredCommonStates];
  if (definition.id === 'PAGE-01') requiredStates.push('reward', 'goal', 'profile');
  if (definition.id === 'PAGE-07') requiredStates.push('profile');
  const configuration = JSON.stringify({ definition, observationWindowMs, requiredStates });
  // BiDi preload arguments are channels, not arbitrary JSON values. Embed only
  // the frozen public route configuration in a self-contained author-realm function.
  const preloadSource = `() => {
    (${installPageProbe.toString()})(${configuration});
  }`;
  const preload = await bidi.command('script.addPreloadScript', {
    functionDeclaration: preloadSource,
  });
  assert.equal(typeof preload.script, 'string');
  cohort.preloadRegisteredBeforeNavigation = true;
  cohort.preloadSha256 = sha(preloadSource);
  cohort.initialHandle = await wd(`/session/${sessionId}/window`);
  const tree = await bidi.command('browsingContext.getTree', { maxDepth: 0 });
  assert.ok(
    tree.contexts.some((context) => context.context === cohort.initialHandle),
    'Classic WebDriver and BiDi must identify the same top-level context.',
  );
  report.browserVersion ??= capabilities.browserVersion;
  assert.equal(capabilities.browserVersion, report.browserVersion);
}
async function replaceWithFreshTab(cohort) {
  const oldHandle = await wd(`/session/${sessionId}/window`);
  const created = await wd(`/session/${sessionId}/window/new`, 'POST', { type: 'tab' });
  assert.notEqual(created.handle, oldHandle);
  await wd(`/session/${sessionId}/window`, 'POST', { handle: oldHandle });
  await wd(`/session/${sessionId}/window`, 'DELETE');
  await wd(`/session/${sessionId}/window`, 'POST', { handle: created.handle });
  assert.equal((await wd(`/session/${sessionId}/window/handles`)).length, 1);
  cohort.warmNewTab = {
    priorHandle: oldHandle,
    measuredHandle: created.handle,
    priorTabClosed: true,
  };
  await setViewport();
}
function stats(values) {
  const sorted = [...values].sort((left, right) => left - right);
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
async function navigate(definition, mode, repeat, prewarm = false) {
  const handle = await wd(`/session/${sessionId}/window`);
  const errorsBefore = javascriptErrors.length;
  const realmsBefore = workerRealms.length;
  const networkWindow = { startedAtEpochMs: Date.now() };
  const serverStartIndex = server.getRequestCount();
  let navigationFailure = null;
  try {
    await wd(`/session/${sessionId}/url`, 'POST', { url: `${server.origin}/#${definition.route}` });
    let observed = false;
    for (let attempt = 0; attempt < 300; attempt++) {
      try {
        observed = await js(
          'return location.origin === arguments[0] && !!window.__navigationPerformanceAudit && (!!window.__navigationPerformanceAudit.complete?.paintAt || performance.now() >= arguments[1]);',
          [server.origin, observationWindowMs],
        );
      } catch {
        /* A native navigation may still be replacing the prior document. */
      }
      if (observed) break;
      await delay(50);
    }
    if (!observed)
      throw new Error('No actual navigation readiness/observation-window endpoint was observable.');
  } catch (error) {
    navigationFailure = { message: error.message };
  }
  let audit;
  let archive;
  let engine;
  try {
    audit = await js(`return (${readPageProbe.toString()})();`);
    archive = await wd(`/session/${sessionId}/execute/async`, 'POST', {
      script: `const done=arguments[arguments.length-1]; (${readArchiveMetadata.toString()})().then(value=>done({ok:true,value}),error=>done({ok:false,error:error.message}));`,
      args: [],
    });
    if (!archive.ok) throw new Error(archive.error);
    archive = archive.value;
    engine = await js('return window.__navigationModuleAudit ?? null;');
  } catch (error) {
    navigationFailure ??= { message: error.message };
  }
  networkWindow.endedAtEpochMs = Date.now();
  const serverRequests = server.snapshotRequests(serverStartIndex);
  const network = [...networkRows.values()].filter((row) => row.context === handle);
  const errors = javascriptErrors
    .slice(errorsBefore)
    .filter((entry) => entry.context === handle || entry.context === null);
  const realms = workerRealms.slice(realmsBefore);
  const navigationStart = audit?.navigation?.[0]?.startTime ?? 0;
  const completeMs = audit?.complete ? audit.complete.paintAt - navigationStart : null;
  const shellMs = audit?.shell ? audit.shell.paintAt - navigationStart : null;
  const contentMs = audit?.content ? audit.content.paintAt - navigationStart : null;
  const resourceUrls = [
    ...network.map((row) => row.url),
    ...(audit?.resources ?? []).map((row) => row.name),
  ];
  const networkSameOrigin = resourceUrls.every(
    (url) => !/^https?:/.test(url) || new URL(url).origin === server.origin,
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
  const noServiceWorker =
    audit?.environment.serviceWorkerControlled === false &&
    !realms.some((realm) => realm.type === 'service-worker');
  const archiveConfirmed = !!archive && fixedArchive(archive);
  const cacheEvidence = classifyPageCacheEvidence({
    origin: server.origin,
    network,
    resources: audit?.resources ?? [],
    serverRequests,
    mode,
    prewarm,
  });
  const cacheStateConfirmed = cacheEvidence.confirmed;
  const noExecutionModule =
    !!engine &&
    engine.compilations === 0 &&
    engine.streamingCompilations === 0 &&
    engine.workers.length === 0 &&
    realms.length === 0 &&
    !resourceUrls.some((url) => /\.wasm(?:\?|$)/.test(url));
  const networkObservationConfirmed = network.some(
    (row) => row.beforeRequestObserved && row.responseCompletedObserved && row.navigation !== null,
  );
  const readinessConfirmed =
    !navigationFailure &&
    errors.length === 0 &&
    completeMs !== null &&
    foreground &&
    correctViewport &&
    noServiceWorker &&
    networkSameOrigin &&
    archiveConfirmed &&
    noExecutionModule &&
    networkObservationConfirmed;
  const result = {
    id: `${definition.id}-${mode}-${repeat}${prewarm ? '-prewarm' : ''}`,
    pageId: definition.id,
    route: definition.route,
    mode,
    repeat,
    prewarm,
    context: handle,
    failure: navigationFailure,
    shellMs,
    contentMs,
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
      networkObservationConfirmed,
    },
    cacheEvidence: { ...cacheEvidence, acceptInsecureCertsIsNotCacheProof: true },
    serverRequests,
    serverRequestStartIndex: serverStartIndex,
    transfers: {
      completedResponses: network.filter((row) => row.responseCompletedObserved).length,
      knownHttpBytesReceived: network
        .filter((row) => row.responseCompletedObserved && typeof row.bytesReceived === 'number')
        .reduce((sum, row) => sum + row.bytesReceived, 0),
      missingHttpByteCounts: network.filter(
        (row) => row.responseCompletedObserved && typeof row.bytesReceived !== 'number',
      ).length,
      browserResourceTransferBytes: (audit?.resources ?? []).reduce(
        (sum, row) => sum + row.transferSize,
        0,
      ),
      source:
        'Raw BiDi response metadata plus unchanged shared Resource Timing; HTTP and TLS byte scopes differ.',
    },
    passed: readinessConfirmed && completeMs <= 2000 && cacheStateConfirmed,
    pageErrors: errors,
    workerRealms: realms,
    engine,
    archive,
    audit,
    network,
    networkWindow,
  };
  if (!prewarm && repeat === 1)
    writeFileSync(
      join(output, `${result.id}.png`),
      Buffer.from(await wd(`/session/${sessionId}/screenshot`), 'base64'),
      { flag: 'wx' },
    );
  return result;
}

try {
  report.hostConditions = capturePerformanceHost(output, 'start');
  for (const port of [4192, 4193, driverPort]) await ensureFree(port);
  server = await startPerformanceServer({
    port: 4192,
    internalPort: 4193,
    logPrefix: `.artifacts/11.4/${label}/network`,
  });
  report.server = server.metadata;
  driver = ownedDriver();
  await driverReady();
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
        try {
          await newSession(definition, cohort);
          let prewarm = null;
          if (mode === 'warm') {
            prewarm = await navigate(definition, mode, repeat, true);
            writeNewJson(`${cohort.id}-prewarm.json`, prewarm);
            await replaceWithFreshTab(cohort);
          }
          const sample = await navigate(definition, mode, repeat);
          if (prewarm) {
            sample.prewarm = {
              id: prewarm.id,
              completeMs: prewarm.completeMs,
              readinessConfirmed: prewarm.readinessConfirmed,
              failure: prewarm.failure,
            };
            sample.controls.prewarmConfirmed =
              prewarm.readinessConfirmed && prewarm.controls.cacheStateConfirmed;
            if (!sample.controls.prewarmConfirmed) sample.passed = false;
          }
          report.samples.push(sample);
          cohort.sampleId = sample.id;
          writeNewJson(`${sample.id}.json`, sample);
          console.log(
            JSON.stringify({
              id: sample.id,
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
            await endSession();
            cohort.sessionClosed = true;
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
  failure = error;
  report.failure = { message: error.message, stack: error.stack };
} finally {
  const sessionCleanup = await endSession().then(
    () => null,
    (error) => error,
  );
  const cleanup = await Promise.allSettled([stopOwned(driver), server?.stop()]);
  const cleanupErrors = [
    sessionCleanup,
    ...cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason),
  ].filter(Boolean);
  report.cleanupErrors = [
    ...(report.cleanupFailures ?? []),
    ...cleanupErrors.map((error) => ({ message: String(error) })),
  ];
  report.ownedServicesStopped = report.cleanupErrors.length === 0;
  try {
    report.hostConditionsEnd = capturePerformanceHost(output, 'end');
  } catch (error) {
    report.hostCaptureFailure = { message: error.message };
  }
  report.endedAt = new Date().toISOString();
  report.distinctProfiles = profilePaths.size;
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
        cacheStateFailures: samples.filter((sample) => !sample.controls.cacheStateConfirmed).length,
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
    report.ownedServicesStopped &&
    !report.harnessFailures?.length &&
    !report.failure &&
    report.samples.every((sample) => sample.passed);
  report.serverRequestEvidence = {
    file: 'network-requests.jsonl',
    status: existsSync(join(output, 'network-requests.jsonl')) ? 'preserved' : 'not-written',
  };
  writeNewJson('report.json', report);
  writeFileSync(join(output, 'geckodriver.log'), serviceLog, { flag: 'wx' });
  if (!report.allSamplesPass) process.exitCode = 1;
  if (cleanupErrors.length) failure ??= cleanupErrors[0];
}
if (failure) throw failure;
