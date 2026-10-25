// Stock Firefox 09.3 acceptance: native public UI and read-only production IDB.
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
const output = join(workspaceDir, '.artifacts/09.3');
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
const serverPort = 4178;
const driverPort = 4452;
const origin = `http://127.0.0.1:${serverPort}`;
const driverOrigin = `http://127.0.0.1:${driverPort}`;
const reviewed = JSON.parse(
  readFileSync(join(workspaceDir, 'content/c/p0/course-1.0.1.json'), 'utf8'),
);
const answers = {
  'exercise.c.echo': { outputSource: 'x', inputStyle: 'copy-zero' },
  'exercise.c.two-x-plus-three': {
    multiplier: '2',
    constant: '3',
    operation: '+',
    operandOrder: 'x-first',
  },
  'exercise.c.nonnegative': { comparison: '>=', thenValue: '1', elseValue: '0' },
  'exercise.c.two-loop-sums': { whileBoundary: '<=', forBoundary: '<=', direction: 'descending' },
  'exercise.c.increment-at-index': { increment: '1' },
  'exercise.c.array-sum': { initial: '0', inputStyle: 'copy-zero', direction: 'descending' },
};
assert.ok(existsSync(binary) && existsSync(executable));
mkdirSync(output, { recursive: true });

// Never attach to or terminate a service owned by another check/window.
for (const port of [serverPort, driverPort])
  await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });

let server;
let driver;
let sessionId;
let childErrors = '';
let cleanupFailure;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function ownedChild(command, args) {
  const child = spawn(command, args, { cwd: workspaceDir, stdio: 'pipe', windowsHide: true });
  child.on('error', (error) => {
    childErrors += `${error.message}\n`;
  });
  child.stderr.on('data', (data) => {
    childErrors += data.toString();
  });
  return child;
}

async function service(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, childErrors);
    try {
      if ((await fetch(url, { signal: globalThis.AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* owned child startup */
    }
    await delay(100);
  }
  throw new Error(`09.3 owned QA service did not start: ${childErrors}`);
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
async function until(script, args = [], attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await js(script, args);
    if (value) return value;
    await delay(50);
  }
  throw new Error(`09.3 Firefox expected UI state was not reached: ${script}`);
}

async function element(selector) {
  const found = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'css selector',
    value: selector,
  });
  return found['element-6066-11e4-a52e-4f735466cecf'];
}
async function click(selector) {
  await wd(`/session/${sessionId}/element/${await element(selector)}/click`, 'POST', {});
}
async function clickText(tag, text) {
  assert.ok(['button', 'a'].includes(tag));
  assert.ok(!text.includes("'"));
  const found = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'xpath',
    value: `//${tag}[normalize-space(.)='${text}']`,
  });
  await wd(
    `/session/${sessionId}/element/${found['element-6066-11e4-a52e-4f735466cecf']}/click`,
    'POST',
    {},
  );
}

async function navigate(path) {
  await wd(`/session/${sessionId}/url`, 'POST', { url: `${origin}/#${path}` });
}
async function practiceReady(id) {
  await navigate(`/practice/${id}`);
  await until(
    'return document.querySelector("[data-testid=practice-execution]")?.dataset.state === "ready";',
  );
}
async function choose(values) {
  for (const [name, value] of Object.entries(values)) {
    const selector = `[data-testid=practice-execution] [data-answer-field="${name}"]`;
    const isSelect = await js('return document.querySelector(arguments[0]).tagName === "SELECT";', [
      selector,
    ]);
    if (isSelect) await click(`${selector} option[value="${value}"]`);
    else {
      const id = await element(selector);
      await wd(`/session/${sessionId}/element/${id}/clear`, 'POST', {});
      await wd(`/session/${sessionId}/element/${id}/value`, 'POST', { text: value });
    }
  }
}
async function submit(expected) {
  await clickText('button', '准备代码');
  await until(
    'return document.querySelector("[data-testid=practice-execution]")?.dataset.state === "ready" && [...document.querySelectorAll("[data-testid=practice-execution] button")].some(button=>button.textContent.trim()==="提交练习" && !button.disabled);',
  );
  await clickText('button', '提交练习');
  return until(
    'const panel=document.querySelector("[data-testid=practice-execution]");return panel?.dataset.state === arguments[0] && document.querySelector("[data-testid=practice-feedback]")?.textContent;',
    [expected],
  );
}

