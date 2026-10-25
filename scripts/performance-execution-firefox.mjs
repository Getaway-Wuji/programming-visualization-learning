/* global document, navigator, innerWidth, innerHeight, devicePixelRatio, visualViewport */
// Stock Firefox 158 production inputs, native UI only. Metadata is read after timing.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkEnvironment } from './environment.mjs';
import { installPerformanceObserver, readPerformanceAudit } from './performance-observer.mjs';
import { performanceCases, performanceExercises } from './performance-workloads.mjs';
import { workspaceDir } from './process.mjs';
import { capturePerformanceHost, qualifyPerformanceHost } from './performance-host.mjs';
import { startPerformanceServer } from './serve-performance.mjs';

const toolEnvironment = checkEnvironment({ bindgen: true });
const label = process.env.PERF_LABEL ?? 'execution-firefox';
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
assert.equal(practice.exercises.length, 6);
assert.deepEqual(
  practice.exercises.map((entry) => entry.tests.length),
  [3, 3, 3, 4, 5, 6],
);
const caseView = JSON.parse(readFileSync(join(workspaceDir, 'content/c/p0/case-view-1.0.0.json')));
const output = join(workspaceDir, '.artifacts/11.4', label);
assert.ok(!existsSync(output), 'Use a new PERF_LABEL; earlier evidence is immutable');
mkdirSync(output);
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
const driverPort = Number(process.env.PERF_DRIVER_PORT ?? 4454);
assert.ok(
  Number.isSafeInteger(driverPort) &&
    driverPort >= 1024 &&
    driverPort <= 65535 &&
    ![4192, 4193].includes(driverPort),
);
const driverOrigin = `http://127.0.0.1:${driverPort}`;
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const blockList = '[aria-label="积木工作区"] select[aria-label="积木列表"]';
assert.ok(existsSync(binary) && existsSync(executable));
const writeNew = (name, value) =>
  writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let driver;
let server;
let sessionId;
let bidi;
let failure;
let serviceLog = '';
const nativeScrolls = [];
const profilePaths = new Set();
const report = {
  task: '11.4',
  baseline: 'PERF-BASE-01 V1.0 / BUDGET-P0 V1.0',
  kind: 'production UI complete execution and real-session review',
  browser: 'stock-Firefox',
  startedAt: new Date().toISOString(),
  headful: true,
  viewport: [1440, 900],
  driverPort,
  repeatsPerModuleState: repeats,
  selectedKeys: selected.map((entry) => entry.key),
  debugRun: !!selectedKeys || repeats !== 10,
  expectedFormalWorkloads: 61,
  expectedFormalExecutionsPerBrowser: 1220,
  expectedFormalReviewsPerBrowser: 30,
  thresholds: { executionMs: 500, reviewMs: 2000, originalSafetyMs: 1000 },
  toolEnvironment,
  suppliedHostConditions: JSON.parse(
    readFileSync(
      join(workspaceDir, process.env.PERF_HOST_REPORT ?? '.artifacts/11.4/conditions-host.json'),
    ),
  ),
  cacheBoundary:
    'Each cohort starts a new WebDriver session and distinct temporary Firefox profile with no prior page/cache. Published declaration preparation must leave zero execution compilation and zero Workers before the cold native run. The following warm run reuses exactly one readonly compiled Module with new Workers. Module warmth is independent of HTTP cache warmth: resource transferSize/encodedBodySize and server request logs are recorded; acceptInsecureCerts is not proof of a working warm HTTP cache.',
  measurement:
    'Trusted native click captured by the shared preload observer through complete product validation and initial playable projection after two rAF callbacks. Stable native scroll/click positioning precedes the intent; audit parsing, source/output checks, hashes and screenshots follow its endpoint. Private Rust phases overlap and cannot be summed. Original 500ms target and 1000ms safety deadline are unchanged.',
  groupEvidence:
    'All expected case keys must appear as passed in the actual product Rust-judging summary and each group must create and terminate a distinct execute Worker. Only the retained final group response buffer is independently decoded by the shared observer after timing. Its visible source declarations and exact actual stdout are compared to the frozen final group. No claim is made to retain every earlier group raw trace/stdout.',
  certificateAcceptance: {
    acceptInsecureCerts: true,
    installedSystemTrust: false,
    boundary:
      'Task-local isolated HTTPS lab only. This is not public certificate trust or warm HTTP-cache acceptance.',
  },
  preload: {
    method: 'script.addPreloadScript',
    requestedCapability: 'webSocketUrl',
    sourceSha256: sha(installPerformanceObserver.toString()),
  },
  hashes: Object.fromEntries(
    [
      'package-lock.json',
      'Cargo.lock',
      'scripts/performance-execution-firefox.mjs',
      'scripts/performance-observer.mjs',
      'scripts/performance-workloads.mjs',
      'scripts/firefox-profile.mjs',
      'web/src/generated/c_viz_wasm_bg.wasm',
    ].map((path) => [path, sha(readFileSync(join(workspaceDir, path)))]),
  ),
  cohorts: [],
  samples: [],
  reviews: [],
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
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) return;
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

