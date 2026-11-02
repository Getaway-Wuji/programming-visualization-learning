// Exercise the same build harness in stock Firefox, through Mozilla WebDriver.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer as createPortServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceDir } from './process.mjs';
import { checkEnvironment } from './environment.mjs';
import { engineBuild } from '../web/src/generated/engine-build.ts';

checkEnvironment({ bindgen: true });
const evidenceTask = process.env.TASK_EVIDENCE_TASK ?? 'current';
assert.match(evidenceTask, /^(?:[0-9]{2}\.[0-9]+|current)$/);
const evidenceLabel = process.env.TASK_EVIDENCE_LABEL;
if (evidenceLabel) assert.match(evidenceLabel, /^[a-z0-9-]+$/);
const output = join(
  workspaceDir,
  '.artifacts',
  evidenceTask,
  ...(evidenceLabel ? [evidenceLabel] : []),
);
if (evidenceLabel)
  assert.ok(!existsSync(output), 'Use a new evidence label; archived QA is immutable');
mkdirSync(output, { recursive: true });
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
if (!existsSync(executable) || !existsSync(binary))
  throw new Error('Prepare local Firefox/geckodriver using README.');
// A successful response from an old service must not be mistaken for this
// invocation's freshly built server or driver.
for (const port of [4178, 4447]) {
  await new Promise((resolve, reject) => {
    const socket = createPortServer();
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
}
const server = spawn(process.execPath, ['scripts/serve-checks.mjs'], {
  cwd: workspaceDir,
  stdio: 'pipe',
  windowsHide: true,
});
const driver = spawn(executable, ['--host', '127.0.0.1', '--port', '4447', '--log', 'warn'], {
  cwd: workspaceDir,
  stdio: 'pipe',
  windowsHide: true,
});
let childErrors = '';
for (const child of [server, driver]) {
  child.on('error', (error) => {
    childErrors += error.message;
  });
  child.stderr.on('data', (data) => {
    childErrors += data.toString();
  });
}
async function waitFor(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Owned QA service exited: ${childErrors}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* startup */
    }
    await delay(100);
  }
  throw new Error(`Local QA service did not start: ${childErrors}`);
}
async function webdriver(path, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:4447${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok || data.value?.error)
    throw new Error(`WebDriver ${path}: ${JSON.stringify(data.value)}`);
  return data.value;
}

async function execute(route, script, args = []) {
  return webdriver(`${route}/execute/sync`, 'POST', { script, args });
}

async function waitForUi(route, selector, expectedHeading = null) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const present = await execute(
      route,
      'const element = document.querySelector(arguments[0]); return !!element && (arguments[1] === null || element.querySelector("h1")?.textContent === arguments[1]);',
      [selector, expectedHeading],
    );
    if (present) return;
    await delay(50);
  }
  throw new Error(`Firefox UI did not become ready: ${selector}`);
}

async function click(route, selector) {
  const element = await webdriver(`${route}/element`, 'POST', {
    using: 'css selector',
    value: selector,
  });
  const elementId = element['element-6066-11e4-a52e-4f735466cecf'];
  await webdriver(`${route}/element/${elementId}/click`, 'POST', {});
}

async function pressKey(route, value) {
  await webdriver(`${route}/actions`, 'POST', {
    actions: [
      {
        type: 'key',
        id: 'navigation-keyboard',
        actions: [
          { type: 'keyDown', value },
          { type: 'keyUp', value },
        ],
      },
    ],
  });
}

async function screenshotTo(route, name) {
  const screenshot = await webdriver(`${route}/screenshot`);
  writeFileSync(join(output, name), Buffer.from(screenshot, 'base64'));
}

async function publicPageSnapshot(route) {
  return execute(
    route,
    String.raw`return {
      hash: location.hash,
      pageId: document.querySelector('main [data-page-id]')?.dataset.pageId,
      heading: document.querySelector('main h1')?.textContent,
      activeNavigation: [...document.querySelectorAll('nav[aria-label="主导航"] a[aria-current="page"]')].map(link => link.textContent),
      breadcrumbLinks: [...document.querySelectorAll('nav[aria-label="当前位置"] a')].map(link => ({text:link.textContent,href:link.getAttribute('href')})),
      emptyStates: [...document.querySelectorAll('main .state-empty .state-title')].map(title => title.textContent),
      sourceAreas: [...document.querySelectorAll('main [data-testid="code-panel"] textarea')].map(area => ({readOnly:area.readOnly,empty:area.value === '',complete:area.value.includes('int main(void)')})),
      playerLengths: [...document.querySelectorAll('[data-testid="player-controls"]')].map(player=>player.dataset.length),
      outputResults: document.querySelectorAll('[data-testid="execution-output"],[data-testid="practice-stdout"],[data-testid="step-output"]').length,
      workspaceReady: document.querySelector('[data-testid="practice-execution"],[data-testid="case-execution"]')?.dataset.state ?? null,
      runAvailable: [...document.querySelectorAll('main button')].some(button=>['运行示例','提交练习'].includes(button.textContent.trim())&&!button.disabled),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      forbiddenLinks: [...document.querySelectorAll('a')].filter(link => /登录|注册|排行榜/.test(link.textContent)).length,
      engineRequests: performance.getEntriesByType('resource').filter(entry => /\.wasm(?:\?|$)/.test(entry.name)).length
    };`,
  );
}
async function waitForWorkspace(route, kind) {
  await waitForUi(route, `[data-testid="${kind}-execution"][data-state="ready"]`);
  await waitForUi(route, '[data-testid="code-panel"] textarea[readonly]');
  if (kind === 'practice') await waitForUi(route, '[aria-label="积木工作区"] .blocklySvg');
}
function assertNoRun(snapshot, prepared = false) {
  assert.equal(snapshot.outputResults, 0);
  assert.ok(snapshot.playerLengths.every((length) => length === '0'));
  assert.ok(snapshot.sourceAreas.every((area) => area.readOnly && !area.empty && area.complete));
  if (prepared) {
    assert.equal(snapshot.workspaceReady, 'ready');
    assert.equal(snapshot.sourceAreas.length, 1);
    assert.deepEqual(snapshot.playerLengths, ['0']);
    assert.equal(snapshot.runAvailable, true);
  }
}

