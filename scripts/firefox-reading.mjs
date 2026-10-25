// Stock Firefox 09.2 acceptance. Native public UI actions and read-only IDB inspection.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceDir } from './process.mjs';
import { checkEnvironment } from './environment.mjs';

checkEnvironment({ bindgen: true });
const output = join(workspaceDir, '.artifacts/09.2');
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
const serverPort = 4178;
const driverPort = 4452;
const origin = `http://127.0.0.1:${serverPort}`;
const driverOrigin = `http://127.0.0.1:${driverPort}`;
const first = 'lesson.c.variables-output';
const second = 'lesson.c.expressions';
assert.ok(existsSync(binary) && existsSync(executable));
mkdirSync(output, { recursive: true });

// Refuse to reuse another task's service or driver. Both children below are ours.
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
      /* owned service startup */
    }
    await delay(100);
  }
  throw new Error(`09.2 owned QA service did not start: ${childErrors}`);
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
  throw new Error(`09.2 Firefox expected UI state was not reached: ${script}`);
}

async function clickText(tag, text) {
  assert.ok(['button', 'a'].includes(tag));
  assert.ok(!text.includes("'"));
  const element = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'xpath',
    value: `//${tag}[normalize-space(.)='${text}']`,
  });
  await wd(
    `/session/${sessionId}/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`,
    'POST',
    {},
  );
}

async function navigate(path) {
  await wd(`/session/${sessionId}/url`, 'POST', { url: `${origin}/#${path}` });
  await until(
    'return document.querySelector("[data-testid=learning-save-status]")?.dataset.saveStatus === "ready";',
  );
}

async function lessonReady(id) {
  await navigate(`/lessons/${id}`);
  await until(
    'return document.querySelector("[data-testid=lesson-reading]")?.dataset.state === "ready";',
  );
}

async function savedProgress(text) {
  await until(
    'return document.querySelector("[data-testid=lesson-progress]")?.textContent.includes(arguments[0]) && document.querySelector("[data-testid=learning-save-status]")?.dataset.saveStatus === "ready" && document.querySelector("[data-testid=learning-save-status]")?.textContent.includes("已保存");',
    [text],
  );
}

async function storageSnapshot() {
  const snapshot = await wd(`/session/${sessionId}/execute/async`, 'POST', {
    script: String.raw`
const done=arguments[arguments.length-1];const open=indexedDB.open('c-viz-learning');
open.onerror=()=>done({error:'open'});open.onsuccess=()=>{
 const db=open.result,names=[...db.objectStoreNames],rows={},tx=db.transaction(names,'readonly');
 for(const name of names){const request=tx.objectStore(name).getAll();request.onsuccess=()=>rows[name]=request.result;}
 tx.oncomplete=()=>{db.close();done({rows,local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))});};
 tx.onabort=()=>{db.close();done({error:'transaction'});};};`,
    args: [],
  });
  assert.equal(snapshot.error, undefined);
  return snapshot;
}

