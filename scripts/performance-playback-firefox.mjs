/* global document, atob, Blob, createImageBitmap, crypto */
// Stock Firefox: native product playback and independent Gecko compositor evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { release, totalmem, version as osVersion } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { checkEnvironment } from './environment.mjs';
import { capturePerformanceHost, qualifyPerformanceHost } from './performance-host.mjs';
import { installPerformanceObserver } from './performance-observer.mjs';
import {
  installPlaybackProbe,
  playbackStats,
  readObservableState,
  readPlaybackProbe,
  readRealExecution,
  summarizePlaybackWindow,
} from './performance-playback.mjs';
import { performanceCases } from './performance-workloads.mjs';
import { workspaceDir } from './process.mjs';
import { startPerformanceServer } from './serve-performance.mjs';

const startupMs = 2000;
const stableMs = 30_000;
const captureMs = startupMs + stableMs;
const frameMeasureName = 'cviz.player.frame';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const intervals = (values) => values.slice(1).map((value, index) => value - values[index]);
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';

/** Raw Gecko profiles have their own monotonic epoch per process. Convert to
 * the root epoch using meta.startTime, then align only with the actual page's
 * UserTiming start AND end markers. Vsync/rAF are never counted as drawing. */
export function analyzeFirefoxPlaybackProfile(profile, audit) {
  const rootEpoch = profile.meta?.startTime;
  const markers = [];
  const processMetadata = [];
  const malformed = [];
  function visit(current, path) {
    const epoch = current.meta?.startTime;
    if (!Number.isFinite(epoch) || !Number.isFinite(rootEpoch)) {
      malformed.push({ path, reason: 'Missing finite process meta.startTime' });
      return;
    }
    const offset = epoch - rootEpoch;
    processMetadata.push({ path, startTime: epoch, offsetMs: offset, meta: current.meta });
    for (const thread of current.threads ?? []) {
      const schema = thread.markers?.schema;
      if (!schema || !Array.isArray(thread.markers?.data)) continue;
      const strings = thread.stringTable ?? [];
      const decodeString = (value) => (typeof value === 'number' ? strings[value] : value);
      for (const row of thread.markers.data) {
        const start = row[schema.startTime ?? schema.time];
        const end = row[schema.endTime];
        const payload = row[schema.data];
        const startMs = Number.isFinite(start) ? start + offset : null;
        const endMs = Number.isFinite(end) ? end + offset : null;
        const atMs = startMs ?? endMs;
        if (atMs === null) continue;
        const data = payload && typeof payload === 'object' ? payload : null;
        markers.push({
          name: decodeString(row[schema.name]),
          atMs,
          startMs,
          endMs,
          phase: row[schema.phase] ?? null,
          pid: thread.pid ?? null,
          tid: thread.tid ?? null,
          thread: thread.name,
          processType: thread.processType ?? current.meta?.processType ?? null,
          data,
          payloadName: decodeString(data?.name),
          screenshotUrl: decodeString(data?.url),
        });
      }
    }
    for (const [index, child] of (current.processes ?? []).entries()) {
      // Modern raw profiles use objects. A legacy serialized child is parsed,
      // never flattened without that child's explicit epoch correction.
      visit(typeof child === 'string' ? JSON.parse(child) : child, `${path}/${index}`);
    }
  }
  visit(profile, 'root');
  const start = markers.filter(
    (entry) => entry.name === 'UserTiming' && entry.payloadName === audit.startMark,
  );
  const end = markers.filter(
    (entry) => entry.name === 'UserTiming' && entry.payloadName === audit.endMark,
  );
  const clockAligned =
    malformed.length === 0 &&
    start.length === 1 &&
    end.length === 1 &&
    start[0].pid === end[0].pid &&
    start[0].tid === end[0].tid &&
    Math.abs(end[0].atMs - start[0].atMs - (audit.endAt - audit.startAt)) <= 2;
  const common = {
    formatVersion: profile.meta?.version ?? null,
    processMetadata,
    malformed,
    clockAligned,
    clockEvidence: {
      startMarkers: start.map((entry) => ({
        name: entry.name,
        atMs: entry.atMs,
        pid: entry.pid,
        tid: entry.tid,
        payloadName: entry.payloadName,
      })),
      endMarkers: end.map((entry) => ({
        name: entry.name,
        atMs: entry.atMs,
        pid: entry.pid,
        tid: entry.tid,
        payloadName: entry.payloadName,
      })),
      pageStartMs: audit.startAt,
      pageEndMs: audit.endAt,
      profileRootEpochMs: rootEpoch,
      maximumAllowedSpanMismatchMs: 2,
    },
    interpretation:
      'CompositorScreenshot contains browser compositor-produced pixels, not a WebDriver drawSnapshot. Paint/Composite marker occurrences describe operations, not physical presentations. Screenshots may be sampled or omitted by Firefox; their rate is not the display frame rate. The unchanged 1x player advances a real DSL step every 500ms.',
  };
  if (!clockAligned)
    return {
      ...common,
      reason: 'Page UserTiming pair did not prove a shared clock',
      screenshots: [],
    };
  const offset = start[0].atMs - audit.startAt;
  const inventory = new Map();
  for (const entry of markers) {
    if (!/(paint|frame|composit|render|vsync|screenshot)/i.test(entry.name ?? '')) continue;
    const key = `${entry.name}|${entry.pid}|${entry.tid}`;
    const row = inventory.get(key) ?? {
      name: entry.name,
      pid: entry.pid,
      tid: entry.tid,
      thread: entry.thread,
      processType: entry.processType,
      count: 0,
    };
    row.count++;
    inventory.set(key, row);
  }
  const screenshots = markers
    .filter(
      (entry) =>
        entry.name === 'CompositorScreenshot' &&
        entry.data?.type === 'CompositorScreenshot' &&
        typeof entry.screenshotUrl === 'string' &&
        /^data:image\/(?:jpeg|png);base64,/.test(entry.screenshotUrl),
    )
    .map((entry) => ({
      pageMs: entry.atMs - offset,
      pid: entry.pid,
      tid: entry.tid,
      windowID: entry.data.windowID ?? null,
      windowWidth: entry.data.windowWidth ?? null,
      windowHeight: entry.data.windowHeight ?? null,
      url: entry.screenshotUrl,
    }))
    .sort((left, right) => left.pageMs - right.pageMs);
  function windowEvents(from, duration) {
    const until = from + duration;
    const selected = markers.filter(
      (entry) => entry.atMs - offset >= from && entry.atMs - offset <= until,
    );
    const pipelines = [
      'Paint',
      'Composite',
      'CompositeToTarget',
      'Render',
      'Renderer',
      'CompositorScreenshot',
      'RefreshDriverTick',
      'VsyncTimestamp',
    ].map((name) => {
      // Phase 2 is INTERVAL_START, phase 3 the corresponding INTERVAL_END.
      // Count completed/instant records rather than doubling both interval ends.
      const entries = selected.filter((entry) => entry.name === name && entry.phase !== 2);
      const content = entries.filter((entry) => entry.pid === start[0].pid);
      const timestamps = [...new Set(entries.map((entry) => entry.atMs))].sort((a, b) => a - b);
      return {
        name,
        ownedBrowserAllProcesses: entries.length,
        pageProcessEvents: content.length,
        uniqueTimestamps: timestamps.length,
        observedEventsPerSecond: timestamps.length / (duration / 1000),
        eventGapMs: playbackStats(intervals(timestamps)),
        completeDurationMs: playbackStats(
          entries.flatMap((entry) =>
            entry.startMs !== null && entry.endMs !== null && entry.endMs >= entry.startMs
              ? [entry.endMs - entry.startMs]
              : [],
          ),
        ),
      };
    });
    const images = screenshots.filter((entry) => entry.pageMs >= from && entry.pageMs <= until);
    return {
      startMs: from,
      endMs: until,
      durationMs: duration,
      pipelines,
      compositorScreenshotCount: images.length,
      screenshotWindowIDs: [...new Set(images.map((entry) => entry.windowID))],
      pageProcessPaintObserved: pipelines.some(
        (entry) => entry.name === 'Paint' && entry.pageProcessEvents > 0,
      ),
      namedCompositeObserved: pipelines.some(
        (entry) =>
          ['Composite', 'CompositeToTarget'].includes(entry.name) &&
          entry.ownedBrowserAllProcesses > 0,
      ),
      possibleDroppedFrameMarkers: selected
        .filter((entry) => /(DroppedFrame|DropFrame|MissedVsync)/i.test(entry.name ?? ''))
        .map((entry) => ({
          name: entry.name,
          atMs: entry.atMs,
          pid: entry.pid,
          tid: entry.tid,
          data: entry.data,
          pageMs: entry.atMs - offset,
        })),
      longMainThreadOperations: selected
        .filter(
          (entry) =>
            entry.pid === start[0].pid &&
            entry.thread === 'GeckoMain' &&
            entry.startMs !== null &&
            entry.endMs !== null &&
            entry.endMs - entry.startMs > 50,
        )
        .map((entry) => ({
          name: entry.name,
          pageMs: entry.startMs - offset,
          durationMs: entry.endMs - entry.startMs,
        })),
      longOperationBoundary:
        'Raw main-thread profiler intervals longer than 50ms are reported separately; they are not substituted for the unsupported Long Tasks API.',
    };
  }
  return {
    ...common,
    profileToPageOffsetMs: offset,
    pageProcessId: start[0].pid,
    inventory: [...inventory.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    startup: windowEvents(audit.startAt, startupMs),
    stable: windowEvents(audit.startAt + startupMs, stableMs),
    screenshots,
  };
}

/** Decoded compositor pixels are inspected only after the measured window. */
async function decodeCompositorImages(input) {
  const result = [];
  for (const entry of input) {
    const comma = entry.url.indexOf(',');
    const bytes = Uint8Array.from(atob(entry.url.slice(comma + 1)), (value) => value.charCodeAt(0));
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: entry.url.slice(5, entry.url.indexOf(';')) }),
    );
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    result.push({
      pageMs: entry.pageMs,
      windowID: entry.windowID,
      width: canvas.width,
      height: canvas.height,
      rgbaSha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', rgba))]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(''),
    });
  }
  return result;
}