async function checkNavigation(route) {
  const pages = [];
  for (const [path, pageId, heading] of [
    ['/', 'PAGE-01', '让每一步，都看得明白。'],
    ['/#/courses', 'PAGE-02', '从基础开始，一步步学懂。'],
    ['/#/courses/chapter.c.values', 'PAGE-02', '变量与表达式'],
    ['/#/lessons/lesson.c.variables-output', 'PAGE-03', '变量和输出'],
    ['/#/practice/exercise.c.echo', 'PAGE-04', '输出输入变量'],
    ['/#/cases', 'PAGE-05', '让数据变化，有迹可循。'],
    ['/#/visualize/case.c.bubble-sort', 'PAGE-06', '冒泡排序'],
    ['/#/practice/exercise.c.echo/review', 'PAGE-06', '输出输入变量 · 本次复盘'],
    ['/#/settings?panel=data', 'PAGE-07', '本地设置'],
  ]) {
    await webdriver(`${route}/url`, 'POST', { url: `http://127.0.0.1:4178${path}` });
    await waitForUi(route, `[data-page-id="${pageId}"]`, heading);
    const prepared = pageId === 'PAGE-04' || path.includes('/visualize/');
    if (prepared) await waitForWorkspace(route, pageId === 'PAGE-04' ? 'practice' : 'case');
    const snapshot = await publicPageSnapshot(route);
    assert.equal(snapshot.pageId, pageId);
    assert.equal(snapshot.heading, heading);
    assert.equal(snapshot.forbiddenLinks, 0);
    assert.equal(snapshot.engineRequests, 0);
    assert.equal(snapshot.horizontalOverflow, false);
    assertNoRun(snapshot, prepared);
    if (path.endsWith('/review')) assert.deepEqual(snapshot.sourceAreas, []);
    pages.push({ path, ...snapshot });
    if (pageId === 'PAGE-04') await screenshotTo(route, 'firefox-navigation-practice.png');
    if (path.includes('/visualize/')) await screenshotTo(route, 'firefox-navigation-visualize.png');
  }

  const layouts = [];
  for (const [path, kind, left, right] of [
    [
      '/#/practice/exercise.c.echo',
      'practice',
      '[aria-label="积木工作区"]',
      '[data-testid="code-panel"]',
    ],
    [
      '/#/visualize/case.c.bubble-sort',
      'case',
      '[data-testid="code-panel"]',
      '[data-testid="animation-panel"]',
    ],
  ]) {
    await webdriver(`${route}/url`, 'POST', { url: `http://127.0.0.1:4178${path}` });
    await waitForWorkspace(route, kind);
    const layout = await execute(
      route,
      `
      const left = document.querySelector(arguments[0]).getBoundingClientRect();
      const right = document.querySelector(arguments[1]).getBoundingClientRect();
      const player = document.querySelector('[data-testid="player-controls"]');
      return {left:{x:left.x,width:left.width},right:{x:right.x,width:right.width},disabledButtons:[...player.querySelectorAll('button')].every(button=>button.disabled),disabledSpeed:player.querySelector('select').disabled};
    `,
      [left, right],
    );
    assert.ok(layout.left.x + layout.left.width <= layout.right.x + 1);
    assert.equal(layout.disabledButtons, true);
    assert.equal(layout.disabledSpeed, true);
    assertNoRun(await publicPageSnapshot(route), true);
    layouts.push({ path, ...layout });
  }

  await webdriver(`${route}/url`, 'POST', {
    url: 'http://127.0.0.1:4178/#/lessons/lesson.c.variables-output',
  });
  await waitForUi(route, '[data-page-id="PAGE-03"]');
  await click(route, 'main a[href="#/practice/exercise.c.echo"]');
  await waitForUi(route, '[data-page-id="PAGE-04"]');
  await webdriver(`${route}/refresh`, 'POST', {});
  await waitForUi(route, '[data-page-id="PAGE-04"]');
  await webdriver(`${route}/back`, 'POST', {});
  await waitForUi(route, '[data-page-id="PAGE-03"]');
  const restoredLesson = await publicPageSnapshot(route);
  assert.equal(restoredLesson.heading, '变量和输出');

  const dialogs = [];
  await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/' });
  await waitForUi(route, '[data-page-id="PAGE-01"]');
  for (const [panel, title] of [
    ['points', '积分明细'],
    ['goals', '每日目标'],
    ['history', '打卡历史'],
  ]) {
    const selector = `a[href="#/?panel=${panel}"]`;
    await click(route, selector);
    await waitForUi(route, 'dialog[open]');
    const dialogTitle = await execute(
      route,
      'return document.querySelector("dialog h2").textContent;',
    );
    assert.equal(dialogTitle, title);
    await pressKey(route, '\uE00C');
    const focusRestored = await execute(
      route,
      'return !document.querySelector("dialog[open]") && document.activeElement === document.querySelector(arguments[0]);',
      [selector],
    );
    assert.equal(focusRestored, true);
    dialogs.push({ panel, title, escapeClosed: true, focusRestored });
  }
  await execute(route, 'document.querySelector(".skip-link").focus();');
  await pressKey(route, '\uE007');
  assert.equal(await execute(route, 'return document.activeElement.id;'), 'main-content');
  assert.notEqual(await execute(route, 'return location.hash;'), '#main-content');

  await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/#/settings?panel=avatar' });
  await waitForUi(route, '[data-page-id="PAGE-07"]');
  await click(route, '#tab-avatar');
  await pressKey(route, '\uE014');
  assert.equal(await execute(route, 'return document.activeElement.id;'), 'tab-display');
  assert.equal(
    await execute(
      route,
      'return document.querySelector("#tab-display").getAttribute("aria-selected");',
    ),
    'true',
  );
  await click(route, '#tab-data');
  assert.equal(
    await execute(
      route,
      'return document.querySelector("#tab-data").getAttribute("aria-selected");',
    ),
    'true',
  );
  assert.equal(
    await execute(route, 'return document.querySelector("main button.button-secondary").disabled;'),
    false,
  );

  await webdriver(`${route}/url`, 'POST', {
    url: 'http://127.0.0.1:4178/#/visualize/missing.case',
  });
  await waitForUi(route, '.state-error[role="alert"]');
  await click(route, 'main .state-actions a');
  await waitForUi(route, '[data-page-id="PAGE-05"]');
  const recovered = await publicPageSnapshot(route);
  assert.equal(recovered.pageId, 'PAGE-05');
  return {
    pages,
    layouts,
    restoredLesson,
    dialogs,
    keyboardSkip: true,
    settingsKeyboardTabs: true,
    unknownCaseRecovery: true,
  };
}
async function checkAdapters(route) {
  const reports = [];
  for (const fault of ['none', 'missing', 'delayed-cancel', 'delayed-timeout']) {
    await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/' });
    await execute(
      route,
      String.raw`
      const audit = window.adapterAudit = {fetches:0, compiles:0, hashes:[], workers:[], writes:0, fault:arguments[0], arrived:false};
      const wasmBytes = arguments[1];
      const originalCompile = window.WebAssembly.compile.bind(window.WebAssembly);
      window.WebAssembly.compile = (...args) => { audit.compiles++; return originalCompile(...args); };
      const originalDigest = window.crypto.subtle.digest.bind(window.crypto.subtle);
      window.crypto.subtle.digest = async (algorithm,data) => {
        const result=await originalDigest(algorithm,data);
        if(data.byteLength===wasmBytes) audit.hashes.push([...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join(''));
        return result;
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        if (/\.wasm$/.test(String(args[0]))) {
          audit.fetches++;
          if (audit.fault === 'missing') return new Response('', {status:404});
          if (audit.fault.startsWith('delayed')) {
            audit.arrived = true;
            await new Promise(resolve => { audit.release = resolve; });
          }
        }
        return originalFetch(...args);
      };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.record = {terminated:false}; audit.workers.push(this.record);
          this.addEventListener('message', event => {
            // WebDriver-injected code and page messages have separate realms.
            if (typeof event.data.buffer?.byteLength === 'number') {
              this.record.build = JSON.parse(new TextDecoder().decode(event.data.buffer));
              this.record.instance = event.data.workerInstanceId;
            }
          });
        }
        postMessage(message,options=[]) { this.record.nonce=message.nonce; super.postMessage(message,options); }
        terminate() { this.record.terminated = true; super.terminate(); }
      };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(...args) { audit.writes++; return setItem.apply(this,args); };
      location.hash = '#/visualize/case.c.assignment';
    `,
      [fault, engineBuild.wasmBytes],
    );
    await waitForUi(route, '[data-testid="content-sample"][data-state="ready"]');
    const sample = await execute(
      route,
      'return document.querySelector("[data-testid=content-sample]").textContent;',
    );
    assert.match(sample, /已审核案例 · 独立观看/);
    await waitForWorkspace(route, 'case');
    assertNoRun(await publicPageSnapshot(route), true);
    assert.deepEqual(
      await execute(
        route,
        'return {fetches:adapterAudit.fetches,compiles:adapterAudit.compiles,workers:adapterAudit.workers.length,hashes:adapterAudit.hashes};',
      ),
      { fetches: 0, compiles: 0, workers: 0, hashes: [] },
    );
    await click(route, '[data-testid="engine-connection"] button');
    if (fault.startsWith('delayed')) {
      for (let i = 0; i < 100; i++) {
        if (await execute(route, 'return window.adapterAudit.arrived;')) break;
        await delay(10);
      }
      assert.equal(await execute(route, 'return window.adapterAudit.arrived;'), true);
      if (fault === 'delayed-cancel')
        await click(route, '[data-testid="engine-connection"] button:last-child');
    }
    const terminal =
      fault === 'none'
        ? 'ready'
        : fault === 'missing'
          ? 'failed'
          : fault === 'delayed-cancel'
            ? 'cancelled'
            : 'timed-out';
    await waitForUi(route, `[data-testid="engine-connection"][data-state="${terminal}"]`);
    const beforeRetry = await execute(
      route,
      'return {fetches:adapterAudit.fetches,compiles:adapterAudit.compiles,hashes:adapterAudit.hashes,workers:adapterAudit.workers,writes:adapterAudit.writes};',
    );
    await execute(route, 'adapterAudit.fault="none"; adapterAudit.release?.();');
    await click(route, '[data-testid="engine-connection"] button');
    await waitForUi(route, '[data-testid="engine-connection"][data-state="ready"]');
    const afterRetry = await execute(
      route,
      'return {fetches:adapterAudit.fetches,compiles:adapterAudit.compiles,hashes:adapterAudit.hashes,workers:adapterAudit.workers,writes:adapterAudit.writes,text:document.querySelector("[data-testid=engine-connection]").textContent,code:document.querySelector("[data-testid=code-panel] textarea").value};',
    );
    assert.match(afterRetry.text, /构建检查不执行 C/);
    assert.match(afterRetry.code, /int main\(void\)/);
    assertNoRun(await publicPageSnapshot(route), true);
    assert.equal(afterRetry.writes, 0);
    assert.equal(afterRetry.fetches, fault === 'none' ? 1 : 2);
    assert.equal(afterRetry.compiles, 1);
    assert.deepEqual(afterRetry.hashes, [engineBuild.wasmSha256]);
    assert.equal(afterRetry.workers.length, fault === 'none' ? 2 : 1);
    for (const worker of afterRetry.workers) {
      assert.equal(worker.terminated, true);
      assert.equal(worker.build.kind, 'build-probe');
      assert.equal(worker.build.interpreterReady, false);
      assert.equal(worker.build.nonce, worker.nonce);
    }
    if (fault === 'none')
      assert.notEqual(afterRetry.workers[0].instance, afterRetry.workers[1].instance);
    reports.push({ fault, terminal, beforeRetry, afterRetry });
  }
  await screenshotTo(route, 'firefox-adapter-ready.png');
  return reports;
}
async function checkIntegratedJourney(route) {
  await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/' });
  await waitForUi(route, '[data-page-id="PAGE-01"]');
  await execute(
    route,
    String.raw`
    const modules = [];
    const audit = window.journeyAudit = {workers:[],writes:0,databaseOpens:0,databaseNames:[],compiles:0,hashes:[]};
    const wasmBytes=arguments[0];
    const originalCompile=window.WebAssembly.compile.bind(window.WebAssembly);
    window.WebAssembly.compile=(...args)=>{audit.compiles++;return originalCompile(...args);};
    const originalDigest=window.crypto.subtle.digest.bind(window.crypto.subtle);
    window.crypto.subtle.digest=async(algorithm,data)=>{
      const result=await originalDigest(algorithm,data);
      if(data.byteLength===wasmBytes)audit.hashes.push([...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join(''));
      return result;
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args); this.record = {terminated:false}; audit.workers.push(this.record);
        this.addEventListener('message', event => {
          if (typeof event.data.buffer?.byteLength === 'number') {
            this.record.build = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(event.data.buffer));
            this.record.instance = event.data.workerInstanceId;
          }
        });
      }
      postMessage(message, options = []) {
        this.record.nonce = message.nonce;
        let index = modules.indexOf(message.module);
        if (index === -1) index = modules.push(message.module) - 1;
        this.record.moduleToken = index + 1;
        super.postMessage(message, options);
      }
      terminate() { this.record.terminated=true; super.terminate(); }
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(...args) { audit.writes++; return setItem.apply(this,args); };
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => { audit.databaseOpens++; audit.databaseNames.push(args[0]); return open(...args); };
  `,
    [engineBuild.wasmBytes],
  );
  const pages = [await publicPageSnapshot(route)];
  async function visit(selector, pageId, sample = false) {
    await click(route, selector);
    await waitForUi(route, `[data-page-id="${pageId}"]`);
    if (pageId === 'PAGE-02')
      await waitForUi(route, '[data-testid="course-reading"][data-state="ready"]');
    if (pageId === 'PAGE-03')
      await waitForUi(route, '[data-testid="lesson-reading"][data-state="ready"]');
    if (pageId === 'PAGE-04') await waitForWorkspace(route, 'practice');
    if (
      pageId === 'PAGE-06' &&
      (await execute(route, 'return location.hash.startsWith("#/visualize/");'))
    )
      await waitForWorkspace(route, 'case');
    if (sample && ['PAGE-05', 'PAGE-06'].includes(pageId)) {
      await waitForUi(route, '[data-testid="content-sample"][data-state="ready"]');
      assert.match(
        await execute(
          route,
          'return document.querySelector("[data-testid=content-sample]").textContent;',
        ),
        pageId === 'PAGE-05' ? /标准内容样例 · 尚未正式发布/ : /已审核案例 · 独立观看/,
      );
    }
    pages.push(await publicPageSnapshot(route));
  }
  await visit('nav[aria-label="主导航"] a[href="#/courses"]', 'PAGE-02', true);
  await visit('main a[href="#/lessons/lesson.c.variables-output"]', 'PAGE-03', true);
  await visit('nav[aria-label="当前位置"] a[href="#/courses/chapter.c.values"]', 'PAGE-02', true);
  await visit('main a[href="#/lessons/lesson.c.variables-output"]', 'PAGE-03', true);
  await visit('main a[href="#/practice/exercise.c.echo"]', 'PAGE-04', true);
  assert.equal(
    await execute(
      route,
      'return document.querySelector("[data-testid=engine-connection]")===null;',
    ),
    true,
  );
  await visit('main a[href="#/practice/exercise.c.echo/review"]', 'PAGE-06');
  assert.equal(
    await execute(route, 'return !!document.querySelector("[data-testid=engine-connection]");'),
    false,
  );
  assert.match(
    await execute(
      route,
      'return document.querySelector("[data-testid=practice-feedback]").textContent;',
    ),
    /还没有可复盘的运行/,
  );
  await visit('main a[href="#/practice/exercise.c.echo"]', 'PAGE-04', true);
  await visit('nav[aria-label="主导航"] a[href="#/cases"]', 'PAGE-05', true);
  await visit('main a[href="#/visualize/case.c.bubble-sort"]', 'PAGE-06', true);
  await click(route, '[data-testid="engine-connection"] button');
  await waitForUi(route, '[data-testid="engine-connection"][data-state="ready"]');
  await visit('nav[aria-label="主导航"] a[href="#/cases"]', 'PAGE-05', true);
  await visit('main a[href="#/visualize/case.c.assignment"]', 'PAGE-06', true);
  await click(route, '[data-testid="engine-connection"] button');
  await waitForUi(route, '[data-testid="engine-connection"][data-state="ready"]');
  const audit = await execute(route, 'return window.journeyAudit;');
  assert.equal(audit.workers.length, 2);
  assert.equal(audit.writes, 0);
  assert.equal(audit.compiles, 1);
  assert.deepEqual(audit.hashes, [engineBuild.wasmSha256]);
  assert.ok(audit.databaseNames.every((name) => name === 'c-viz-learning'));
  assert.equal(audit.workers[0].moduleToken, audit.workers[1].moduleToken);
  assert.notEqual(audit.workers[0].instance, audit.workers[1].instance);
  for (const worker of audit.workers) {
    assert.equal(worker.terminated, true);
    assert.deepEqual(worker.build, {
      kind: 'build-probe',
      probeVersion: '1.0.0',
      nonce: worker.nonce,
      engineVersion: '0.1.0',
      interpreterReady: false,
    });
  }
  for (const page of pages) assertNoRun(page);
  assert.ok(pages.every((page) => page.forbiddenLinks === 0));
  await screenshotTo(route, '03.4-firefox-journey.png');
  await visit('nav[aria-label="主导航"] a[href="#/settings"]', 'PAGE-07');
  return { pages, audit, interpreterReady: false };
}
async function checkPlayerControls(route) {
  await webdriver(`${route}/url`, 'POST', {
    url: 'http://127.0.0.1:4178/#/visualize/case.c.assignment',
  });
  await waitForUi(route, '[data-testid="input-panel"]');
  await waitForWorkspace(route, 'case');
  assertNoRun(await publicPageSnapshot(route), true);
  await click(route, '[data-testid="case-execution"] > .inline-actions button.button-primary');
  await waitForUi(route, '[data-testid="case-execution"][data-state="completed"]');
  const controls = '[data-testid="player-controls"]';
  const snapshot = () =>
    execute(
      route,
      `
    const p=document.querySelector('${controls}');
    return {status:p.dataset.playerStatus,cursor:Number(p.dataset.cursor),length:Number(p.dataset.length),
      disabled:[...p.querySelectorAll('button')].map(b=>b.disabled),
      output:document.querySelector('[data-testid="execution-output"]').textContent};
  `,
    );
  const observations = [];
  let value = await snapshot();
  assert.equal(value.cursor, 0);
  assert.equal(value.length, 6);
  assert.deepEqual(value.disabled, [true, false, false, false]);
  observations.push(value);
  await execute(route, 'document.querySelector("[data-testid=player-workspace]").focus();');
  await pressKey(route, '\uE014');
  assert.equal((await snapshot()).cursor, 1);
  await pressKey(route, '\uE012');
  assert.equal((await snapshot()).cursor, 0);
  await pressKey(route, ' ');
  await waitForUi(route, `${controls}[data-player-status="playing"]`);
  await waitForUi(route, `${controls}[data-cursor="1"]`);
  await pressKey(route, ' ');
  value = await snapshot();
  assert.equal(value.status, 'paused');
  await delay(650);
  assert.deepEqual(await snapshot(), value);
  observations.push(value);
  await execute(route, 'document.querySelector("[data-testid=code-panel] textarea").focus();');
  await pressKey(route, '\uE014');
  await pressKey(route, ' ');
  assert.deepEqual(await snapshot(), value);
  await execute(
    route,
    `
    const p=document.querySelector('${controls}');
    const select=p.querySelector('select');select.value='4';
    select.dispatchEvent(new Event('change',{bubbles:true}));
  `,
  );
  await click(route, `${controls} button:last-of-type`);
  await waitForUi(route, `${controls}[data-player-status="ended"]`);
  value = await snapshot();
  assert.equal(value.cursor, 6);
  assert.deepEqual(value.disabled, [false, true, true, false]);
  assert.equal(value.output, '5\n');
  observations.push(value);
  await click(route, `${controls} button:first-child`);
  assert.equal((await snapshot()).cursor, 5);
  await screenshotTo(route, '08.2-firefox-player.png');
  await click(route, `${controls} button:last-of-type`);
  // Native input edit invalidates the playing trajectory immediately.
  await execute(route, 'document.querySelector("[data-testid=input-seed]").focus();');
  await pressKey(route, 'x');
  await waitForUi(route, '[data-testid="case-execution"][data-state="unprepared"]');
  assert.equal(await execute(route, `return document.querySelector('${controls}')===null;`), true);
  await webdriver(`${route}/refresh`, 'POST', {});
  await waitForWorkspace(route, 'case');
  assertNoRun(await publicPageSnapshot(route), true);
  writeFileSync(
    join(output, 'firefox-player.json'),
    JSON.stringify(
      {
        evidenceLevel: 'stock-Firefox-production-Rust-execution-and-player-controls',
        observations,
        keyboard: true,
        pauseStable: true,
        sourceFocusProtected: true,
        inputInvalidated: true,
        reloadCleared: true,
      },
      null,
      2,
    ) + '\n',
  );
}