function readingOnly(snapshot, expectedFacts) {
  assert.equal(snapshot.rows.progress.length, expectedFacts);
  assert.equal(snapshot.rows.receipts.length, expectedFacts);
  for (const store of ['progress', 'receipts'])
    assert.ok(
      snapshot.rows[store].every((row) =>
        ['lesson.started', 'lesson.study-confirmed'].includes(row.eventType),
      ),
    );
  assert.deepEqual(snapshot.rows.ledger, []);
  assert.deepEqual(snapshot.rows.dailyFacts, []);
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([
    stopped,
    delay(5000).then(() => {
      throw new Error(`09.2 owned child ${child.pid} did not exit after termination.`);
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
  // No supplied profile: geckodriver creates a fresh, isolated Firefox profile.
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
  await lessonReady(first);
  assert.equal(
    await js('return document.querySelector("[data-testid=lesson-progress]").textContent;'),
    '未开始',
  );
  const initial = await storageSnapshot();
  readingOnly(initial, 0);
  assert.deepEqual(initial.rows.goals, []);
  await wd(`/session/${sessionId}/refresh`, 'POST', {});
  await until(
    'return document.querySelector("[data-testid=lesson-reading]")?.dataset.state === "ready" && document.querySelector("[data-testid=learning-save-status]")?.dataset.saveStatus === "ready";',
  );
  assert.deepEqual(await storageSnapshot(), initial);

  await clickText('button', '开始本节学习');
  await savedProgress('已开始');
  const started = await storageSnapshot();
  readingOnly(started, 1);
  assert.equal(started.rows.progress[0].eventType, 'lesson.started');
  assert.deepEqual(started.rows.progress[0].subjectRef, { id: first, version: '1.0.1' });

  await clickText('button', '确认已学习');
  await savedProgress('已确认学习');
  const confirmed = await storageSnapshot();
  readingOnly(confirmed, 2);
  assert.deepEqual(confirmed.rows.progress.map((row) => row.eventType).sort(), [
    'lesson.started',
    'lesson.study-confirmed',
  ]);
  assert.ok(confirmed.rows.progress.every((row) => row.subjectRef.id === first));
  assert.equal(
    await js(
      'return document.querySelector("[data-testid=lesson-progress]").textContent.includes("小节已完成");',
    ),
    false,
  );
  assert.equal(
    await js(
      'return [...document.querySelectorAll("button")].find(button=>button.textContent.trim()==="确认已学习").disabled;',
    ),
    true,
  );
  await wd(`/session/${sessionId}/refresh`, 'POST', {});
  await until(
    'return document.querySelector("[data-testid=lesson-reading]")?.dataset.state === "ready" && document.querySelector("[data-testid=lesson-progress]")?.textContent.includes("已确认学习") && document.querySelector("[data-testid=learning-save-status]")?.dataset.saveStatus === "ready";',
  );
  const refreshed = await storageSnapshot();
  assert.deepEqual(refreshed, confirmed);
  assert.equal(digest(refreshed), digest(confirmed));

  await lessonReady(second);
  assert.equal(
    await js('return document.querySelector("[data-testid=lesson-progress]").textContent;'),
    '未开始',
  );
  assert.deepEqual(await storageSnapshot(), confirmed);
  await clickText('button', '开始本节学习');
  await savedProgress('已开始');
  const independent = await storageSnapshot();
  readingOnly(independent, 3);
  assert.deepEqual(
    independent.rows.progress.filter((row) => row.subjectRef.id === first),
    confirmed.rows.progress,
  );
  assert.equal(independent.rows.progress.filter((row) => row.subjectRef.id === second).length, 1);

  const continuation = [];
  for (const path of ['/courses', '/']) {
    await navigate(path);
    const href = await until(
      'return [...document.querySelectorAll("a")].find(link=>link.textContent.trim()==="继续学习")?.getAttribute("href");',
    );
    assert.equal(href, `#/lessons/${second}`);
    continuation.push({ path, href });
    assert.deepEqual(await storageSnapshot(), independent);
  }
  await clickText('a', '继续学习');
  await until(
    'return location.hash === arguments[0] && document.querySelector("[data-testid=lesson-progress]")?.textContent === "已开始";',
    [`#/lessons/${second}`],
  );
  assert.deepEqual(await storageSnapshot(), independent);
  const screenshot = await wd(`/session/${sessionId}/screenshot`);
  writeFileSync(join(output, 'firefox-reading.png'), Buffer.from(screenshot, 'base64'));
  writeFileSync(
    join(output, 'firefox-reading.json'),
    JSON.stringify(
      {
        task: '09.2',
        evidenceLevel: 'stock-Firefox-real-production-reading-native-IDB',
        capabilities: session.capabilities,
        actions: 'Native WebDriver button/link clicks; no product test hooks or synthetic facts.',
        boundary:
          'Only real lesson start and study confirmation. No exercise pass, lesson completion, ledger or daily learning fact claimed.',
        checks: {
          passiveOpeningAndRefreshWriteNothing: true,
          explicitStart: true,
          explicitConfirmation: true,
          byteEquivalentArchiveAfterRefresh: true,
          independentSecondLesson: true,
          continuation,
        },
        snapshots: { initial, started, confirmed, refreshed, independent },
        confirmedSha256: digest(confirmed),
        refreshedSha256: digest(refreshed),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Stock Firefox ${session.capabilities.browserVersion}: real reading, explicit start/confirmation, refresh persistence, independent lesson and both continue links passed.`,
  );
} catch (error) {
  const page = sessionId
    ? await js('return {url:location.href,text:document.body.innerText};').catch(() => null)
    : null;
  if (sessionId) {
    const screenshot = await wd(`/session/${sessionId}/screenshot`).catch(() => null);
    if (screenshot)
      writeFileSync(join(output, 'firefox-reading-failure.png'), Buffer.from(screenshot, 'base64'));
  }
  writeFileSync(
    join(output, 'firefox-reading-failure.json'),
    JSON.stringify({ message: error.message, stack: error.stack, page, childErrors }, null, 2) +
      '\n',
  );
  throw error;
} finally {
  if (sessionId) await wd(`/session/${sessionId}`, 'DELETE').catch(() => {});
  // Stop the independently owned children even when the other cleanup fails.
  const results = await Promise.allSettled([stopOwned(driver), stopOwned(server)]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) cleanupFailure = failure.reason;
}
if (cleanupFailure) throw cleanupFailure;
