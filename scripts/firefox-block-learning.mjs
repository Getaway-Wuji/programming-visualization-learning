// Stock Firefox 09.4 acceptance: native Blockly/learning UI and read-only storage inspection.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceDir } from './process.mjs';
import { checkEnvironment } from './environment.mjs';

checkEnvironment({ bindgen: true });
const output = join(workspaceDir, '.artifacts/09.4');
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
const serverPort = 4178;
const driverPort = 4452;
const origin = `http://127.0.0.1:${serverPort}`;
const driverOrigin = `http://127.0.0.1:${driverPort}`;
const reviewed = JSON.parse(
  readFileSync(join(workspaceDir, 'content/c/p0/course-1.0.1.json'), 'utf8'),
);
const frozenCounts = [3, 3, 3, 4, 5, 6];
assert.equal(reviewed.lessons.length, 6);
assert.deepEqual(
  reviewed.exercises.map((exercise) => exercise.tests.length),
  frozenCounts,
);
assert.ok(existsSync(binary) && existsSync(executable));
mkdirSync(output, { recursive: true });

// Refuse to reuse or stop another window's server/driver. No children exist yet.
for (const port of [serverPort, driverPort])
  await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });

let server;
let driver;
let sessionId;
let capabilities;
let failure;
let report;
let serviceLog = '';
const checks = [];
const nativeScrolls = [];
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const blockList = '[aria-label="积木工作区"] select[aria-label="积木列表"]';
const playerControls = '[data-testid="player-controls"]';

