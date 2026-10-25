// Stock Firefox 158 pilot. All product interactions use native WebDriver input.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkEnvironment } from './environment.mjs';
import { installPerformanceObserver, readPerformanceAudit } from './performance-observer.mjs';
import { performanceCases } from './performance-workloads.mjs';
import { workspaceDir } from './process.mjs';
import { startPerformanceServer } from './serve-performance.mjs';

const environment = checkEnvironment({ bindgen: true });
const label = process.env.PERF_LABEL ?? 'pilot';
assert.match(label, /^[a-z0-9-]+$/);
const output = join(workspaceDir, '.artifacts/11.4', `firefox-performance-${label}`);
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
const driverPort = 4453;
const driverOrigin = `http://127.0.0.1:${driverPort}`;
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const cases = ['assignment-negative', 'bubble-sort-maximum', 'selection-sort-maximum'];
assert.ok(existsSync(binary) && existsSync(executable));
// Preserve every previous pilot, including failed samples.
mkdirSync(join(workspaceDir, '.artifacts/11.4'), { recursive: true });
mkdirSync(output);

let driver;
let server;
let sessionId;
let bidi;
let failure;
let serviceLog = '';
const nativeScrolls = [];
const report = {
  task: '11.4',
  evidenceLevel: 'exploratory-stock-Firefox-three-case-warmModule-pilot',
  formalAcceptance: false,
  startedAt: new Date().toISOString(),
  environment,
  origin: 'https://127.0.0.1:4190',
  driverPort,
  browser: 'stock-Firefox',
  headful: true,
  viewport: [1440, 900],
  repeatsPerCase: 3,
  frozenBudgetsMs: { executeIntentToValidatedInitialPaint: 500, safety: 1000 },
  cacheBoundary:
    'Each case uses a new WebDriver session and a new Firefox profile with an empty browser cache. This is a cold page/profile, not a cold execute Module. Applying inputs invokes the real prepare-case Worker and warms the page Module before all three measured execute clicks. Every execute still uses a new product Worker. No coldModule acceptance sample is claimed.',
  observation:
    'The shared metadata observer is installed in the author realm before navigation using WebDriver BiDi script.addPreloadScript. Native clicks trigger the unchanged product execution and deadline. Readonly DOM inspection and shared audit collection occur after the observer records the terminal paint; audit collection does not replace timing or execution. Worker response time includes startup/instance/transfer, and Rust-reported rustMicros excludes final Assembly.',
  preload: {
    method: 'script.addPreloadScript',
    requestedCapability: 'webSocketUrl',
    sourceSha256: createHash('sha256').update(installPerformanceObserver.toString()).digest('hex'),
    specification: 'https://www.w3.org/TR/webdriver-bidi/#command-script-addPreloadScript',
  },
  cases: [],
};

async function ensureFree(port) {
  await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
}

function ownedDriver() {
  const child = spawn(executable, ['--port', String(driverPort), '--log', 'warn'], {
    cwd: workspaceDir,
    stdio: 'pipe',
    windowsHide: true,
  });
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
      /* Only this script's driver is starting. */
    }
    await delay(100);
  }
  throw new Error(`11.4 Firefox owned driver did not start: ${serviceLog}`);
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) return;
    await delay(100);
  }
  throw new Error('The owned geckodriver did not stop. No unrelated process was stopped.');
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

async function connectBidi(url) {
  const socket = new globalThis.WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  function rejectPending(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  }
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.type === 'success') entry.resolve(message.result);
    else entry.reject(new Error(`WebDriver BiDi: ${JSON.stringify(message)}`));
  });
  socket.addEventListener('close', () => rejectPending(new Error('WebDriver BiDi closed.')));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('WebDriver BiDi connection timed out.'));
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
        reject(new Error('WebDriver BiDi connection failed.'));
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
          reject(new Error(`WebDriver BiDi command timed out: ${method}`));
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
      rejectPending(new Error('WebDriver BiDi session cleanup.'));
      socket.close();
    },
  };
}

// Browser scripts below only observe DOM and shared instrumentation metadata.
// No application import, execution hook, JS click, scroll or input mutation.
const js = (script, args = []) =>
  wd(`/session/${sessionId}/execute/sync`, 'POST', { script, args });

async function until(script, args = [], attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await js(script, args);
    if (value) return value;
    await delay(50);
  }
  throw new Error(`11.4 Firefox expected UI state was not reached: ${script}`);
}