async function checkTraceViews(route) {
  await webdriver(`${route}/url`, 'POST', {
    url: 'http://127.0.0.1:4178/#/visualize/case.c.assignment',
  });
  await waitForUi(route, '[data-testid="input-panel"]');
  await waitForWorkspace(route, 'case');
  assertNoRun(await publicPageSnapshot(route), true);
  await click(route, '[data-testid="case-execution"] > .inline-actions button.button-primary');
  await waitForUi(route, '[data-testid="case-execution"][data-state="completed"]');
  const capture = () =>
    execute(
      route,
      `
    const v=document.querySelector('[data-testid="trace-view"]');
    return {cursor:Number(v.dataset.cursor),
      variables:[...v.querySelectorAll('[data-testid="trace-variable"]')].map(e=>({id:e.dataset.objectId,name:e.dataset.name,value:e.dataset.value})),
      output:v.querySelector('[data-testid="step-output"]').dataset.output,
      counters:{...v.querySelector('[data-testid="step-counters"]').dataset},
      marks:[...document.querySelectorAll('[data-testid="source-step-highlight"]')].map(e=>({start:e.dataset.byteStart,end:e.dataset.byteEnd})),
      source:document.querySelector('[data-testid="code-panel"] textarea').value};
  `,
    );
  const observations = [await capture()];
  assert.deepEqual(observations[0].variables, []);
  assert.equal(observations[0].output, '');
  assert.deepEqual(observations[0].marks, []);
  await execute(route, 'document.querySelector("[data-testid=player-workspace]").focus();');
  for (let i = 1; i <= 6; i++) {
    await pressKey(route, '\uE014');
    const value = await capture();
    assert.equal(value.cursor, i);
    assert.ok(value.marks.length > 0);
    observations.push(value);
  }
  assert.equal(observations[2].variables[0].value, 'uninitialized');
  assert.equal(observations[3].variables[0].value, '3');
  assert.equal(observations[4].variables[0].value, '5');
  assert.equal(observations[4].output, '');
  assert.equal(observations[5].output, '5\n');
  assert.deepEqual(observations[6].variables, []);
  for (let i = 5; i >= 0; i--) {
    await pressKey(route, '\uE012');
    assert.deepEqual(await capture(), observations[i]);
  }
  for (let i = 0; i < 4; i++) await pressKey(route, '\uE014');
  await screenshotTo(route, '08.3-firefox-scalar.png');
  await webdriver(`${route}/url`, 'POST', {
    url: 'http://127.0.0.1:4178/#/visualize/case.c.array-traversal',
  });
  await waitForUi(route, '[data-testid="input-panel"]');
  const field = await webdriver(`${route}/element`, 'POST', {
    using: 'css selector',
    value: '[data-testid="input-field-values"]',
  });
  const fieldId = field['element-6066-11e4-a52e-4f735466cecf'];
  await webdriver(`${route}/element/${fieldId}/clear`, 'POST', {});
  await webdriver(`${route}/element/${fieldId}/value`, 'POST', { text: '-2,5,5,0' });
  await click(route, '[data-testid="input-panel"] button.button-primary');
  await waitForUi(route, '[data-testid="case-execution"][data-state="ready"]');
  await click(route, '[data-testid="case-execution"] > .inline-actions button.button-primary');
  await waitForUi(route, '[data-testid="case-execution"][data-state="completed"]');
  await execute(route, 'document.querySelector("[data-testid=player-workspace]").focus();');
  for (let i = 0; i < 5; i++) await pressKey(route, '\uE014');
  const array = await execute(
    route,
    `return [...document.querySelectorAll('[data-testid="trace-array-cell"]')].map(e=>({value:e.dataset.value,write:e.dataset.write}));`,
  );
  assert.deepEqual(
    array.map((c) => c.value),
    ['-2', '5', '5', '0'],
  );
  assert.ok(array.every((c) => c.write === 'true'));
  await screenshotTo(route, '08.3-firefox-array.png');
  writeFileSync(
    join(output, 'firefox-trace-view.json'),
    JSON.stringify(
      {
        evidenceLevel: 'stock-Firefox-production-real-Rust-single-cursor-views',
        observations,
        array,
        fullReverseRecovery: true,
        nativeKeyboard: true,
      },
      null,
      2,
    ) + '\n',
  );
}