async function noAcceptedResult() {
  await until(
    'return document.querySelector("[data-testid=practice-feedback] h3")?.textContent === "本次提交与反馈" && !document.querySelector("[data-testid=practice-stdout]") && !document.querySelector("[data-testid=source-step-highlight]");',
  );
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

async function presentation() {
  return js(String.raw`return {
 cursor:document.querySelector('[data-testid=player-controls]')?.dataset.cursor,
 length:document.querySelector('[data-testid=player-controls]')?.dataset.length,
 source:document.querySelector('textarea[aria-label="当前执行的 C 代码"]')?.value,
 variables:[...document.querySelectorAll('[data-testid=trace-variable]')].map(e=>({name:e.dataset.name,value:e.dataset.value})),
 arrays:[...document.querySelectorAll('[data-testid=trace-array]')].map(e=>({name:e.dataset.name,cells:[...e.querySelectorAll('[data-testid=trace-array-cell]')].map(c=>({index:c.dataset.index,value:c.dataset.value}))})),
 output:document.querySelector('[data-testid=step-output]')?.dataset.output,
 stepLocation:document.querySelector('[data-testid=source-location]')?.textContent,
 counters:document.querySelector('[data-testid=step-counters]')?.textContent
};`);
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([
    stopped,
    delay(5000).then(() => {
      throw new Error(`09.3 owned child ${child.pid} did not exit after termination.`);
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
  await wd(`/session/${sessionId}/window/rect`, 'POST', { width: 1440, height: 1000 });
  await wd(`/session/${sessionId}/timeouts`, 'POST', { script: 30000, pageLoad: 30000 });
  await navigate('/settings?panel=display');
  await until(
    'return document.querySelector("[data-testid=learning-save-status]")?.dataset.saveStatus === "ready";',
  );
  const initial = await storageSnapshot();
  for (const store of ['progress', 'receipts', 'ledger', 'dailyFacts'])
    assert.deepEqual(initial.rows[store], []);
  const checks = [];
  for (const exercise of reviewed.exercises) {
    await practiceReady(exercise.id);
    const incorrect = await submit('unmet');
    assert.match(incorrect, /未满足|未通过/);
    assert.match(incorrect, /检查|教学|目标/);
    assert.deepEqual(await storageSnapshot(), initial);
    await choose(answers[exercise.id]);
    await noAcceptedResult();
    const correct = await submit('passed');
    assert.match(correct, /通过|满足/);
    assert.ok(correct.includes(exercise.tests.at(-1).caseKey));
    assert.equal(
      await js(
        'return document.querySelectorAll("[data-testid=practice-execution] textarea:not([readonly]), [data-testid=practice-execution] [contenteditable=true]").length;',
      ),
      0,
    );
    const start = await presentation();
    assert.equal(start.cursor, '0');
    assert.ok(Number(start.length) > 0);
    // Native controls consume the accepted trace. No time mocking or generated trace.
    const frames = [start];
    for (let cursor = 1; cursor <= Number(start.length); cursor++) {
      await click('[data-testid=player-controls] button[aria-keyshortcuts=ArrowRight]');
      await until(
        'return document.querySelector("[data-testid=player-controls]")?.dataset.cursor === arguments[0];',
        [String(cursor)],
      );
      frames.push(await presentation());
    }
    assert.equal(frames.at(-1).output, exercise.tests.at(-1).expectedStdout);
    for (let cursor = Number(start.length) - 1; cursor >= 0; cursor--) {
      await click('[data-testid=player-controls] button[aria-keyshortcuts=ArrowLeft]');
      await until(
        'return document.querySelector("[data-testid=player-controls]")?.dataset.cursor === arguments[0];',
        [String(cursor)],
      );
      assert.deepEqual(await presentation(), frames[cursor]);
    }
    await click('[data-testid=player-controls] button[aria-keyshortcuts=ArrowRight]');
    const retained = await presentation();
    await clickText('a', '查看本次复盘');
    await until(
      'return location.hash.endsWith("/review") && document.querySelector("[data-testid=player-controls]");',
    );
    assert.deepEqual(await presentation(), retained);
    await clickText('a', '返回练习工作区');
    await until(
      'return !location.hash.endsWith("/review") && document.querySelector("[data-testid=practice-execution]")?.dataset.state === "passed";',
    );
    assert.deepEqual(await presentation(), retained);
    assert.deepEqual(await storageSnapshot(), initial);
    checks.push({
      exerciseId: exercise.id,
      frozenTests: exercise.tests.length,
      incorrect,
      correct,
      replayedCursors: frames.length,
      sameExerciseReviewRetained: true,
    });
    writeFileSync(
      join(output, `firefox-practice-${exercise.id}.png`),
      Buffer.from(await wd(`/session/${sessionId}/screenshot`), 'base64'),
    );
    // A true departure must invalidate the prior in-memory accepted session.
    await navigate('/courses');
    await until(
      'return document.querySelector("main [data-testid=course-reading]")?.dataset.state === "ready";',
    );
    await practiceReady(exercise.id);
    await noAcceptedResult();
  }
  await practiceReady(reviewed.exercises[0].id);
  await choose(answers[reviewed.exercises[0].id]);
  await submit('passed');
  await wd(`/session/${sessionId}/refresh`, 'POST', {});
  await until(
    'return document.querySelector("[data-testid=practice-execution]")?.dataset.state === "ready";',
  );
  await noAcceptedResult();
  await navigate(`/practice/${reviewed.exercises[0].id}/review`);
  await noAcceptedResult();
  await until('return document.body.innerText.includes("还没有可复盘的运行");');
  const final = await storageSnapshot();
  assert.deepEqual(final, initial);
  writeFileSync(
    join(output, 'firefox-practice.json'),
    JSON.stringify(
      {
        task: '09.3',
        evidenceLevel: 'stock-Firefox-real-production-practice-native-IDB',
        capabilities: session.capabilities,
        actions:
          'Native WebDriver finite answer controls, submissions, playback, review/return, departure and refresh. Read-only DOM/IDB inspection; no synthetic exercise pass rows.',
        boundary:
          'Temporary real judge results only. No exercise.passed, lesson completion or reward persistence claimed.',
        checks,
        refreshDestroysSession: true,
        initial,
        final,
        initialSha256: digest(initial),
        finalSha256: digest(final),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Stock Firefox ${session.capabilities.browserVersion}: six exercises/24 frozen tests, incorrect feedback, full trace reversal, same-exercise review and unchanged nine-store archive passed.`,
  );
} catch (error) {
  const page = sessionId
    ? await js('return {url:location.href,text:document.body.innerText};').catch(() => null)
    : null;
  if (sessionId) {
    const screenshot = await wd(`/session/${sessionId}/screenshot`).catch(() => null);
    if (screenshot)
      writeFileSync(
        join(output, 'firefox-practice-failure.png'),
        Buffer.from(screenshot, 'base64'),
      );
  }
  writeFileSync(
    join(output, 'firefox-practice-failure.json'),
    JSON.stringify({ message: error.message, stack: error.stack, page, childErrors }, null, 2) +
      '\n',
  );
  throw error;
} finally {
  if (sessionId) await wd(`/session/${sessionId}`, 'DELETE').catch(() => {});
  const results = await Promise.allSettled([stopOwned(driver), stopOwned(server)]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) cleanupFailure = failure.reason;
}
if (cleanupFailure) throw cleanupFailure;