async function stableClickBounds(found) {
  return wd(`/session/${sessionId}/execute/async`, 'POST', {
    script: String.raw`
const target=arguments[0],done=arguments[arguments.length-1];
let previous=null,stableFrames=0,frames=0;
function measure(){
 const r=target.getBoundingClientRect();
 const width=Math.min(innerWidth,document.documentElement.clientWidth,visualViewport?.width??Infinity);
 const height=Math.min(innerHeight,document.documentElement.clientHeight,visualViewport?.height??Infinity);
 const centerX=r.left+r.width/2,centerY=r.top+r.height/2;
 const inViewport=r.width>0&&r.height>0&&centerX>=8&&centerX<=width-8&&centerY>=8&&centerY<=height-8;
 const hit=inViewport?document.elementFromPoint(centerX,centerY):null;
 return {left:r.left,top:r.top,targetWidth:r.width,targetHeight:r.height,centerX,centerY,width,height,
  scrollX,scrollY,inViewport,clickable:inViewport&&!!hit&&(hit===target||target.contains(hit))};
}
function frame(){
 const current=measure();frames++;
 const geometry=['left','top','targetWidth','targetHeight','width','height','scrollX','scrollY'];
 stableFrames=previous&&geometry.every(key=>Math.abs(current[key]-previous[key])<=0.25)?stableFrames+1:0;
 if(stableFrames>=8||frames>=180){done({...current,stable:stableFrames>=8,stableFrames,frames});return;}
 previous=current;requestAnimationFrame(frame);
}
requestAnimationFrame(frame);`,
    args: [found],
  });
}