async function clickText(text, tag = 'button') {
  assert.ok(['button', 'a'].includes(tag) && !text.includes("'"));
  const found = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'xpath',
    value: `//${tag}[normalize-space(.)='${text}']`,
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

async function blockOptions(pattern) {
  const options = await until(
    'const list=document.querySelector(arguments[0]);return list && list.options.length > 1 && [...list.options].map(option=>({value:option.value,text:option.textContent}));',
    [blockList],
  );
  return options.filter((option) => option.value && pattern.test(option.text));
}
async function selectBlock(value) {
  // Starter IDs themselves are safe CSS values; options are discovered from public labels.
  assert.match(value, /^[A-Za-z0-9._:-]+$/);
  await selectOption(blockList, value);
}
async function correctStarter(id) {
  const editor = '[aria-label="积木工作区"]';
  if (id === 'exercise.c.echo') {
    const options = await blockOptions(/^\d+\. 输出 ·/);
    assert.equal(options.length, 1);
    await selectBlock(options[0].value);
    const selector = `${editor} textarea[aria-label="输出格式"]`;
    assert.equal(await js('return document.querySelector(arguments[0]).value;', [selector]), '%d');
    // Append the missing escape using real keys. Clearing %d first would remove
    // its argument slot and disconnect the variable, a different logical edit.
    await wd(`/session/${sessionId}/element/${await element(selector)}/value`, 'POST', {
      text: '\uE010\\n',
    });
    await until('return document.querySelector(arguments[0])?.value === arguments[1];', [
      selector,
      '%d\\n',
    ]);
  } else if (id === 'exercise.c.nonnegative' || id === 'exercise.c.two-loop-sums') {
    const options = await blockOptions(/^\d+\. 比较 ·/);
    assert.equal(options.length, id === 'exercise.c.nonnegative' ? 1 : 2);
    for (const option of options) {
      await selectBlock(option.value);
      await selectOption(
        `${editor} select[aria-label="运算符"]`,
        id === 'exercise.c.nonnegative' ? '>=' : '<=',
      );
    }
  } else {
    const initial = id === 'exercise.c.increment-at-index' ? '0' : '1';
    const replacement =
      id === 'exercise.c.two-x-plus-three'
        ? '2'
        : id === 'exercise.c.increment-at-index'
          ? '1'
          : '0';
    assert.ok(
      [
        'exercise.c.two-x-plus-three',
        'exercise.c.increment-at-index',
        'exercise.c.array-sum',
      ].includes(id),
    );
    const options = await blockOptions(new RegExp(`^\\d+\\. 整数 · ${initial}$`));
    assert.ok(options.length > 0);
    // For array-sum the first 1 is the sum initializer, before the loop update.
    await selectBlock(options[0].value);
    await fill(`${editor} input[aria-label="整数值"]`, replacement);
  }
  await until(
    'return document.querySelector("[data-testid=practice-execution]")?.dataset.state === "ready" && !document.querySelector("[data-testid=practice-stdout]");',
  );
}
async function element(selector) {
  return (
    await wd(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  )[elementKey];
}
async function selectOption(selector, value) {
  const matches = await js(
    'return [...document.querySelector(arguments[0]).options].filter(option=>option.value===arguments[1]).length;',
    [selector, value],
  );
  assert.equal(matches, 1, `Expected one native option ${selector}/${value}`);
  assert.ok(!value.includes('"'));
  await wd(
    `/session/${sessionId}/element/${await element(`${selector} option[value="${value}"]`)}/click`,
    'POST',
    {},
  );
  await until('return document.querySelector(arguments[0])?.value === arguments[1];', [
    selector,
    value,
  ]);
}
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
    zoom: visualViewport?.scale ?? null,
    visibility: document.visibilityState,
    focus: document.hasFocus(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
  };
}
const readAudit = () => js(`return (${readPerformanceAudit.toString()})();`);
const readEnvironment = () => js(`return (${environment.toString()})();`);
const panelSelector = (definition) =>
  `[data-testid="${definition.kind === 'case' ? 'case-execution' : 'practice-execution'}"]`;
async function readPresentation(definition) {
  return js(
    String.raw`
const panel=document.querySelector(arguments[0]);
const code=panel?.querySelector('[data-testid="code-panel"] textarea');
const controls=panel?.querySelector('[data-testid="player-controls"]');
return {state:panel?.dataset.state??null,source:code?.value??null,readonly:!!code?.readOnly,
 stdout:panel?.querySelector('[data-testid="execution-output"], [data-testid="practice-stdout"]')?.textContent??null,
 feedback:panel?.querySelector('[data-testid="practice-feedback"]')?.textContent??null,
 summaries:[...panel?.querySelectorAll('[data-testid="practice-feedback"] li')??[]].map(item=>item.textContent.trim()),
 cursor:controls?.dataset.cursor??null,length:controls?.dataset.length??null,
 location:location.hash};`,
    [panelSelector(definition)],
  );
}
function expectedExercise(definition) {
  return practice.exercises.find((entry) => entry.id === definition.exerciseId);
}
function sourceChecks(definition, presentation) {
  const subject =
    definition.kind === 'case'
      ? caseView.catalogs.find((entry) => entry.subject.id === definition.caseId)
      : null;
  const exercise = definition.kind === 'exercise' ? expectedExercise(definition) : null;
  const program =
    subject?.program ?? practice.programs.find((entry) => entry.id === exercise?.programRef.id);
  const input = definition.kind === 'case' ? definition.values : exercise.tests.at(-1).input;
  const declarations = program.bindings.map((binding) => {
    const value = input[binding.inputKey];
    let text = null;
    if (binding.targetKind === 'scalar' && typeof value === 'number')
      text = `int ${binding.targetName} = ${value};`;
    if (binding.targetKind === 'logical-length' && Array.isArray(value))
      text = `int ${binding.targetName} = ${value.length};`;
    if (binding.targetKind === 'array' && Array.isArray(value))
      text = `int ${binding.targetName}[${Math.max(1, value.length)}] = {${value.length ? value.join(', ') : '0'}};`;
    return {
      bindingKey: binding.bindingKey,
      matches:
        typeof text === 'string' &&
        typeof presentation.source === 'string' &&
        presentation.source.includes(text),
    };
  });
  return {
    readonly: presentation.readonly,
    declarations,
    all:
      declarations.length === program.bindings.length &&
      declarations.every((entry) => entry.matches) &&
      presentation.readonly,
  };
}
function groupChecks(definition, presentation) {
  if (definition.kind === 'case') return [];
  return expectedExercise(definition).tests.map((test) => ({
    caseKey: test.caseKey,
    passedSummary: presentation.summaries.some((text) =>
      text.startsWith(`${test.caseKey}：本组通过`),
    ),
  }));
}
async function screenshot(name) {
  const image = await wd(`/session/${sessionId}/screenshot`);
  writeFileSync(join(output, name), Buffer.from(image, 'base64'), { flag: 'wx' });
}
async function readRunReadiness(definition) {
  return js(
    String.raw`
const panel=document.querySelector(arguments[0]);
const code=panel?.querySelector('[data-testid="code-panel"] textarea');
const button=[...panel?.querySelectorAll('button')??[]].find(item=>item.textContent.trim()===arguments[1]);
return {state:panel?.dataset.state??null,sourcePresent:!!code?.value,readonly:!!code?.readOnly,
 runPresent:!!button,runEnabled:!!button&&!button.disabled};`,
    [panelSelector(definition), definition.kind === 'case' ? '运行示例' : '提交练习'],
  );
}
async function prepareWarm(definition, cohort, cold) {
  const before = await readRunReadiness(definition);
  const beforeAudit = await readAudit();
  const recovery = (cohort.warmPreparation = {
    coldSampleId: cold.id,
    coldPassed: cold.passed,
    coldFailurePreserved: report.samples.includes(cold),
    before,
    needed: !before.sourcePresent || !before.runEnabled,
    action: null,
    readyToRun: false,
    beforeCompilations: beforeAudit.compilations.length,
    beforeWorkers: beforeAudit.workers.length,
  });
  if (recovery.needed) {
    // Only restore the source through the existing native product command.
    // The failed cold sample stays in the report and no execution is retried.
    await until(
      'const p=document.querySelector(arguments[0]);return !!p&&!["running","preparing","loading"].includes(p.dataset.state);',
      [panelSelector(definition)],
    );
    recovery.action = definition.kind === 'case' ? '准备运行样例' : '准备代码';
    await clickText(recovery.action);
    await until(
      'const p=document.querySelector(arguments[0]);return p?.dataset.state==="ready"&&!!p.querySelector("[data-testid=code-panel] textarea")?.value&&[...p.querySelectorAll("button")].some(b=>b.textContent.trim()===arguments[1]&&!b.disabled);',
      [panelSelector(definition), definition.kind === 'case' ? '运行示例' : '提交练习'],
    );
  }
  recovery.after = await readRunReadiness(definition);
  const afterAudit = await readAudit();
  recovery.afterCompilations = afterAudit.compilations.length;
  recovery.afterWorkers = afterAudit.workers.length;
  recovery.noAdditionalCompilation = recovery.beforeCompilations === recovery.afterCompilations;
  recovery.noAdditionalWorker = recovery.beforeWorkers === recovery.afterWorkers;
  recovery.readyToRun =
    recovery.after.sourcePresent &&
    recovery.after.readonly &&
    recovery.after.runEnabled &&
    (!recovery.needed || recovery.after.state === 'ready');
}
async function measure(definition, mode, repeat, cohort) {
  const before = await readAudit();
  const beforeEnvironment = await readEnvironment();
  const intentLabel = definition.kind === 'case' ? '运行示例' : '提交练习';
  const priorIntentCount = before.intents.length;
  let clickFailure = null;
  try {
    await clickText(intentLabel);
    await until(
      'const audit=window.__performanceAudit;const intent=audit?.intents[arguments[0]];return audit?.intents.length===arguments[0]+1&&intent?.label===arguments[1]&&intent.end!==null;',
      [priorIntentCount, intentLabel],
      100,
    );
  } catch (error) {
    clickFailure = { message: error.message };
  }
  const after = await readAudit();
  const afterEnvironment = await readEnvironment();
  const intent =
    after.intents.length === priorIntentCount + 1 &&
    after.intents[priorIntentCount]?.label === intentLabel
      ? after.intents[priorIntentCount]
      : null;
  const workers = after.workers.slice(before.workers.length);
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
  const presentation = await readPresentation(definition);
  const source = sourceChecks(definition, presentation);
  const groups = groupChecks(definition, presentation);
  const exercise = definition.kind === 'exercise' ? expectedExercise(definition) : null;
  const expectedGroups = exercise?.tests.length ?? 1;
  const expectedOutput =
    definition.kind === 'case' ? definition.stdout : exercise.tests.at(-1).expectedStdout;
  const wholeMs = intent?.end == null ? null : intent.end - intent.at;
  const controls = {
    trustedClick: intent?.label === intentLabel && intent.trusted === true,
    newIntent: intent !== null && after.intents.length === priorIntentCount + 1,
    preparationKeptEngineCold: mode !== 'cold' || cohort.noEngineBeforeCold === true,
    warmPreparation:
      mode !== 'warm' ||
      (cohort.warmPreparation?.readyToRun === true &&
        cohort.warmPreparation.coldFailurePreserved &&
        cohort.warmPreparation.noAdditionalCompilation &&
        cohort.warmPreparation.noAdditionalWorker),
    moduleStateConfirmed:
      mode === 'cold'
        ? before.compilations.length === 0 &&
          before.workers.length === 0 &&
          after.compilations.length === 1 &&
          after.compilations[0].start >= intent?.at &&
          after.compilations[0].succeeded === true
        : before.compilations.length === 1 && after.compilations.length === 1,
    freshWorkers:
      workers.length === expectedGroups &&
      workers.every((entry) => entry.kind === 'execute') &&
      new Set(workers.map((entry) => entry.operationId)).size === expectedGroups,
    sharedReadonlyModule: workers.length > 0 && workers.every((entry) => entry.moduleId === 1),
    maximumOneWorker: maximumActiveWorkers === 1,
    workersTerminated: workers.length > 0 && workers.every((entry) => entry.terminatedAt !== null),
    noOlderLiveWorker: after.workers.every((entry) => entry.terminatedAt !== null),
    foreground:
      beforeEnvironment.focus &&
      afterEnvironment.focus &&
      beforeEnvironment.visibility === 'visible' &&
      afterEnvironment.visibility === 'visible',
    correctViewport:
      beforeEnvironment.viewport[0] === 1440 &&
      beforeEnvironment.viewport[1] === 900 &&
      beforeEnvironment.devicePixelRatio === 1 &&
      beforeEnvironment.zoom === 1 &&
      afterEnvironment.viewport[0] === 1440 &&
      afterEnvironment.viewport[1] === 900,
    completeRustTrace:
      last?.terminal === 'completed' && last.completeness === 'complete' && last.steps > 0,
    playableInitialProjection:
      intent?.playable === true &&
      intent.paintVisible === true &&
      intent.cursor !== null &&
      intent.cursor !== undefined &&
      intent.cursor !== '' &&
      Number(intent.cursor) === 0 &&
      Number(intent.length) > 0 &&
      presentation.cursor === '0' &&
      Number(presentation.length) > 0,
    resultCorrect:
      presentation.state === (definition.kind === 'case' ? 'completed' : 'passed') &&
      presentation.stdout === expectedOutput &&
      groups.every((entry) => entry.passedSummary),
    sourceCorrect: source.all,
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
    failure: clickFailure,
    wholeMs,
    state: presentation.state,
    expectedGroups,
    maximumActiveWorkers,
    sourceSha256: typeof presentation.source === 'string' ? sha(presentation.source) : null,
    stdoutMatches: presentation.stdout === expectedOutput,
    sourceChecks: source,
    groupChecks: groups,
    environment: beforeEnvironment,
    afterEnvironment,
    controls,
    passed:
      !clickFailure && Object.values(controls).every(Boolean) && wholeMs !== null && wholeMs <= 500,
    intent,
    intentIndex: priorIntentCount,
    compilations: after.compilations,
    workers,
    resources: after.resources,
    navigation: after.navigation,
    longTasks: after.longTasks,
    totalWorkers: after.workers.length,
  };
  writeNew(`${sample.id}.json`, sample);
  report.samples.push(sample);
  console.log(
    JSON.stringify({
      id: sample.id,
      wholeMs,
      state: sample.state,
      controls,
      passed: sample.passed,
    }),
  );
  if (repeat === 1) await screenshot(`${sample.id}.png`);
  return sample;
}
async function review(definition, repeat, warm) {
  const before = await readAudit();
  const retained = await readPresentation(definition);
  const beforeEnvironment = await readEnvironment();
  const priorIntentCount = before.intents.length;
  let clickFailure = null;
  try {
    await clickText('查看本次复盘', 'a');
    await until(
      'const a=window.__performanceAudit;const i=a?.intents[arguments[0]];return a?.intents.length===arguments[0]+1&&i?.label==="查看本次复盘"&&i.end!==null;',
      [priorIntentCount],
      100,
    );
  } catch (error) {
    clickFailure = { message: error.message };
  }
  const after = await readAudit();
  const presentation = await readPresentation(definition);
  const afterEnvironment = await readEnvironment();
  const intent =
    after.intents.length === priorIntentCount + 1 &&
    after.intents[priorIntentCount]?.label === '查看本次复盘'
      ? after.intents[priorIntentCount]
      : null;
  const wholeMs = intent?.end == null ? null : intent.end - intent.at;
  const controls = {
    trustedClick: intent?.label === '查看本次复盘' && intent.trusted === true,
    newIntent: intent !== null && after.intents.length === priorIntentCount + 1,
    realSession:
      warm.controls.completeRustTrace &&
      warm.controls.resultCorrect &&
      warm.controls.sourceCorrect &&
      warm.controls.privateTimings &&
      warm.controls.freshWorkers &&
      warm.controls.workersTerminated,
    noRerun:
      after.workers.length === before.workers.length &&
      after.compilations.length === before.compilations.length,
    exactRetainedSource: presentation.source === retained.source,
    exactRetainedOutput: presentation.stdout === retained.stdout,
    retainedCursor:
      retained.cursor !== null &&
      retained.cursor !== '' &&
      presentation.cursor === retained.cursor &&
      String(intent?.cursor) === retained.cursor &&
      Number(retained.length) > 0 &&
      presentation.length === retained.length &&
      Number(intent?.length) === Number(retained.length),
    retainedRunIdentity:
      typeof warm.workers.at(-1)?.identity?.runId === 'string' &&
      before.workers.at(-1)?.identity?.runId === warm.workers.at(-1).identity.runId &&
      after.workers.at(-1)?.identity?.runId === warm.workers.at(-1).identity.runId,
    reviewRoute:
      presentation.location === `#/practice/${encodeURIComponent(definition.exerciseId)}/review`,
    playable: intent?.playable === true && intent.paintVisible === true,
    foreground:
      beforeEnvironment.focus &&
      beforeEnvironment.visibility === 'visible' &&
      afterEnvironment.focus &&
      afterEnvironment.visibility === 'visible',
  };
  const result = {
    id: `${definition.key}-review-${repeat}`,
    key: definition.key,
    repeat,
    wholeMs,
    failure: clickFailure,
    intent,
    intentIndex: priorIntentCount,
    environment: beforeEnvironment,
    afterEnvironment,
    workersBefore: before.workers.length,
    workersAfter: after.workers.length,
    sourceSha256: sha(presentation.source ?? ''),
    controls,
    passed:
      !clickFailure &&
      Object.values(controls).every(Boolean) &&
      wholeMs !== null &&
      wholeMs <= 2000,
  };
  report.reviews.push(result);
  writeNew(`${result.id}.json`, result);
  return result;
}
async function newSession(cohort) {
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
  const capabilities = session.capabilities;
  cohort.capabilities = capabilities;
  assert.match(capabilities.browserVersion, /^158\./);
  assert.equal(capabilities['moz:headless'], false);
  assert.equal(typeof capabilities.webSocketUrl, 'string');
  assert.equal(typeof capabilities['moz:profile'], 'string');
  assert.equal(
    profilePaths.has(capabilities['moz:profile']),
    false,
    'A fresh browser profile is required for each cold Module sample',
  );
  profilePaths.add(capabilities['moz:profile']);
  assert.equal((await wd(`/session/${sessionId}/window/handles`)).length, 1);
  cohort.viewport = await setViewport();
  bidi = await connectBidi(capabilities.webSocketUrl);
  const preload = await bidi.command('script.addPreloadScript', {
    functionDeclaration: installPerformanceObserver.toString(),
  });
  assert.equal(typeof preload.script, 'string');
  cohort.preloadRegisteredBeforeNavigation = true;
  report.browserVersion ??= capabilities.browserVersion;
  assert.equal(
    capabilities.browserVersion,
    report.browserVersion,
    'The browser version cannot change within a measured matrix',
  );
}
async function prepareCohort(definition, cohort) {
  const route =
    definition.kind === 'case'
      ? `/visualize/${definition.caseId}`
      : `/practice/${definition.exerciseId}`;
  await wd(`/session/${sessionId}/url`, 'POST', { url: `${server.origin}/#${route}` });
  await until(
    'const panel=document.querySelector(arguments[0]);return panel?.dataset.state==="ready"&&!!panel.querySelector("[data-testid=code-panel] textarea")?.value;',
    [panelSelector(definition)],
  );
  assert.equal(await js('return window.__performanceAudit?.version;'), 1);
  cohort.initialEnvironment = await readEnvironment();
  cohort.initialAudit = await readAudit();
  if (definition.kind === 'case') {
    for (const [key, value] of Object.entries(definition.values))
      await fill(
        `[data-testid="input-field-${key}"]`,
        Array.isArray(value) ? (value.length ? value.join(', ') : '[]') : String(value),
      );
    await clickText('应用输入并准备');
  } else {
    await until('return !!document.querySelector("[aria-label=积木工作区] .blocklySvg");');
    await correctStarter(definition.exerciseId);
  }
  await until(
    'const p=document.querySelector(arguments[0]);return p?.dataset.state==="ready"&&!!p.querySelector("[data-testid=code-panel] textarea")?.value&&[...p.querySelectorAll("button")].some(b=>b.textContent.trim()===arguments[1]&&!b.disabled);',
    [panelSelector(definition), definition.kind === 'case' ? '运行示例' : '提交练习'],
  );
  cohort.preparedAudit = await readAudit();
  cohort.noEngineBeforeCold =
    cohort.initialAudit.compilations.length === 0 &&
    cohort.initialAudit.workers.length === 0 &&
    cohort.preparedAudit.compilations.length === 0 &&
    cohort.preparedAudit.workers.length === 0;
  // A false control is retained as a measurement failure; it is not repaired by
  // relaunching/retrying this cohort or resetting instrumentation.
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
  for (const definition of selected) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const cohort = {
        id: `${definition.key}-cohort-${repeat}`,
        key: definition.key,
        kind: definition.kind,
        repeat,
      };
      report.cohorts.push(cohort);
      try {
        await newSession(cohort);
        await prepareCohort(definition, cohort);
        const cold = await measure(definition, 'cold', repeat, cohort);
        await prepareWarm(definition, cohort, cold);
        const warm = await measure(definition, 'warm', repeat, cohort);
        cohort.samples = [cold.id, warm.id];
        if (definition.kind === 'exercise' && repeat <= 5 && warm.state === 'passed')
          cohort.review = (await review(definition, repeat, warm)).id;
      } catch (error) {
        cohort.failure = { message: error.message, stack: error.stack };
        report.harnessFailures ??= [];
        report.harnessFailures.push({ cohortId: cohort.id, ...cohort.failure });
        if (sessionId) {
          cohort.failurePage = await js(
            'return {url:location.href,text:document.body?.innerText};',
          ).catch(() => null);
          await screenshot(`${cohort.id}-failure.png`).catch(() => {});
        }
        console.log(JSON.stringify({ cohortId: cohort.id, failure: cohort.failure }));
      } finally {
        await endSession();
        cohort.sessionClosed = true;
        writeNew(`${cohort.id}.json`, cohort);
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
  const errors = [
    sessionCleanup,
    ...cleanup.filter((result) => result.status === 'rejected').map((result) => result.reason),
  ].filter(Boolean);
  if (errors.length) {
    failure ??= errors[0];
    report.cleanupErrors = errors.map(String);
  }
  report.ownedServicesStopped = errors.length === 0;
  try {
    report.hostConditionsEnd = capturePerformanceHost(output, 'end');
  } catch (error) {
    report.hostCaptureFailure = { message: error.message };
  }
  report.endedAt = new Date().toISOString();
  report.nativeScrolls = nativeScrolls;
  report.reviewsComplete = report.reviews.length === 30;
  report.complete =
    !report.debugRun &&
    selected.length === 61 &&
    repeats === 10 &&
    report.cohorts.length === 610 &&
    report.samples.length === 1220 &&
    report.reviewsComplete &&
    !report.harnessFailures?.length &&
    !report.failure;
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
  report.reviewSummary = performanceExercises.map((key) => {
    const reviews = report.reviews.filter((entry) => entry.key === key);
    return {
      key,
      timingsMs: stats(reviews.map((entry) => entry.wholeMs)),
      failed: reviews.filter((entry) => !entry.passed).length,
    };
  });
  report.hostBaseline = qualifyPerformanceHost(report.hostConditions, report.hostConditionsEnd);
  report.allSamplesPass =
    report.hostBaseline.satisfied &&
    report.complete &&
    report.ownedServicesStopped &&
    report.samples.every((entry) => entry.passed) &&
    report.reviews.every((entry) => entry.passed);
  writeNew('report.json', report);
  writeFileSync(join(output, 'geckodriver.log'), serviceLog, { flag: 'wx' });
  if (!report.allSamplesPass) process.exitCode = 1;
}
if (failure) throw failure;