function ownedChild(command, args) {
  const child = spawn(command, args, { cwd: workspaceDir, stdio: 'pipe', windowsHide: true });
  child.on('error', (error) => {
    serviceLog += `${error.message}\n`;
  });
  child.stdout.on('data', (data) => {
    serviceLog += data.toString();
  });
  child.stderr.on('data', (data) => {
    serviceLog += data.toString();
  });
  return child;
}
async function service(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, serviceLog);
    try {
      if ((await fetch(url, { signal: globalThis.AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* Own child is still starting. */
    }
    await delay(100);
  }
  throw new Error(`09.4 owned QA service did not start: ${serviceLog}`);
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
// These browser scripts only read DOM or open an existing DB in a readonly transaction.
// They never call application modules, Blockly APIs, test hooks or a storage write.
const js = (script, args = []) =>
  wd(`/session/${sessionId}/execute/sync`, 'POST', { script, args });
async function until(script, args = [], attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await js(script, args);
    if (value) return value;
    await delay(50);
  }
  throw new Error(`09.4 Firefox expected UI state was not reached: ${script}`);
}
async function element(selector) {
  return (
    await wd(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  )[elementKey];
}
async function click(selector) {
  await wd(`/session/${sessionId}/element/${await element(selector)}/click`, 'POST', {});
}
async function clickText(tag, text) {
  assert.ok(['button', 'a'].includes(tag) && !text.includes("'"));
  const found = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'xpath',
    value: `//${tag}[normalize-space(.)='${text}']`,
  });
  // Center long-page links through native wheel input. Firefox's automatic
  // element-click scroll can leave the sixth exercise's review link below the
  // viewport; do not replace the user's click with a DOM click or route call.
  const bounds = await js(
    'const r=arguments[0].getBoundingClientRect();return {center:r.top+r.height/2,width:innerWidth,height:innerHeight};',
    [found],
  );
  const deltaY = Math.round(bounds.center - bounds.height / 2);
  if (Math.abs(deltaY) > bounds.height / 4) {
    await wd(`/session/${sessionId}/actions`, 'POST', {
      actions: [
        {
          type: 'wheel',
          id: 'page-wheel',
          actions: [
            {
              type: 'scroll',
              x: bounds.width - 20,
              y: Math.floor(bounds.height / 2),
              deltaX: 0,
              deltaY,
              duration: 200,
            },
          ],
        },
      ],
    });
    nativeScrolls.push({ text, deltaY });
  }
  await wd(`/session/${sessionId}/element/${found[elementKey]}/click`, 'POST', {});
}
async function selectOption(selector, value) {
  // Native option click performs the select's normal input/change behavior.
  const matches = await js(
    'return [...document.querySelector(arguments[0]).options].filter(option=>option.value===arguments[1]).length;',
    [selector, value],
  );
  assert.equal(matches, 1, `Expected exactly one native option ${selector} / ${value}`);
  assert.ok(!value.includes('"'));
  await click(`${selector} option[value="${value}"]`);
  await until('return document.querySelector(arguments[0])?.value === arguments[1];', [
    selector,
    value,
  ]);
}
async function fill(selector, text) {
  const id = await element(selector);
  await wd(`/session/${sessionId}/element/${id}/clear`, 'POST', {});
  await wd(`/session/${sessionId}/element/${id}/value`, 'POST', { text });
  await until('return document.querySelector(arguments[0])?.value === arguments[1];', [
    selector,
    text,
  ]);
}
async function navigate(path) {
  await wd(`/session/${sessionId}/url`, 'POST', { url: `${origin}/#${path}` });
}
async function locallyReady() {
  await until(
    'return document.querySelector("[data-testid=learning-save-status]")?.dataset.saveStatus === "ready";',
  );
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
async function submit() {
  await clickText('button', '准备代码');
  await until(
    'return document.querySelector("[data-testid=practice-execution]")?.dataset.state === "ready" && [...document.querySelectorAll("[data-testid=practice-execution] button")].some(button=>button.textContent.trim()==="提交练习" && !button.disabled);',
  );
  await clickText('button', '提交练习');
  await until(
    'return document.querySelector("[data-testid=practice-execution]")?.dataset.state === "passed" && document.querySelector("[data-testid=practice-pass-save]")?.dataset.saveState === "saved";',
  );
  await locallyReady();
}
async function storageSnapshot() {
  const snapshot = await wd(`/session/${sessionId}/execute/async`, 'POST', {
    script: String.raw`
const done=arguments[arguments.length-1],open=indexedDB.open('c-viz-learning');
open.onerror=()=>done({error:'open'});open.onsuccess=()=>{
 const db=open.result,names=[...db.objectStoreNames],rows={},tx=db.transaction(names,'readonly');
 for(const name of names){const request=tx.objectStore(name).getAll();request.onsuccess=()=>rows[name]=request.result;}
 tx.oncomplete=()=>{db.close();done({rows,local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))});};
 tx.onabort=()=>{db.close();done({error:'transaction'});};};`,
    args: [],
  });
  assert.equal(snapshot.error, undefined);
  assert.equal(Object.keys(snapshot.rows).length, 9);
  return snapshot;
}
function noExecutionPersistence(snapshot, initial) {
  const forbidden = new Set([
    'source',
    'sourceSha256',
    'input',
    'seed',
    'stdout',
    'trace',
    'ast',
    'nodeMap',
    'checks',
    'coverage',
    'submissionId',
    'runId',
    'contextId',
    'sourceRevision',
    'workspace',
    'blockProgram',
    'blockMap',
    'draft',
  ]);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(
        forbidden.has(key),
        false,
        `Unexpected execution field in local learning archive: ${key}`,
      );
      visit(child);
    }
  };
  visit(snapshot);
  const archive = JSON.stringify(snapshot);
  assert.equal(archive.includes('int main'), false);
  assert.equal(archive.includes('lesson.block.'), false);
  assert.deepEqual(snapshot.local, initial.local);
  assert.deepEqual(snapshot.session, initial.session);
  assert.ok(
    snapshot.rows.ledger.every(
      (row) => row.status === 'pending' && row.points === null && row.policyRef === null,
    ),
  );
  assert.equal(snapshot.rows.settings[0].goalTemplate, null);
  assert.ok(snapshot.rows.goals.every((goal) => goal.targets === null && goal.achievedAt === null));
}
async function presentation() {
  return js(String.raw`return {
 cursor:document.querySelector('[data-testid=player-controls]')?.dataset.cursor,
 length:document.querySelector('[data-testid=player-controls]')?.dataset.length,
 source:document.querySelector('textarea[aria-label="当前执行的 C 代码"]')?.value,
 sourceReadonly:document.querySelector('textarea[aria-label="当前执行的 C 代码"]')?.readOnly,
 variables:[...document.querySelectorAll('[data-testid=trace-variable]')].map(e=>({name:e.dataset.name,value:e.dataset.value})),
 arrays:[...document.querySelectorAll('[data-testid=trace-array]')].map(e=>({name:e.dataset.name,cells:[...e.querySelectorAll('[data-testid=trace-array-cell]')].map(c=>({index:c.dataset.index,value:c.dataset.value}))})),
 output:document.querySelector('[data-testid=step-output]')?.dataset.output,
 stepLocation:document.querySelector('[data-testid=source-location]')?.textContent,
 counters:document.querySelector('[data-testid=step-counters]')?.textContent
};`);
}
async function move(cursor, forward) {
  await click(
    `${playerControls} button[aria-keyshortcuts="${forward ? 'ArrowRight' : 'ArrowLeft'}"]`,
  );
  await until(
    'return document.querySelector("[data-testid=player-controls]")?.dataset.cursor === arguments[0];',
    [String(cursor)],
  );
  return presentation();
}
async function stopOwned(child) {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([
    stopped,
    delay(5000).then(() => {
      throw new Error(`09.4 owned child ${child.pid} did not exit after termination.`);
    }),
  ]);
}