async function ensureFree(port) {
  await new Promise((resolveFree, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => socket.close(resolveFree));
  });
}
async function stopOwned(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await delay(100);
  }
  throw new Error('Owned geckodriver did not stop; unrelated processes were not touched.');
}

async function main() {
  const label = process.env.PERF_LABEL ?? 'firefox-playback';
  const workloadKey = process.env.PERF_CASE ?? 'bubble-sort-maximum';
  const driverPort = Number(process.env.PERF_DRIVER_PORT ?? 4456);
  assert.match(label, /^[a-z0-9-]+$/);
  assert.ok(['bubble-sort-maximum', 'selection-sort-maximum'].includes(workloadKey));
  assert.ok(
    Number.isSafeInteger(driverPort) &&
      driverPort >= 1024 &&
      driverPort <= 65535 &&
      ![4190, 4192, 4193].includes(driverPort),
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
  const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
  const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
  assert.ok(existsSync(binary) && existsSync(executable));
  const driverOrigin = `http://127.0.0.1:${driverPort}`;
  const writeNew = (name, value) =>
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const hostPath = resolve(
    workspaceDir,
    process.env.PERF_HOST_REPORT ?? '.artifacts/11.4/conditions-host.json',
  );
  const report = {
    task: '11.4',
    baseline: 'DEC-004 / PERF-BASE-01 V1.0 / BUDGET-P0 V1.0',
    browser: 'stock-Firefox',
    kind: 'Real reverse-30 native playback; 2s startup plus 30s stable',
    startedAt: new Date().toISOString(),
    workload: workloadKey,
    workloadSha256: sha(JSON.stringify(sample)),
    toolEnvironment: checkEnvironment({ bindgen: true }),
    suppliedHostReport: hostPath,
    suppliedHostConditions: JSON.parse(readFileSync(hostPath)),
    hostConditions: null,
    hostConditionsEnd: null,
    currentOs: { release: release(), version: osVersion(), totalMemoryBytes: totalmem() },
    observation: {
      startupMs,
      stableMs,
      captureMs,
      frameMeasureName,
      defaultRate: 1,
      defaultStepMs: 500,
    },
    boundary:
      'Only native public controls operate the actual production case. The complete real Rust execution is setup, not a cold/500ms performance sample. No algorithm/result injection, changed speed, timers or omitted trace states. HTTPS/Worker requests use the shared shaping service.',
    drawingBoundary:
      'Only Gecko Profiler CompositorScreenshot images and named drawing operations constitute actual browser drawing evidence. rAF is scheduling evidence. WebDriver screenshots are saved only as functional UI evidence. Neither screenshot capture cadence nor Paint/Composite operations prove physical display presentation at 60fps.',
    overhead:
      'Gecko marker profiling with screenshots, bounded app measures, per-cursor DOM fingerprints/geometry and rAF add observation overhead retained in all measured values. No WebDriver commands or screenshots are issued during the 32s capture. Pixel decode, WebGL query, hashes and functional checks follow the measured window.',
    sources: [
      'https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html#allow-system-access',
      'https://raw.githubusercontent.com/mozilla-firefox/firefox/main/tools/profiler/gecko/nsIProfiler.idl',
      'https://raw.githubusercontent.com/mozilla-firefox/firefox/main/dom/performance/Performance.cpp',
      'https://raw.githubusercontent.com/mozilla-firefox/firefox/main/gfx/layers/ProfilerScreenshots.cpp',
      'https://github.com/firefox-devtools/profiler/blob/main/docs-developer/gecko-profile-format.md',
    ],
    certificateAcceptance: {
      acceptInsecureCerts: true,
      installedSystemTrust: false,
      boundary: 'Task-owned local HTTPS lab; not public certificate/cache acceptance.',
    },
    hashes: Object.fromEntries(
      [
        'package-lock.json',
        'Cargo.lock',
        'scripts/performance-playback-firefox.mjs',
        'scripts/performance-playback.mjs',
        'scripts/performance-observer.mjs',
        'scripts/performance-host.mjs',
        'scripts/performance-workloads.mjs',
        'scripts/serve-performance.mjs',
        'web/src/generated/c_viz_wasm_bg.wasm',
      ].map((path) => [path, sha(readFileSync(join(workspaceDir, path)))]),
    ),
    nativeScrolls: [],
    cleanupErrors: [],
  };
  let driver, server, sessionId, bidi;
  let serviceLog = '';
  let profilerActive = false;
  const wd = async (path, method = 'GET', body) => {
    const response = await fetch(`${driverOrigin}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: globalThis.AbortSignal.timeout(60_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok || data.value?.error)
      throw new Error(`WebDriver: ${JSON.stringify(data.value)}`);
    return data.value;
  };
  const js = (script, args = []) =>
    wd(`/session/${sessionId}/execute/sync`, 'POST', { script, args });
  const runFunction = (fn, args = []) => js(`return (${fn.toString()})(...arguments);`, args);
  const asyncScript = (script, args = []) =>
    wd(`/session/${sessionId}/execute/async`, 'POST', { script, args });
  const until = async (script, args = [], attempts = 200) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const value = await js(script, args);
      if (value) return value;
      await delay(50);
    }
    throw new Error(`Expected real Firefox UI state not reached: ${script}`);
  };
  async function chrome(script, args = [], asynchronous = false) {
    await wd(`/session/${sessionId}/moz/context`, 'POST', { context: 'chrome' });
    try {
      return await (asynchronous ? asyncScript(script, args) : js(script, args));
    } finally {
      await wd(`/session/${sessionId}/moz/context`, 'POST', { context: 'content' });
    }
  }
  const element = async (selector) =>
    wd(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector });
  async function stableBounds(found) {
    return asyncScript(
      String.raw`
const target=arguments[0],done=arguments[arguments.length-1];
let previous=null,stableFrames=0,frames=0;
function frame(){
 const r=target.getBoundingClientRect();
 const width=Math.min(innerWidth,document.documentElement.clientWidth,visualViewport?.width??Infinity);
 const height=Math.min(innerHeight,document.documentElement.clientHeight,visualViewport?.height??Infinity);
 const x=r.left+r.width/2,y=r.top+r.height/2;
 const inViewport=r.width>0&&r.height>0&&x>=8&&x<=width-8&&y>=8&&y<=height-8;
 const hit=inViewport?document.elementFromPoint(x,y):null;
 const current={left:r.left,top:r.top,targetWidth:r.width,targetHeight:r.height,x,y,width,height,scrollX,scrollY,inViewport,clickable:inViewport&&!!hit&&(hit===target||target.contains(hit))};
 frames++;
 stableFrames=previous&&['left','top','targetWidth','targetHeight','width','height','scrollX','scrollY'].every(k=>Math.abs(current[k]-previous[k])<=.25)?stableFrames+1:0;
 if(stableFrames>=8||frames>=180){done({...current,stable:stableFrames>=8,stableFrames,frames});return;}
 previous=current;requestAnimationFrame(frame);
}
requestAnimationFrame(frame);`,
      [found],
    );
  }
  async function clickElement(found, labelForLog) {
    let bounds = await stableBounds(found);
    for (let adjustment = 0; adjustment < 4; adjustment++) {
      assert.equal(bounds.stable, true, `Unstable native target: ${labelForLog}`);
      if (
        bounds.clickable &&
        (Math.abs(bounds.y - bounds.height / 2) <= bounds.height / 4 || adjustment > 0)
      )
        break;
      const deltaY = Math.round(bounds.y - bounds.height / 2);
      assert.notEqual(deltaY, 0, `Obscured native target: ${labelForLog}`);
      const before = bounds;
      await wd(`/session/${sessionId}/actions`, 'POST', {
        actions: [
          {
            type: 'wheel',
            id: 'playback-wheel',
            actions: [
              {
                type: 'scroll',
                x: Math.floor(bounds.width) - 20,
                y: Math.floor(bounds.height / 2),
                deltaX: 0,
                deltaY,
                duration: 200,
              },
            ],
          },
        ],
      });
      bounds = await stableBounds(found);
      report.nativeScrolls.push({ label: labelForLog, deltaY, before, after: bounds });
    }
    assert.equal(
      bounds.stable && bounds.clickable && bounds.inViewport,
      true,
      `Native target not ready: ${labelForLog}`,
    );
    await wd(`/session/${sessionId}/element/${found[elementKey]}/click`, 'POST', {});
  }
  async function clickText(text) {
    assert.ok(!text.includes("'"));
    const found = await wd(`/session/${sessionId}/element`, 'POST', {
      using: 'xpath',
      value: `//button[normalize-space(.)='${text}']`,
    });
    await clickElement(found, text);
  }
  const space = () =>
    wd(`/session/${sessionId}/actions`, 'POST', {
      actions: [
        {
          type: 'key',
          id: 'playback-key',
          actions: [
            { type: 'keyDown', value: ' ' },
            { type: 'keyUp', value: ' ' },
          ],
        },
      ],
    });
  const screenshot = async (name) =>
    writeFileSync(
      join(output, name),
      Buffer.from(await wd(`/session/${sessionId}/screenshot`), 'base64'),
      { flag: 'wx' },
    );
  async function connectBidi(url) {
    const socket = new globalThis.WebSocket(url);
    const pending = new Map();
    let nextId = 0;
    const rejectAll = (error) => {
      for (const item of pending.values()) {
        clearTimeout(item.timeout);
        item.reject(error);
      }
      pending.clear();
    };
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timeout);
      if (message.type === 'success') item.resolve(message.result);
      else item.reject(new Error(`BiDi: ${JSON.stringify(message)}`));
    });
    socket.addEventListener('close', () => rejectAll(new Error('Owned BiDi closed')));
    await new Promise((resolveOpen, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('BiDi connection timeout'));
      }, 10000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout);
          resolveOpen();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout);
          reject(new Error('BiDi connection failed'));
        },
        { once: true },
      );
    });
    return {
      command(method, params) {
        return new Promise((resolveCommand, reject) => {
          const id = ++nextId;
          const timeout = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`BiDi command timeout: ${method}`));
          }, 10000);
          pending.set(id, { resolve: resolveCommand, reject, timeout });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() {
        rejectAll(new Error('Owned BiDi cleanup'));
        socket.close();
      },
    };
  }
  async function collectProfile() {
    const target = join(output, 'playback.gecko-profile.json');
    assert.ok(!existsSync(target));
    const result = await chrome(
      String.raw`
const done=arguments[arguments.length-1];
(async()=>{
 const p=Components.classes['@mozilla.org/tools/profiler;1'].getService(Components.interfaces.nsIProfiler);
 if(!p.IsActive())throw new Error('The owned profiler stopped before collection');
 await p.Pause();
 const profile=await p.getProfileDataAsync();
 if(!profile?.meta||!Array.isArray(profile.threads)||!Array.isArray(profile.processes))
  throw new Error('The native all-process profile is missing its raw structure');
 const raw=JSON.stringify(profile);
 const configuration=p.activeConfiguration;
 await p.StopProfiler();
 done({ok:true,configuration,raw});
})().catch(error=>done({ok:false,message:String(error),stack:error.stack}));`,
      [],
      true,
    );
    assert.equal(result.ok, true, result.message);
    profilerActive = false;
    assert.equal(typeof result.raw, 'string');
    // nsIProfiler's native dump uses a narrow filename on Windows. Transfer the
    // complete native profile unchanged, then let Node write this Unicode path.
    writeFileSync(target, result.raw, { encoding: 'utf8', flag: 'wx' });
    assert.ok(existsSync(target) && statSync(target).size > 0, 'No raw all-process Gecko profile');
    return {
      rawFile: 'playback.gecko-profile.json',
      bytes: statSync(target).size,
      sha256: sha(readFileSync(target)),
      configuration: result.configuration,
      collectionMethod:
        'nsIProfiler.getProfileDataAsync all-process native object; JSON.stringify in browser, returned unchanged over local WebDriver and written UTF-8 with wx by Node after the measured window',
    };
  }
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
    for (const port of [4192, 4193, driverPort]) await ensureFree(port);
    server = await startPerformanceServer({
      port: 4192,
      internalPort: 4193,
      logPrefix: `.artifacts/11.4/${label}/network`,
    });
    report.server = server.metadata;
    driver = spawn(
      executable,
      ['--port', String(driverPort), '--log', 'warn', '--allow-system-access'],
      { cwd: workspaceDir, windowsHide: true, stdio: 'pipe' },
    );
    driver.on('error', (error) => {
      serviceLog += `${error.stack ?? error.message}\n`;
    });
    for (const stream of [driver.stdout, driver.stderr])
      stream.on('data', (chunk) => {
        serviceLog += chunk.toString();
      });
    let driverIsReady = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(driver.exitCode, null, serviceLog);
      assert.equal(driver.signalCode, null, serviceLog);
      try {
        if ((await wd('/status'))?.ready) {
          driverIsReady = true;
          break;
        }
      } catch {
        /* Owned service is starting. */
      }
      await delay(100);
    }
    assert.equal(driverIsReady, true, serviceLog);
    const session = await wd('/session', 'POST', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          acceptInsecureCerts: true,
          webSocketUrl: true,
          'moz:firefoxOptions': {
            binary,
            args: [],
            prefs: {
              'app.update.auto': false,
              'browser.shell.checkDefaultBrowser': false,
              'layout.css.devPixelsPerPx': '1.0',
              'intl.accept_languages': 'zh-CN,zh,en-US,en',
              'extensions.autoDisableScopes': 15,
            },
          },
        },
      },
    });
    sessionId = session.sessionId;
    report.capabilities = session.capabilities;
    assert.match(session.capabilities.browserVersion, /^158\./);
    assert.equal(session.capabilities['moz:headless'], false);
    report.browserVersion = session.capabilities.browserVersion;
    await wd(`/session/${sessionId}/timeouts`, 'POST', {
      script: 60000,
      pageLoad: 30000,
      implicit: 0,
    });
    let rect = { x: 0, y: 0, width: 1440, height: 900 };
    for (let attempt = 0; attempt < 4; attempt++) {
      await wd(`/session/${sessionId}/window/rect`, 'POST', rect);
      const actual = await js(
        'return {width:innerWidth,height:innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio};',
      );
      if (actual.width === 1440 && actual.height === 900 && actual.dpr === 1) {
        report.viewport = actual;
        break;
      }
      rect = {
        x: 0,
        y: 0,
        width: actual.outerWidth + 1440 - actual.width,
        height: actual.outerHeight + 900 - actual.height,
      };
    }
    assert.ok(report.viewport, 'Exact 1440x900 DPR1 viewport could not be established');
    assert.equal((await wd(`/session/${sessionId}/window/handles`)).length, 1);
    report.profilerAccess = {
      method: 'Task-owned geckodriver --allow-system-access / moz/context chrome',
      touchesExistingFirefox: false,
      installsExtension: false,
    };
    bidi = await connectBidi(session.capabilities.webSocketUrl);
    const startMark = `cviz.playback.${label}.start`,
      endMark = `cviz.playback.${label}.end`;
    const preload = `()=>{(${installPerformanceObserver.toString()})();(${installPlaybackProbe.toString()})(${JSON.stringify({ startMark, endMark, captureMs, frameMeasureName })});}`;
    await bidi.command('script.addPreloadScript', { functionDeclaration: preload });
    report.preloadSha256 = sha(preload);
    await wd(`/session/${sessionId}/url`, 'POST', {
      url: `${server.origin}/#/visualize/${sample.caseId}`,
    });
    await until(
      'return document.querySelector("[data-testid=case-execution]")?.dataset.state==="ready"&&!!document.querySelector("[data-testid=code-panel] textarea")?.value;',
    );
    const input = await element('[data-testid="input-field-values"]');
    await wd(`/session/${sessionId}/element/${input[elementKey]}/clear`, 'POST', {});
    const values = sample.values.values.join(', ');
    await wd(`/session/${sessionId}/element/${input[elementKey]}/value`, 'POST', { text: values });
    await until(
      'return document.querySelector("[data-testid=input-field-values]")?.value===arguments[0];',
      [values],
    );
    await clickText('应用输入并准备');
    await until(
      'return document.querySelector("[data-testid=case-execution]")?.dataset.state==="ready"&&!!document.querySelector("[data-testid=code-panel] textarea")?.value;',
    );
    await clickText('运行示例');
    await until(
      'const i=window.__performanceAudit?.intents.at(-1);return i?.label==="运行示例"&&i.end!==null;',
      [],
      100,
    );
    assert.equal(
      await js('return document.querySelector("[data-testid=case-execution]")?.dataset.state;'),
      'completed',
      'Real Rust run must complete before playback',
    );
    report.execution = await runFunction(readRealExecution, [sample.stdout]);
    assert.equal(report.execution.producer, 'rust');
    assert.equal(report.execution.terminal, 'completed');
    assert.equal(report.execution.trace.completeness, 'complete');
    assert.equal(report.execution.domOutputMatches, true);
    assert.ok(report.execution.trace.steps > 100);
    const initial = await runFunction(readObservableState);
    assert.equal(initial.cursor, 0);
    report.initialState = {
      cursor: initial.cursor,
      status: initial.status,
      sha256: sha(initial.canonical),
    };
    assert.equal(
      await js('return document.querySelector("select[aria-label=播放速度]")?.value;'),
      '1',
    );
    let setupSteps = 0;
    while (
      !(await js(
        'return document.querySelectorAll("[data-testid=trace-array][data-logical-length=\\"30\\"]").length;',
      )) &&
      setupSteps < 20
    ) {
      await clickText('前进');
      setupSteps++;
    }
    assert.equal(
      await js(
        'return document.querySelectorAll("[data-testid=trace-array][data-logical-length=\\"30\\"] [data-testid=trace-array-cell]").length;',
      ),
      30,
    );
    const chart = await element(
      '[data-testid="trace-array"][data-logical-length="30"] .array-chart-scroll',
    );
    await clickElement(chart, 'real thirty-cell array chart');
    report.setup = {
      nativeForwardSteps: setupSteps,
      startCursor: (await runFunction(readObservableState)).cursor,
      arrayBoundary:
        'All 30 real cells rendered. Horizontal clipping and visible-cell counts are reported by the shared probe.',
    };
    assert.ok(report.execution.trace.steps - report.setup.startCursor > captureMs / 500 + 2);
    await screenshot('before-playback.png');
    report.profiler = await chrome(
      String.raw`
const done=arguments[arguments.length-1];
(async()=>{
 const p=Components.classes['@mozilla.org/tools/profiler;1'].getService(Components.interfaces.nsIProfiler);
 if(p.IsActive())throw new Error('Unexpected existing profiler in owned browser');
 const supported=p.GetFeatures();
 if(!supported.includes('screenshots'))throw new Error('Stock Firefox does not expose compositor screenshots feature');
 const features=['screenshots','threads','nostacksampling','nomarkerstacks'].filter(feature=>supported.includes(feature));
 const settings={entries:16777216,interval:1,features,filters:['GeckoMain','Compositor','Renderer','RenderBackend']};
 await p.StartProfiler(settings.entries,settings.interval,settings.features,settings.filters,0);
 done({ok:true,supported,settings,activeConfiguration:p.activeConfiguration});
})().catch(error=>done({ok:false,message:String(error),stack:error.stack}));`,
      [],
      true,
    );
    assert.equal(report.profiler.ok, true, report.profiler.message);
    profilerActive = true;
    // A context switch has no product side effects. Native chart focus is
    // re-established before arming, outside the measured window.
    await clickElement(chart, 'real chart keyboard focus');
    assert.equal(
      await js(
        'const a=document.activeElement;return !!a?.closest("[data-testid=player-workspace]")&&!a.closest("input,textarea,select,button,a,[contenteditable=true]");',
      ),
      true,
    );
    await js('window.__playbackPerformanceAudit.armed=true;return true;');
    await space();
    // No automation polling, screenshots, scrolls or commands during capture.
    await delay(captureMs + 300);
    await until('return window.__playbackPerformanceAudit?.endAt!==null;', [], 20);
    await space();
    report.trace = await collectProfile();
    report.audit = await runFunction(readPlaybackProbe);
    writeNew('playback-observations.json', report.audit);
    report.startup = summarizePlaybackWindow(report.audit, report.audit.startAt, startupMs);
    report.stable = summarizePlaybackWindow(
      report.audit,
      report.audit.startAt + startupMs,
      stableMs,
    );
    const during = (at) => at >= report.audit.startAt && at <= report.audit.endAt;
    report.controls = {
      referenceHostConditions: false,
      fullStable30Seconds:
        Number.isFinite(report.audit.startAt) &&
        Number.isFinite(report.audit.endAt) &&
        report.audit.endAt - report.audit.startAt >= captureMs,
      nativeStartTrusted: report.audit.actions[0]?.trusted === true,
      nativePauseTrusted:
        report.audit.actions.length === 2 && report.audit.actions[1].trusted === true,
      stableRemainedPlaying:
        report.audit.statusChanges
          .filter((entry) => entry.at <= report.audit.startAt + startupMs)
          .at(-1)?.status === 'playing' &&
        report.audit.statusChanges
          .filter((entry) => entry.at >= report.audit.startAt + startupMs && during(entry.at))
          .every((entry) => entry.status === 'playing'),
      endStillPlaying: report.audit.endState.status === 'playing',
      defaultRateUnchanged:
        report.audit.initialState.rate === '1' &&
        report.audit.endState.rate === '1' &&
        report.audit.changes.every((entry) => entry.rate === '1'),
      foreground:
        report.audit.initialState.visibility === 'visible' &&
        report.audit.initialState.hasFocus &&
        report.audit.endState.visibility === 'visible' &&
        report.audit.endState.hasFocus &&
        report.audit.visibility
          .filter((entry) => during(entry.at))
          .every((entry) => entry.state === 'visible') &&
        report.audit.focus.filter((entry) => during(entry.at)).every((entry) => entry.value) &&
        report.audit.changes.every((entry) => entry.visibility === 'visible' && entry.hasFocus) &&
        report.audit.environment.visibility === 'visible' &&
        report.audit.environment.hasFocus,
      viewport:
        report.audit.environment.viewport[0] === 1440 &&
        report.audit.environment.viewport[1] === 900 &&
        report.audit.environment.devicePixelRatio === 1 &&
        report.audit.environment.visualViewport?.scale === 1,
      noServiceWorker: !report.audit.environment.serviceWorkerControlled,
      singleOwnedTab: (await wd(`/session/${sessionId}/window/handles`)).length === 1,
      actualThirtyCellStates:
        report.stable.allObservedArraysHave30Cells &&
        report.stable.domCursorChanges > 1 &&
        report.stable.minimumVisibleCells > 0,
      completeSequentialPlayback: report.stable.everyObservedCursorSequential,
      sameOrigin:
        report.audit.resources.every((entry) => new URL(entry.url).origin === server.origin) &&
        report.execution.workers.every((entry) => new URL(entry.url).origin === server.origin),
    };
    const drawing = analyzeFirefoxPlaybackProfile(
      JSON.parse(readFileSync(join(output, report.trace.rawFile), 'utf8')),
      report.audit,
    );
    const screenshots = drawing.screenshots.filter(
      (entry) =>
        entry.pageMs >= report.audit.startAt && entry.pageMs <= report.audit.startAt + captureMs,
    );
    delete drawing.screenshots;
    report.drawing = drawing;
    mkdirSync(join(output, 'compositor-screenshots'));
    report.compositorScreenshots = [];
    for (const [index, row] of screenshots.entries()) {
      const bytes = Buffer.from(row.url.slice(row.url.indexOf(',') + 1), 'base64');
      const extension = row.url.startsWith('data:image/png;') ? 'png' : 'jpeg';
      const file = `compositor-screenshots/${String(index).padStart(4, '0')}.${extension}`;
      writeFileSync(join(output, file), bytes, { flag: 'wx' });
      report.compositorScreenshots.push({
        file,
        pageMs: row.pageMs,
        windowID: row.windowID,
        windowWidth: row.windowWidth,
        windowHeight: row.windowHeight,
        sha256: sha(bytes),
        bytes: bytes.length,
      });
    }
    report.screenshotPixels = [];
    for (let index = 0; index < screenshots.length; index += 8) {
      const decoded = await asyncScript(
        `const input=arguments[0],done=arguments[arguments.length-1];(${decodeCompositorImages.toString()})(input).then(value=>done({ok:true,value}),error=>done({ok:false,message:String(error)}));`,
        [screenshots.slice(index, index + 8)],
      );
      assert.equal(decoded.ok, true, decoded.message);
      report.screenshotPixels.push(...decoded.value);
    }
    const stablePixels = report.screenshotPixels.filter(
      (entry) =>
        entry.pageMs >= report.audit.startAt + startupMs &&
        entry.pageMs <= report.audit.startAt + captureMs,
    );
    const windows = [...new Set(stablePixels.map((entry) => entry.windowID))].map((windowID) => {
      const frames = stablePixels.filter((entry) => entry.windowID === windowID);
      return {
        windowID,
        count: frames.length,
        distinctPixelHashes: new Set(frames.map((entry) => entry.rgbaSha256)).size,
      };
    });
    report.visualEvidence = {
      stableCompositorImages: stablePixels.length,
      windows,
      actualCompositorPixelsChanged: windows.some(
        (entry) => entry.count >= 2 && entry.distinctPixelHashes > 1,
      ),
      screenshotCadenceIsNotFrameRate: true,
      cropBoundary:
        'Profiler images cover the compositor window; no unverified content/array crop alignment is assumed.',
    };
    await screenshot('after-playback.png');
    const paused = await runFunction(readObservableState);
    assert.equal(paused.status, 'paused');
    await delay(650);
    const stillPaused = await runFunction(readObservableState);
    await clickText('前进');
    const forward = await runFunction(readObservableState);
    await clickText('后退');
    const restored = await runFunction(readObservableState);
    await clickText('重播');
    const replay = await runFunction(readObservableState);
    await clickText('暂停');
    report.nativeFunctional = {
      pause: {
        cursor: paused.cursor,
        after650msCursor: stillPaused.cursor,
        observableStateUnchanged: sha(paused.canonical) === sha(stillPaused.canonical),
      },
      forwardThenBack: {
        beforeCursor: paused.cursor,
        forwardCursor: forward.cursor,
        restoredCursor: restored.cursor,
        sha256Before: sha(paused.canonical),
        sha256Restored: sha(restored.canonical),
        observableStateRestored: sha(paused.canonical) === sha(restored.canonical),
      },
      replay: {
        observedFirstCursor: replay.cursor,
        observedStatus: replay.status,
        returnedInitialObservableState: sha(replay.canonical) === report.initialState.sha256,
      },
      boundary:
        'Native controls and full observable trace/source-location DOM hashes. Hidden control-flow restoration remains the responsibility of complete player-state tests; DOM equality is not represented as a proof of invisible state.',
    };
    report.nativeFunctionalPassed =
      paused.cursor === stillPaused.cursor &&
      report.nativeFunctional.pause.observableStateUnchanged &&
      forward.cursor === paused.cursor + 1 &&
      restored.cursor === paused.cursor &&
      report.nativeFunctional.forwardThenBack.observableStateRestored &&
      replay.cursor === 0 &&
      replay.status === 'playing' &&
      report.nativeFunctional.replay.returnedInitialObservableState;
    const metricValues = Object.values(report.stable.metricPasses);
    report.submetricConclusion = {
      metricsMeasured: metricValues.every((value) => value !== null),
      allThreeMetricsPass: metricValues.every((value) => value === true),
      actualDrawingEvidencePresent:
        drawing.clockAligned &&
        drawing.stable?.compositorScreenshotCount >= 2 &&
        report.visualEvidence.actualCompositorPixelsChanged,
      longTasksApiSupported: report.audit.supports.longtask,
      physicalPresentationRateMeasured: false,
      sixtyFps:
        'rAF and compositor screenshots do not establish physical 60fps presentation. Review actual refresh-rate host evidence, named operations, dropped-frame markers, visual changes and 500ms teaching-state cadence together.',
      completeAcceptance: null,
    };
  } catch (error) {
    report.failure = { message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    if (profilerActive && sessionId) {
      try {
        report.trace ??= await collectProfile();
      } catch (error) {
        report.cleanupErrors.push({
          component: 'partial raw Gecko profile',
          message: error.message,
        });
      }
      if (profilerActive) {
        try {
          await chrome(
            'const done=arguments[arguments.length-1];const p=Components.classes["@mozilla.org/tools/profiler;1"].getService(Components.interfaces.nsIProfiler);Promise.resolve(p.StopProfiler()).then(()=>done(true),error=>done({message:String(error)}));',
            [],
            true,
          );
          profilerActive = false;
        } catch (error) {
          report.cleanupErrors.push({ component: 'owned profiler', message: error.message });
        }
      }
    }
    if (sessionId && !report.audit) {
      try {
        report.audit = await runFunction(readPlaybackProbe);
        writeNew('playback-observations.json', report.audit);
      } catch (error) {
        report.cleanupErrors.push({
          component: 'partial page observations',
          message: error.message,
        });
      }
    }
    try {
      bidi?.close();
    } catch (error) {
      report.cleanupErrors.push({ component: 'owned BiDi', message: error.message });
    }
    if (sessionId) {
      try {
        await wd(`/session/${sessionId}`, 'DELETE');
        sessionId = undefined;
      } catch (error) {
        report.cleanupErrors.push({ component: 'owned Firefox session', message: error.message });
      }
    }
    const stopped = await Promise.allSettled([stopOwned(driver), server?.stop()]);
    for (const [index, result] of stopped.entries())
      if (result.status === 'rejected')
        report.cleanupErrors.push({
          component: index ? 'owned HTTPS server' : 'owned geckodriver',
          message: String(result.reason),
        });
    report.ownedServicesStopped = report.cleanupErrors.length === 0;
    try {
      report.hostConditionsEnd = capturePerformanceHost(output, 'end');
    } catch (error) {
      report.hostCaptureFailure = {
        ...report.hostCaptureFailure,
        end: { message: error.message, stack: error.stack },
      };
    }
    report.referenceHost = qualifyPerformanceHost(report.hostConditions, report.hostConditionsEnd);
    const referenceHostConditions = report.referenceHost.satisfied && !report.hostCaptureFailure;
    report.controls ??= {};
    report.controls.referenceHostConditions = referenceHostConditions;
    if (report.submetricConclusion)
      report.submetricConclusion.referenceHostConditions = referenceHostConditions;
    report.allMeasuredChecksPass =
      referenceHostConditions &&
      !report.failure &&
      report.ownedServicesStopped &&
      Object.values(report.controls).every(Boolean) &&
      report.nativeFunctionalPassed === true &&
      report.submetricConclusion?.allThreeMetricsPass === true &&
      report.submetricConclusion?.actualDrawingEvidencePresent === true;
    if (!report.allMeasuredChecksPass) process.exitCode = 1;
    report.endedAt = new Date().toISOString();
    writeFileSync(join(output, 'geckodriver.log'), serviceLog, { flag: 'wx' });
    writeNew('report.json', report);
    if (report.cleanupErrors.length) process.exitCode = 1;
    console.log(
      JSON.stringify({
        label,
        browser: report.browserVersion,
        stable: report.stable,
        drawing: report.submetricConclusion,
        allMeasuredChecksPass: report.allMeasuredChecksPass,
        failure: report.failure,
        cleanupErrors: report.cleanupErrors,
      }),
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