async function clickText(text) {
  assert.ok(!text.includes("'"));
  const found = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'xpath',
    value: `//button[normalize-space(.)='${text}']`,
  });
  let bounds = await stableClickBounds(found);
  for (let adjustment = 0; adjustment < 4; adjustment++) {
    assert.equal(bounds.stable, true, `Unstable native click target: ${text}`);
    const centered = Math.abs(bounds.centerY - bounds.height / 2) <= bounds.height / 4;
    if (bounds.clickable && (centered || adjustment > 0)) break;
    const deltaY = Math.round(bounds.centerY - bounds.height / 2);
    assert.notEqual(deltaY, 0, `Native click target is obscured at viewport center: ${text}`);
    const before = bounds;
    await wd(`/session/${sessionId}/actions`, 'POST', {
      actions: [
        {
          type: 'wheel',
          id: 'performance-page-wheel',
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
    bounds = await stableClickBounds(found);
    nativeScrolls.push({ text, adjustment: adjustment + 1, deltaY, before, after: bounds });
  }
  const finalBounds = await stableClickBounds(found);
  assert.equal(finalBounds.stable, true, `Unstable target at native click: ${text}`);
  assert.equal(finalBounds.inViewport, true, `Native target outside viewport: ${text}`);
  assert.equal(finalBounds.clickable, true, `Native target obscured: ${text}`);
  await wd(`/session/${sessionId}/element/${found[elementKey]}/click`, 'POST', {});
}

async function fill(selector, text) {
  const found = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'css selector',
    value: selector,
  });
  const path = `/session/${sessionId}/element/${found[elementKey]}`;
  await wd(`${path}/clear`, 'POST', {});
  await wd(`${path}/value`, 'POST', { text });
  await until('return document.querySelector(arguments[0])?.value===arguments[1];', [
    selector,
    text,
  ]);
}

async function setViewport() {
  let rect = { x: 0, y: 0, width: 1440, height: 900 };
  for (let attempt = 0; attempt < 4; attempt++) {
    await wd(`/session/${sessionId}/window/rect`, 'POST', rect);
    const actual = await js(
      'return {width:innerWidth,height:innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio};',
    );
    if (actual.width === 1440 && actual.height === 900) {
      assert.equal(actual.dpr, 1, 'Frozen 100% display scale is required.');
      return actual;
    }
    rect = {
      x: 0,
      y: 0,
      width: actual.outerWidth + 1440 - actual.width,
      height: actual.outerHeight + 900 - actual.height,
    };
  }
  throw new Error('Native Firefox window could not provide an exact 1440×900 CSS viewport.');
}

async function endSession() {
  bidi?.close();
  bidi = undefined;
  if (sessionId) {
    await wd(`/session/${sessionId}`, 'DELETE');
    sessionId = undefined;
  }
}

function saveReport() {
  writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

try {
  // No existing browser/server/driver is reused or stopped.
  for (const port of [4190, 4191, driverPort]) await ensureFree(port);
  server = await startPerformanceServer({
    logPrefix: `.artifacts/11.4/firefox-performance-${label}/network`,
  });
  assert.equal(server.origin, report.origin);
  report.network = server.metadata;
  driver = ownedDriver();
  await driverReady();
  const profilePaths = new Set();
  for (const key of cases) {
    const sample = performanceCases.find((entry) => entry.key === key);
    assert.ok(sample, `Missing registered public workload: ${key}`);
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
            },
          },
        },
      },
    });
    sessionId = session.sessionId;
    const capabilities = session.capabilities;
    const entry = { key, capabilities, runs: [] };
    report.cases.push(entry);
    assert.match(capabilities.browserVersion, /^158\./);
    assert.equal(capabilities['moz:headless'], false);
    assert.equal(typeof capabilities.webSocketUrl, 'string');
    assert.equal(typeof capabilities['moz:profile'], 'string');
    assert.equal(profilePaths.has(capabilities['moz:profile']), false, 'Fresh profile required.');
    profilePaths.add(capabilities['moz:profile']);
    assert.equal((await wd(`/session/${sessionId}/window/handles`)).length, 1);
    entry.viewport = await setViewport();
    bidi = await connectBidi(capabilities.webSocketUrl);
    const preload = await bidi.command('script.addPreloadScript', {
      functionDeclaration: installPerformanceObserver.toString(),
    });
    assert.equal(typeof preload.script, 'string');
    entry.preloadRegisteredBeforeNavigation = true;
    await wd(`/session/${sessionId}/url`, 'POST', {
      url: `${report.origin}/#/visualize/${sample.caseId}`,
    });
    await until('return !!document.querySelector("[data-testid=input-panel]");');
    assert.equal(await js('return window.__performanceAudit?.version;'), 1);
    const focus = await js(
      'return {visible:document.visibilityState,focused:document.hasFocus(),viewport:[innerWidth,innerHeight]};',
    );
    entry.focus = focus;
    assert.equal(focus.visible, 'visible');
    assert.equal(focus.focused, true);
    assert.deepEqual(focus.viewport, [1440, 900]);
    for (const [name, value] of Object.entries(sample.values))
      await fill(
        `[data-testid="input-field-${name}"]`,
        Array.isArray(value) ? (value.length ? value.join(', ') : '[]') : String(value),
      );
    await clickText('应用输入并准备');
    await until(
      'return ["ready","failed"].includes(document.querySelector("[data-testid=case-execution]")?.dataset.state);',
    );
    entry.prepareAudit = await js(`return (${readPerformanceAudit.toString()})();`);
    entry.preparedState = await js(
      'return document.querySelector("[data-testid=case-execution]")?.dataset.state;',
    );
    if (entry.preparedState === 'ready') {
      for (let repeat = 0; repeat < 3; repeat++) {
        const intentCount = await js('return window.__performanceAudit.intents.length;');
        await clickText('运行示例');
        await until(
          'const a=window.__performanceAudit;const i=a.intents.at(-1);return a.intents.length===arguments[0]+1&&i?.label==="运行示例"&&i.end!==null;',
          [intentCount],
        );
        // Parse metadata only after the shared observer's end timestamp. The
        // shared collector releases its temporary response reference each read.
        const audit = await js(`return (${readPerformanceAudit.toString()})();`);
        const intent = audit.intents.at(-1);
        const worker = audit.workers.filter((record) => record.kind === 'execute').at(-1);
        const state = await js(
          'return document.querySelector("[data-testid=case-execution]")?.dataset.state;',
        );
        const stdout = await js(
          'return document.querySelector("[data-testid=execution-output]")?.textContent ?? null;',
        );
        const elapsedMs = intent.end - intent.at;
        const complete =
          state === 'completed' &&
          stdout === sample.stdout &&
          worker?.terminal === 'completed' &&
          worker?.completeness === 'complete' &&
          intent.trusted === true &&
          intent.playable === true;
        entry.runs.push({
          repeat: repeat + 1,
          moduleState: 'warm-after-real-prepare',
          elapsedMs,
          state,
          outputMatches: stdout === sample.stdout,
          complete,
          paintVisible: intent.paintVisible,
          executeWithinBudget: complete && intent.paintVisible === true && elapsedMs <= 500,
          safetyWithinBudget: elapsedMs <= 1000,
          audit,
        });
        saveReport();
        console.log(
          JSON.stringify({
            key,
            repeat: repeat + 1,
            state,
            elapsedMs,
            paintVisible: intent.paintVisible,
            complete,
            worker,
          }),
        );
      }
    }
    entry.finalState = await js(
      'return document.querySelector("[data-testid=case-execution]")?.dataset.state;',
    );
    writeFileSync(
      join(output, `${key}.png`),
      Buffer.from(await wd(`/session/${sessionId}/screenshot`), 'base64'),
    );
    await endSession();
    saveReport();
  }
  report.harnessPassed = true;
  report.functionalPilotPassed =
    report.cases.length === cases.length &&
    report.cases.every(
      (entry) => entry.runs.length === 3 && entry.runs.every((run) => run.complete),
    );
  report.executionPilotWithinBudget =
    report.functionalPilotPassed &&
    report.cases.every((entry) => entry.runs.every((run) => run.executeWithinBudget));
} catch (error) {
  failure = error;
  report.harnessPassed = false;
  report.error = { message: error.message, stack: error.stack };
  if (sessionId) {
    report.failurePage = await js(
      'return {url:location.href,text:document.body?.innerText};',
    ).catch(() => null);
    await wd(`/session/${sessionId}/screenshot`)
      .then((image) => writeFileSync(join(output, 'failure.png'), Buffer.from(image, 'base64')))
      .catch(() => {});
  }
} finally {
  const sessionCleanup = await endSession().then(
    () => null,
    (error) => error,
  );
  const cleanup = await Promise.allSettled([stopOwned(driver), server?.stop()]);
  const errors = [
    sessionCleanup,
    ...cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason),
  ].filter(Boolean);
  if (errors.length) {
    failure ??= errors[0];
    report.harnessPassed = false;
    report.cleanupErrors = errors.map(String);
  }
  report.ownedServicesStopped = errors.length === 0;
  report.finishedAt = new Date().toISOString();
  report.nativeScrolls = nativeScrolls;
  saveReport();
  writeFileSync(join(output, 'geckodriver.log'), serviceLog);
}
if (failure) throw failure;