try {
  server = ownedChild(process.execPath, ['scripts/serve-checks.mjs']);
  driver = ownedChild(executable, [
    '--host',
    '127.0.0.1',
    '--port',
    String(driverPort),
    '--log',
    'warn',
  ]);
  await service(`${origin}/`, server);
  await service(`${driverOrigin}/status`, driver);
  // No supplied profile: geckodriver creates a fresh, isolated native Firefox profile.
  const session = await wd('/session', 'POST', {
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
  capabilities = session.capabilities;
  assert.equal(capabilities.browserName, 'firefox');
  assert.match(capabilities.browserVersion, /^158\./);
  await wd(`/session/${sessionId}/window/rect`, 'POST', { width: 1440, height: 1000 });
  await wd(`/session/${sessionId}/timeouts`, 'POST', { script: 30000, pageLoad: 30000 });
  await navigate('/courses');
  await until(
    'return document.querySelector("[data-testid=course-reading]")?.dataset.state === "ready";',
  );
  await locallyReady();
  const initial = await storageSnapshot();
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'])
    assert.deepEqual(initial.rows[store], []);

  for (const [index, lesson] of reviewed.lessons.entries()) {
    const exercise = reviewed.exercises.find(
      (entry) => entry.id === lesson.requiredExerciseRefs[0].id,
    );
    assert.ok(exercise);
    await navigate(`/lessons/${lesson.id}`);
    await until(
      'return document.querySelector("[data-testid=lesson-reading]")?.dataset.state === "ready";',
    );
    await locallyReady();
    assert.equal(
      await js('return document.querySelector("[data-testid=lesson-progress]").textContent;'),
      '未开始',
    );
    await clickText('button', '确认已学习');
    await until(
      'return document.querySelector("[data-testid=lesson-progress]")?.textContent.includes("已确认学习") && document.querySelector("[data-testid=learning-save-status]")?.dataset.saveStatus === "ready";',
    );
    const href = await js(
      'return [...document.querySelectorAll("a")].find(link=>link.textContent.trim()==="进入练习工作区")?.getAttribute("href");',
    );
    assert.equal(href, `#/practice/${exercise.id}`);
    await clickText('a', '进入练习工作区');
    await until(
      'return location.hash === arguments[0] && document.querySelector("[data-testid=practice-execution]")?.dataset.state === "ready" && document.querySelector("[aria-label=积木工作区] .blocklySvg");',
      [`#/practice/${exercise.id}`],
    );
    await correctStarter(exercise.id);
    await submit();
    const feedback = await js(
      'return document.querySelector("[data-testid=practice-feedback]").textContent;',
    );
    const cases = await js(
      'return [...document.querySelectorAll("[data-testid=practice-feedback] li")].map(entry=>entry.textContent);',
    );
    for (const test of exercise.tests)
      assert.equal(
        cases.filter((entry) => entry.startsWith(`${test.caseKey}：本组通过`)).length,
        1,
      );
    assert.ok(feedback.includes(`已检查 ${exercise.tests.length}/${exercise.tests.length} 组`));
    assert.equal(
      await js('return document.querySelector("[data-testid=practice-stdout]").textContent;'),
      exercise.tests.at(-1).expectedStdout,
    );
    const beforePlayback = await storageSnapshot();
    noExecutionPersistence(beforePlayback, initial);
    const start = await presentation();
    assert.equal(start.cursor, '0');
    assert.equal(start.sourceReadonly, true);
    assert.ok(start.source.includes('int main') && Number(start.length) >= 2);
    const first = await move(1, true);
    const second = await move(2, true);
    assert.deepEqual(await move(1, false), first);
    assert.deepEqual(await move(0, false), start);
    await selectOption(`${playerControls} select[aria-label="播放速度"]`, '4');
    await clickText('button', '播放');
    await until(
      'return Number(document.querySelector("[data-testid=player-controls]")?.dataset.cursor) > 0;',
    );
    const playing = await js(
      'return document.querySelector("[data-testid=player-controls]")?.dataset.playerStatus === "playing";',
    );
    if (playing) await clickText('button', '暂停');
    await until(
      'return document.querySelector("[data-testid=player-controls]")?.dataset.playerStatus !== "playing";',
    );
    const retained = await presentation();
    assert.ok(Number(retained.cursor) > 0);
    await clickText('a', '查看本次复盘');
    await until(
      'return location.hash.endsWith("/review") && document.querySelector("[data-testid=player-controls]");',
    );
    assert.deepEqual(await presentation(), retained);
    assert.equal(
      await js('return document.querySelector("[data-testid=practice-feedback]").textContent;'),
      feedback,
    );
    await clickText('a', '返回练习工作区');
    await until(
      'return !location.hash.endsWith("/review") && document.querySelector("[data-testid=practice-execution]")?.dataset.state === "passed" && document.querySelector("[aria-label=积木工作区] .blocklySvg");',
    );
    assert.deepEqual(await presentation(), retained);
    assert.deepEqual(await storageSnapshot(), beforePlayback);
    writeFileSync(
      join(output, `firefox-block-learning-${exercise.id}.png`),
      Buffer.from(await wd(`/session/${sessionId}/screenshot`), 'base64'),
    );
    await clickText('a', '返回本节学习');
    await until(
      'return document.querySelector("[data-testid=lesson-progress]")?.textContent.includes("小节已完成");',
    );
    await locallyReady();
    const completed = await storageSnapshot();
    assert.equal(
      completed.rows.progress.filter((row) => row.eventType === 'exercise.passed').length,
      index + 1,
    );
    assert.equal(
      completed.rows.progress.filter((row) => row.eventType === 'lesson.completed').length,
      index + 1,
    );
    assert.equal(completed.rows.receipts.length, (index + 1) * 3);
    noExecutionPersistence(completed, initial);
    checks.push({
      lessonId: lesson.id,
      exerciseId: exercise.id,
      frozenTests: exercise.tests.length,
      caseKeys: exercise.tests.map((test) => test.caseKey),
      feedback,
      source: start.source,
      expectedStdout: exercise.tests.at(-1).expectedStdout,
      sourceSha256: createHash('sha256').update(start.source).digest('hex'),
      traceLength: Number(start.length),
      firstTwoCursors: [first, second],
      retainedCursor: Number(retained.cursor),
      nativePlayAndExactTwoStepReversal: true,
      sameExerciseReviewRetained: true,
      reviewAndPlaybackWriteNothing: true,
      completedArchiveSha256: digest(completed),
    });
    console.log(
      `Stock Firefox: ${exercise.id}, ${exercise.tests.length} groups, native blocks and saved lesson completion passed.`,
    );
  }

  const finished = await storageSnapshot();
  const rows = finished.rows;
  assert.equal(rows.progress.length, 24);
  for (const type of [
    'lesson.started',
    'lesson.study-confirmed',
    'exercise.passed',
    'lesson.completed',
  ])
    assert.equal(rows.progress.filter((row) => row.eventType === type).length, 6);
  assert.equal(rows.receipts.length, 18);
  assert.equal(new Set(rows.receipts.map((row) => row.eventId)).size, 18);
  for (const type of ['lesson.started', 'lesson.study-confirmed', 'exercise.passed'])
    assert.equal(rows.receipts.filter((row) => row.eventType === type).length, 6);
  assert.equal(rows.receipts.filter((row) => row.eventType === 'lesson.completed').length, 0);
  assert.equal(rows.ledger.length, 12);
  assert.equal(rows.dailyFacts.length, 12);
  assert.equal(rows.ledger.filter((row) => row.status === 'posted').length, 0);
  assert.equal(rows.dailyFacts.filter((row) => row.eventType === 'exercise.passed').length, 6);
  assert.equal(rows.dailyFacts.filter((row) => row.eventType === 'lesson.completed').length, 6);
  noExecutionPersistence(finished, initial);
  await navigate('/courses');
  await until(
    'return document.querySelector("[data-testid=course-reading]")?.dataset.state === "ready";',
  );
  for (const lesson of reviewed.lessons)
    await until(
      'return [...document.querySelectorAll("[data-course-lesson]")].find(entry=>entry.dataset.courseLesson===arguments[0])?.textContent.includes("小节已完成");',
      [lesson.id],
    );
  const beforeRefresh = await storageSnapshot();
  assert.deepEqual(beforeRefresh, finished);
  await wd(`/session/${sessionId}/refresh`, 'POST', {});
  await until(
    'return document.querySelector("[data-testid=course-reading]")?.dataset.state === "ready";',
  );
  await locallyReady();
  const afterRefresh = await storageSnapshot();
  assert.deepEqual(afterRefresh, beforeRefresh);
  await navigate(`/practice/${reviewed.exercises[0].id}`);
  await until(
    'return document.querySelector("[data-testid=practice-execution]")?.dataset.state === "ready" && document.querySelector("[aria-label=积木工作区] .blocklySvg");',
  );
  await locallyReady();
  await until(
    'return [...document.querySelectorAll("[data-learning-subject]")].find(entry=>entry.dataset.learningSubject===arguments[0])?.textContent.includes("练习已通过");',
    [reviewed.exercises[0].id],
  );
  assert.equal(
    await js('return document.querySelector("[data-testid=practice-stdout]") === null;'),
    true,
  );
  assert.equal(
    await js('return document.querySelector("[data-testid=practice-execution]").dataset.state;'),
    'ready',
  );
  const final = await storageSnapshot();
  assert.deepEqual(final, finished);
  assert.equal(digest(beforeRefresh), digest(afterRefresh));
  report = {
    task: '09.4',
    passed: true,
    evidenceLevel: 'stock-Firefox-native-Blockly-learning-UI-and-readonly-nine-store-archive',
    capabilities,
    actions:
      'Native WebDriver select, text, button and link interactions. Browser scripts only read DOM and readonly IDB/local/session storage. No Blockly API, application import, test hook, seeded fact or IDB write.',
    boundary:
      'One real all-group pass per exercise, followed by minimal durable pass and derived completion. Twelve reward entitlements remain pending, with no posted points or enabled goal policy. Review checks compare exact retained presentation and unchanged archive; no Worker monkey patch or internal execution counter is installed.',
    previousFullReversalEvidence:
      '.artifacts/09.3/firefox-practice.json (09.3 stock Firefox full forward/reverse trace verification)',
    checks,
    nativeScrolls,
    frozenGroupTotal: checks.reduce((sum, check) => sum + check.frozenTests, 0),
    counts: {
      progress: 24,
      rootReceipts: 18,
      exercisePasses: 6,
      lessonCompletions: 6,
      pendingLedger: 12,
      dailyFacts: 12,
      postedEntries: 0,
    },
    receiptExplanation:
      'Each explicit study confirmation also records one lesson.started intention. Six started + six study-confirmed + six exercise.passed are the eighteen root receipts. lesson.completed is derived atomically and does not add a root receipt.',
    refreshPreservesHistoryWithoutNewFacts: true,
    refreshDoesNotRestoreEphemeralExecution: true,
    initial,
    finished,
    beforeRefresh,
    afterRefresh,
    final,
    beforeRefreshSha256: digest(beforeRefresh),
    afterRefreshSha256: digest(afterRefresh),
    finalSha256: digest(final),
  };
} catch (error) {
  failure = error;
  const page = sessionId
    ? await js('return {url:location.href,text:document.body.innerText};').catch(() => null)
    : null;
  report = {
    task: '09.4',
    passed: false,
    capabilities,
    checks,
    nativeScrolls,
    error: { message: error.message, stack: error.stack },
    page,
  };
} finally {
  if (sessionId) await wd(`/session/${sessionId}`, 'DELETE').catch(() => {});
  const cleanup = await Promise.allSettled([stopOwned(driver), stopOwned(server)]);
  const cleanupFailure = cleanup.find((result) => result.status === 'rejected');
  if (cleanupFailure) {
    failure ??= cleanupFailure.reason;
    report = { ...report, passed: false, cleanupError: String(cleanupFailure.reason) };
  }
  if (report) {
    report.ownedServicesStopped = !cleanupFailure;
    writeFileSync(
      join(output, 'firefox-block-learning.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  writeFileSync(join(output, 'firefox-block-learning-services.log'), serviceLog);
}
if (failure) throw failure;
console.log(
  `Stock Firefox ${capabilities.browserVersion}: six lessons, 24 real groups, native block edits, review, 18 root receipts, 12 pending rights and unchanged refresh archive passed.`,
);