let sessionId;
try {
  await waitFor('http://127.0.0.1:4178/', server);
  await waitFor('http://127.0.0.1:4447/status', driver);
  const session = await webdriver('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          binary,
          args: ['-headless'],
          prefs: { 'app.update.auto': false, 'browser.shell.checkDefaultBrowser': false },
        },
      },
    },
  });
  sessionId = session.sessionId;
  assert.match(session.capabilities.browserVersion, /^158\.0/);
  const route = `/session/${sessionId}`;
  await webdriver(`${route}/window/rect`, 'POST', { width: 1440, height: 900 });
  const dimensions = await webdriver(`${route}/execute/sync`, 'POST', {
    script: 'return {width:innerWidth,height:innerHeight};',
    args: [],
  });
  await webdriver(`${route}/window/rect`, 'POST', {
    width: 1440 + (1440 - dimensions.width),
    height: 900 + (900 - dimensions.height),
  });
  const viewport = await webdriver(`${route}/execute/sync`, 'POST', {
    script: 'return {width:innerWidth,height:innerHeight,devicePixelRatio};',
    args: [],
  });
  assert.equal(viewport.width, 1440);
  assert.equal(viewport.height, 900);
  await webdriver(`${route}/timeouts`, 'POST', { script: 30000, pageLoad: 30000 });
  await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/' });
  const app = await webdriver(`${route}/execute/sync`, 'POST', {
    script: 'return {title:document.title,text:document.body.textContent};',
    args: [],
  });
  assert.equal(app.title, '编程可视化教学平台');
  assert.match(app.text, /页面预览/);
  assert.match(app.text, /让每一步，都看得明白。/);
  const screenshot = await webdriver(`${route}/screenshot`);
  writeFileSync(join(output, 'firefox-app.png'), Buffer.from(screenshot, 'base64'));
  const navigation = await checkNavigation(route);
  writeFileSync(
    join(output, 'firefox-navigation.json'),
    JSON.stringify(
      {
        evidenceLevel: 'page-navigation-browser-smoke',
        capabilities: session.capabilities,
        viewport,
        navigation,
        excluded: ['real-C-execution', 'learning-storage', 'awards', 'formal-performance'],
      },
      null,
      2,
    ) + '\n',
  );
  await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/checks/' });
  const checks = await webdriver(`${route}/execute/async`, 'POST', {
    script: `const done = arguments[arguments.length - 1];
      (async () => {
        const cold = await window.runBuildProbe({nonce:17});
        const warm = await window.runBuildProbe({nonce:4294967295,warm:true});
        let missingError = null;
        try { await window.runBuildProbe({nonce:1,missing:true}); } catch (error) { missingError = error.message; }
        const recovered = await window.runBuildProbe({nonce:0});
        done({cold,warm,missingError,recovered});
      })().catch(error => done({error:error.message}));`,
    args: [],
  });
  assert.equal(checks.error, undefined);
  for (const [key, nonce] of [
    ['cold', 17],
    ['warm', 4294967295],
    ['recovered', 0],
  ]) {
    assert.equal(checks[key].probe.kind, 'build-probe');
    assert.equal(checks[key].probe.nonce, nonce);
    assert.equal(checks[key].probe.interpreterReady, false);
    assert.equal(checks[key].terminated, true);
    assert.equal(checks[key].memory.growBeyondMaximumRejected, true);
    assert.ok(checks[key].bufferBytes < 1024);
  }
  assert.notEqual(checks.cold.workerInstanceId, checks.warm.workerInstanceId);
  assert.match(checks.missingError, /404/);
  const execution = await webdriver(`${route}/execute/async`, 'POST', {
    script: `const done = arguments[arguments.length - 1];
      (async () => {
        const observations = [];
        for (const id of ['case.c.assignment','case.c.branch','case.c.loops','case.c.array-traversal','case.c.bubble-sort','case.c.selection-sort','case.c.binary-search-first']) {
          await window.executionChecks.open(id);
          observations.push({id, result: await window.executionChecks.run()});
        }
        await window.executionChecks.open('case.c.assignment', 'changed');
        const changed = await window.executionChecks.run();
        await window.executionChecks.open('case.c.assignment', 'division');
        const division = await window.executionChecks.run();
        await window.executionChecks.open();
        const runId = window.executionChecks.start();
        window.executionChecks.cancel();
        const cancelled = await window.executionChecks.wait(runId);
        const recovered = await window.executionChecks.run();
        const inspect = window.executionChecks.inspect();
        window.executionChecks.close();
        done({observations, changed, division, cancelled, recovered, inspect});
      })().catch(error => done({error: error.name}));`,
    args: [],
  });
  assert.equal(execution.error, undefined);
  for (const observation of execution.observations) {
    assert.equal(observation.result.producer, 'rust');
    assert.equal(observation.result.status, 'completed');
    assert.ok(observation.result.steps >= 2);
  }
  assert.equal(execution.changed.output, '10\n');
  assert.equal(execution.division.status, 'program-error');
  assert.equal(execution.division.completeness, 'prefix');
  assert.ok(execution.division.codes.includes('E_DIV_ZERO'));
  assert.equal(execution.cancelled.status, 'cancelled');
  assert.equal(execution.cancelled.steps, null);
  assert.equal(execution.recovered.output, '5\n');
  assert.equal(execution.inspect.activeWorkers, 0);
  writeFileSync(
    join(output, 'firefox-execution-regression.json'),
    JSON.stringify(
      {
        evidenceLevel: 'real-stock-Firefox-EXEC-01',
        capabilities: session.capabilities,
        execution,
      },
      null,
      2,
    ) + '\n',
  );
  const inputReply = await webdriver(`${route}/execute/async`, 'POST', {
    script: `const done = arguments[arguments.length - 1];
      (async () => {
        const results = [];
        for (const [id,values] of [
          ['case.c.assignment',{x:-999}],
          ['case.c.bubble-sort',{values:[]}],
          ['case.c.binary-search-first',{values:[-2,4,4,9],target:4}],
          ['case.c.bubble-sort',{values:Array.from({length:30},(_,i)=>30-i)}]
        ]) {
          const prepared=await window.inputChecks.open(id,values);
          const result=await window.inputChecks.run();
          results.push({id,values,source:prepared.source,result,activeWorkers:window.inputChecks.inspect().activeWorkers});
        }
        const first=await window.inputChecks.openRandom('case.c.binary-search-first','教学🌱',5);
        const seeded=await window.inputChecks.run();
        const metadata=window.inputChecks.inspect().request.input.random;
        const second=await window.inputChecks.openRandom('case.c.binary-search-first','教学🌱',5);
        window.inputChecks.close();
        return {results,first,second,seeded,metadata};
      })().then(value=>done({ok:true,value}),error=>done({ok:false,code:error.message}));`,
    args: [],
  });
  assert.equal(inputReply.ok, true, JSON.stringify(inputReply));
  const input = inputReply.value;
  for (const item of input.results) {
    assert.equal(item.result.producer, 'rust');
    assert.equal(item.result.status, 'completed');
    assert.equal(item.result.completeness, 'complete');
    assert.equal(item.activeWorkers, 0);
    assert.ok(item.result.elapsedMs < 1000);
  }
  assert.equal(input.results[0].result.output, '-997\n');
  assert.equal(input.results[1].result.output, '\n');
  assert.equal(input.results[2].result.output, '1\n');
  assert.equal(input.results[3].result.steps, 5330);
  assert.equal(
    input.results[3].result.output,
    Array.from({ length: 30 }, (_, i) => i + 1).join(' ') + '\n',
  );
  assert.deepEqual(input.first.values, { values: [-808, -135, 649, 675, 909], target: 79 });
  assert.deepEqual(input.first.values, input.second.values);
  assert.equal(input.first.source, input.second.source);
  assert.deepEqual(input.metadata, {
    generatorRef: { id: 'generator.c.p0-input', version: '1.0.0' },
    seed: '教学🌱',
  });
  assert.equal(input.seeded.status, 'completed');
  writeFileSync(
    join(output, 'firefox-input.json'),
    JSON.stringify(
      { evidenceLevel: 'real-stock-Firefox-07.2-input', capabilities: session.capabilities, input },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    join(output, 'firefox-stable.json'),
    JSON.stringify(
      {
        evidenceLevel: 'engineering-browser-smoke',
        interpreterReady: false,
        capabilities: session.capabilities,
        viewport,
        app,
        checks,
        navigation,
      },
      null,
      2,
    ) + '\n',
  );
  const adapters = await checkAdapters(route);
  writeFileSync(
    join(output, 'firefox-adapters.json'),
    JSON.stringify(
      {
        evidenceLevel: 'content-and-build-module-adapter',
        capabilities: session.capabilities,
        viewport,
        interpreterReady: false,
        adapters,
      },
      null,
      2,
    ) + '\n',
  );
  const integratedJourney = await checkIntegratedJourney(route);
  writeFileSync(
    join(output, '03.4-firefox-integration.json'),
    JSON.stringify(
      {
        evidenceLevel: 'real-stock-Firefox-continuous-skeleton-integration',
        capabilities: session.capabilities,
        viewport,
        integratedJourney,
      },
      null,
      2,
    ) + '\n',
  );
  await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/checks/' });
  await waitForUi(route, '#probe-status');
  const reference = JSON.parse(
    readFileSync(join(workspaceDir, 'shared/contracts/02.3-迁移与并发场景.json'), 'utf8'),
  );
  assert.equal(reference.purpose, 'contract-fixture');
  const storageReply = await webdriver(`${route}/execute/async`, 'POST', {
    script:
      'const done = arguments[arguments.length - 1]; window.storageHarness.runSmoke(arguments[0], arguments[1]).then(value => done({ ok: true, value }), error => done({ ok: false, code: error.code || error.name }));',
    args: [`c-viz-learning.test.firefox-${process.pid}-${Date.now()}`, reference.legacyFixture],
  });
  assert.equal(storageReply.ok, true, JSON.stringify(storageReply));
  const storage = storageReply.value;
  assert.equal(storage.available, true);
  assert.equal(storage.reopenedEqual, true);
  assert.equal(storage.rewards, 1);
  assert.equal(storage.receipts, 2);
  assert.equal(storage.replay.replayed, true);
  assert.equal(storage.first.saved, true);
  assert.equal(storage.rejectCode, 'S_EVENT_ID_REUSED');
  assert.equal(storage.localStorageWrites, 0);
  assert.deepEqual(storage.migration, {
    preservedGeneration: true,
    progress: 2,
    ledger: 1,
    facts: 0,
    receipts: 0,
  });
  writeFileSync(
    join(output, '04.1-firefox-storage.json'),
    JSON.stringify(
      {
        evidenceLevel: 'real-stock-Firefox-native-IDB-synthetic-storage-facts',
        capabilities: session.capabilities,
        storage,
      },
      null,
      2,
    ) + '\n',
  );
  const learningReply = await webdriver(`${route}/execute/async`, 'POST', {
    script:
      'const done=arguments[arguments.length-1]; window.learningHarness.runSmoke().then(value=>done({ok:true,value}),error=>done({ok:false,code:error.code||error.name}));',
    args: [],
  });
  assert.equal(learningReply.ok, true, JSON.stringify(learningReply));
  const learning = learningReply.value;
  assert.equal(learning.currentLessonCompleted, true);
  assert.equal(learning.receiptCount, 4);
  assert.equal(learning.pendingCount, 5);
  assert.equal(learning.postedPoints, '0');
  assert.deepEqual(learning.todayCounts, { exercise: 2, lesson: 1, case: 1 });
  assert.equal(learning.goalAchieved, true);
  assert.equal(learning.receiptReplayPreserved, true);
  assert.equal(learning.reopenedEqual, true);
  assert.equal(learning.nativeRowsEqual, true);
  await webdriver(`${route}/url`, 'POST', {
    url: 'http://127.0.0.1:4178/#/settings?panel=display',
  });
  await waitForUi(route, 'main form select');
  for (const [index, value] of [
    [0, 'dark'],
    [1, 'on'],
    [2, '1.5'],
  ]) {
    await execute(
      route,
      'const select=document.querySelectorAll("main select")[arguments[0]];select.value=arguments[1];select.dispatchEvent(new Event("change",{bubbles:true}));',
      [index, value],
    );
  }
  await click(route, 'main form button.button-primary');
  let displaySaved = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    displaySaved = await execute(
      route,
      'return document.querySelector("[data-testid=learning-save-status]")?.textContent.includes("这次更改已保存到当前浏览器");',
    );
    if (displaySaved) break;
    await delay(50);
  }
  assert.equal(displaySaved, true);
  await webdriver(`${route}/refresh`, 'POST', {});
  await waitForUi(route, 'main form select');
  const settingsUi = await execute(
    route,
    'return {values:[...document.querySelectorAll("main select")].map(select=>select.value),theme:document.documentElement.dataset.theme,motion:document.documentElement.dataset.reducedMotion};',
  );
  assert.deepEqual(settingsUi, { values: ['dark', 'on', '1.5'], theme: 'dark', motion: 'on' });
  await screenshotTo(route, '04.2-firefox-dark-settings.png');
  writeFileSync(
    join(output, '04.2-firefox-learning.json'),
    JSON.stringify(
      {
        evidenceLevel: 'real-stock-Firefox-production-settings-and-synthetic-native-learning-state',
        capabilities: session.capabilities,
        learning,
        settingsUi,
      },
      null,
      2,
    ) + '\n',
  );
  await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/checks/' });
  await waitForUi(route, '#probe-status');
  const recoveryReply = await webdriver(`${route}/execute/async`, 'POST', {
    script: `const done=arguments[arguments.length-1]; (async()=>{
      const h=window.recoveryHarness, name=arguments[0];
      await h.open(name); await h.seedStudy();
      h.clock('2026-10-16T02:00:00.000Z');
      const captured=await h.capture('exercise.passed','exercise.synthetic.first');
      if(!captured.ok) throw Error(captured.error.code);
      const eventId=captured.value.receipt.eventId;
      const before=await h.rawDump(); h.fault('quota','receipts');
      const failed=await h.commit(eventId), provisional=h.state();
      const rollbackEqual=JSON.stringify(before)===JSON.stringify(await h.rawDump());
      const retried=await h.retry();
      const retrySameEvent=retried.snapshot.receipts.some(r=>r.eventId===eventId&&r.occurredAt===captured.value.receipt.occurredAt);
      await h.corrupt('settings'); const damaged=await h.refresh();
      const rawDamaged=await h.rawDump(); const reset=await h.reset('settings'); const rawReset=await h.rawDump();
      const unrelatedResetEqual=Object.keys(rawDamaged.rows).filter(s=>s!=='settings'&&s!=='meta').every(s=>JSON.stringify(rawDamaged.rows[s])===JSON.stringify(rawReset.rows[s]));
      h.fault('abort','meta'); const failedClear=await h.clear();
      const clearFailurePreserved=JSON.stringify(rawReset)===JSON.stringify(await h.rawDump());
      const cleared=await h.clear(); const late=await h.commit(eventId);
      const summary={failedCode:failed.ok?null:failed.error.code,temporary:provisional.temporary,pending:provisional.pendingCount,rollbackEqual,retrySameEvent,retrySaved:retried.lastSaved,
        damagedReadonly:damaged.status==='readonly',resetSaved:reset.lastSaved,unrelatedResetEqual,clearFailureAcknowledged:failedClear.cleared,clearFailurePreserved,
        cleared:cleared.cleared,newGeneration:cleared.snapshot.meta.generation!==retried.snapshot.meta.generation,revision:cleared.snapshot.meta.revision,settings:cleared.snapshot.settings,
        emptyLearning:['progress','dailyFacts','goals','ledger','receipts','aliases'].every(s=>cleared.snapshot[s].length===0),lateCode:late.ok?null:late.error.code};
      await h.dispose(); return summary;
    })().then(value=>done({ok:true,value}),error=>done({ok:false,code:error.code||error.message||error.name}));`,
    args: [`c-viz-learning.test.recovery.firefox-${process.pid}-${Date.now()}`],
  });
  assert.equal(recoveryReply.ok, true, JSON.stringify(recoveryReply));
  const recovery = recoveryReply.value;
  assert.equal(recovery.failedCode, 'S_QUOTA');
  assert.equal(recovery.temporary, true);
  assert.equal(recovery.pending, 1);
  for (const key of [
    'rollbackEqual',
    'retrySameEvent',
    'retrySaved',
    'damagedReadonly',
    'resetSaved',
    'unrelatedResetEqual',
    'clearFailurePreserved',
    'cleared',
    'newGeneration',
    'emptyLearning',
  ])
    assert.equal(recovery[key], true, key);
  assert.equal(recovery.clearFailureAcknowledged, false);
  assert.equal(recovery.revision, 0);
  assert.equal(recovery.lateCode, 'S_GENERATION_STALE');
  assert.deepEqual(recovery.settings, {
    theme: 'system',
    reducedMotion: 'system',
    playbackRate: 1,
    goalTemplate: null,
  });
  await webdriver(`${route}/url`, 'POST', { url: 'http://127.0.0.1:4178/#/settings?panel=data' });
  await waitForUi(route, 'main .settings-panel');
  await click(route, 'main .settings-panel button.button-secondary');
  await waitForUi(route, 'dialog[open]');
  await screenshotTo(route, '04.3-firefox-clear-confirmation.png');
  assert.equal(await execute(route, 'return document.activeElement?.textContent.trim();'), '取消');
  await click(route, 'dialog .inline-actions button:first-child');
  assert.equal(await execute(route, 'return document.querySelector("dialog[open]")===null;'), true);
  await click(route, 'main .settings-panel button.button-secondary');
  await waitForUi(route, 'dialog[open]');
  await click(route, 'dialog button.button-primary');
  let clearAcknowledged = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    clearAcknowledged = await execute(
      route,
      'return document.querySelector("[data-testid=learning-save-status]")?.textContent.includes("本地数据已清除");',
    );
    if (clearAcknowledged) break;
    await delay(50);
  }
  assert.equal(clearAcknowledged, true);
  await screenshotTo(route, '04.3-firefox-cleared-settings.png');
  await webdriver(`${route}/refresh`, 'POST', {});
  await waitForUi(route, 'main .settings-panel');
  const clearUi = await execute(
    route,
    'return {theme:document.documentElement.dataset.themePreference,motion:document.documentElement.dataset.motionPreference,dialogOpen:!!document.querySelector("dialog[open]")};',
  );
  assert.deepEqual(clearUi, { theme: 'system', motion: 'system', dialogOpen: false });
  writeFileSync(
    join(output, '04.3-firefox-recovery.json'),
    JSON.stringify(
      {
        evidenceLevel:
          'real-stock-Firefox-native-IDB-recovery-with-synthetic-learning-and-production-clear',
        capabilities: session.capabilities,
        recovery,
        clearUi,
        clearAcknowledged,
      },
      null,
      2,
    ) + '\n',
  );
  await checkPlayerControls(route);
  await checkTraceViews(route);
  console.log(
    `Stock Firefox ${session.capabilities.browserVersion}: navigation, app, cold/warm WASM, storage, failure/recovery passed.`,
  );
} catch (error) {
  writeFileSync(
    join(output, 'firefox-adapter-failure.json'),
    JSON.stringify(
      {
        message: error.message,
        stack: error.stack,
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  if (sessionId) await webdriver(`/session/${sessionId}`, 'DELETE').catch(() => {});
  driver.kill();
  server.kill();
}
