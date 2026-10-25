// Stock Firefox 11.3 profile regression: native Blockly/learning UI and readonly storage inspection.
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
  throw new Error(`11.3 owned QA service did not start: ${serviceLog}`);
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
  throw new Error(`11.3 Firefox expected UI state was not reached: ${script}`);
}
async function element(selector) {
  return (
    await wd(`/session/${sessionId}/element`, 'POST', { using: 'css selector', value: selector })
  )[elementKey];
}
async function click(selector) {
  await wd(`/session/${sessionId}/element/${await element(selector)}/click`, 'POST', {});
}
async function stableClickBounds(found) {
  // Observe only. Eight unchanged animation frames cover a completed native
  // wheel scroll and layout before WebDriver performs the one actual click.
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
  scrollX,scrollY,inViewport,clickable:inViewport&&!!hit&&(hit===target||target.contains(hit)),hitTag:hit?.tagName??null};
}
function frame(){
 const current=measure();frames++;
 const geometry=['left','top','targetWidth','targetHeight','width','height','scrollX','scrollY'];
 const unchanged=previous&&geometry.every(key=>Math.abs(current[key]-previous[key])<=0.25);
 stableFrames=unchanged?stableFrames+1:0;
 if(stableFrames>=8||frames>=180){done({...current,stable:stableFrames>=8,stableFrames,frames});return;}
 previous=current;requestAnimationFrame(frame);
}
requestAnimationFrame(frame);`,
    args: [found],
  });
}
async function clickText(tag, text) {
  assert.ok(['button', 'a'].includes(tag) && !text.includes("'"));
  const found = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'xpath',
    value: `//${tag}[normalize-space(.)='${text}']`,
  });
  // Native wheel input may finish before Firefox's smooth scroll or layout.
  // Position and hit-test the target before the single native element click;
  // no failed click is retried and no browser script moves or activates it.
  let bounds = await stableClickBounds(found);
  for (let adjustment = 0; adjustment < 4; adjustment++) {
    assert.equal(bounds.stable, true, `Unstable target before native click: ${text}`);
    const centered = Math.abs(bounds.centerY - bounds.height / 2) <= bounds.height / 4;
    if (bounds.clickable && (centered || adjustment > 0)) break;
    const deltaY = Math.round(bounds.centerY - bounds.height / 2);
    assert.notEqual(deltaY, 0, `Target is obscured at the viewport center: ${text}`);
    const before = bounds;
    await wd(`/session/${sessionId}/actions`, 'POST', {
      actions: [
        {
          type: 'wheel',
          id: 'page-wheel',
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
  // Re-read after positioning, so the recorded final position itself is stable
  // and its center is inside the viewport and points to the intended element.
  const finalBounds = await stableClickBounds(found);
  assert.equal(finalBounds.stable, true, `Unstable target at native click: ${text}`);
  assert.equal(finalBounds.inViewport, true, `Target center remains outside viewport: ${text}`);
  assert.equal(finalBounds.clickable, true, `Target center remains obscured: ${text}`);
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
async function unrunWorkspace(kind) {
  const state = await js(
    String.raw`const source=document.querySelector('[data-testid=code-panel] textarea');
return {phase:document.querySelector('[data-testid="'+arguments[0]+'-execution"]')?.dataset.state,
 source:source?.value??'',readonly:source?.readOnly??false,
 available:[...document.querySelectorAll('button')].some(button=>button.textContent.trim()===arguments[1]&&!button.disabled),
 length:document.querySelector('[data-testid=player-controls]')?.dataset.length,
 output:document.querySelectorAll('[data-testid=execution-output],[data-testid=practice-stdout],[data-testid=step-output]').length,
 wasmRequests:performance.getEntriesByType('resource').filter(entry=>/\.wasm(?:\?|$)/.test(entry.name)).length};`,
    [kind, kind === 'case' ? '运行示例' : '提交练习'],
  );
  assert.equal(state.phase, 'ready');
  assert.ok(state.source.includes('int main(void)'));
  assert.equal(state.readonly, true);
  assert.equal(state.available, true);
  assert.equal(state.length, '0');
  assert.equal(state.output, 0);
  return state;
}
async function profile(level, points, preset = 'avatar.basic.01', color = '#168A72') {
  await navigate('/');
  await locallyReady();
  await until(
    'return document.querySelector("[data-testid=learning-level]")?.dataset.level === arguments[0] && document.querySelector("[data-testid=learning-posted-points]")?.textContent.trim() === arguments[1];',
    [String(level), String(points)],
  );
  const current = await js(String.raw`return {
    level:document.querySelector('[data-testid=learning-level]')?.dataset.level,
    levelText:document.querySelector('[data-testid=learning-level]')?.textContent,
    points:document.querySelector('[data-testid=learning-posted-points]')?.textContent.trim(),
    preset:document.querySelector('[data-testid=learning-avatar]')?.dataset.avatarPreset,
    color:document.querySelector('[data-testid=learning-avatar]')?.dataset.avatarColor,
    progress:document.querySelector('[data-testid=learning-course-progress]')?.textContent.trim(),
    levelProgress:document.querySelector('[data-testid=learning-level-progress]')?.textContent,
    pending:document.querySelector('[data-testid=learning-pending-rewards]')?.textContent.trim(),
    continueHref:document.querySelector('[data-testid=home-continue-learning]')?.getAttribute('href')
  };`);
  assert.equal(current.preset, preset);
  assert.equal(current.color, color);
  assert.ok(current.levelText.includes(`Lv.${level}`));
  assert.equal(current.pending, '0');
  return current;
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
  const before = await unrunWorkspace('practice');
  await clickText('button', '准备代码');
  await until(
    'return document.querySelector("[data-testid=practice-execution]")?.dataset.state === "ready" && [...document.querySelectorAll("[data-testid=practice-execution] button")].some(button=>button.textContent.trim()==="提交练习" && !button.disabled);',
  );
  assert.equal((await unrunWorkspace('practice')).wasmRequests, before.wasmRequests);
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
      (row) =>
        row.status === 'posted' &&
        row.points ===
          (row.sourceId === 'reward.exercise.first-pass'
            ? 10
            : row.sourceId === 'reward.lesson.first-completion'
              ? 20
              : 5) &&
        row.policyRef.id ===
          (row.sourceId === 'reward.daily-goal.once'
            ? 'reward.policy.daily-goal.p0'
            : 'reward.policy.p0'),
    ),
  );
  assert.deepEqual(snapshot.rows.settings[0].goalTemplate, {
    revision: 1,
    targets: { exercise: 1, lesson: 1, case: 0 },
  });
  assert.ok(
    snapshot.rows.goals.every(
      (goal) => goal.targets.exercise === 1 && goal.targets.lesson === 1 && goal.targets.case === 0,
    ),
  );
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
      throw new Error(`11.3 owned child ${child.pid} did not exit after termination.`);
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
  const initialProfile = await profile(1, 0);
  assert.equal(initialProfile.continueHref, `#/lessons/${reviewed.lessons[0].id}`);
  const levelObservations = [{ stage: 'fresh-profile', ...initialProfile }];

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
    const initialWorkspace = await unrunWorkspace('practice');
    if (index === 0) assert.equal(initialWorkspace.wasmRequests, 0);
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
      join(output, `firefox-profile-${exercise.id}.png`),
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
    const points = completed.rows.ledger.reduce((sum, row) => sum + row.points, 0);
    const currentLevel = points >= 100 ? 3 : points >= 30 ? 2 : 1;
    const learnedProfile = await profile(currentLevel, points);
    levelObservations.push({ stage: `completed-${index + 1}-lessons`, ...learnedProfile });
    assert.equal(
      learnedProfile.continueHref,
      `#/lessons/${reviewed.lessons[index + 1]?.id ?? lesson.id}`,
    );
    assert.deepEqual(await storageSnapshot(), completed);
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
  assert.equal(rows.ledger.length, 13);
  assert.equal(rows.dailyFacts.length, 12);
  assert.equal(rows.ledger.filter((row) => row.status === 'posted').length, 13);
  assert.equal(
    rows.ledger.reduce((sum, row) => sum + row.points, 0),
    185,
  );
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
  await unrunWorkspace('practice');
  assert.deepEqual(final, finished);
  assert.equal(digest(beforeRefresh), digest(afterRefresh));
  await navigate('/visualize/case.c.assignment');
  await until(
    'return document.querySelector("[data-testid=case-execution]")?.dataset.state === "ready";',
  );
  await locallyReady();
  await unrunWorkspace('case');
  assert.deepEqual(await storageSnapshot(), finished);
  await clickText('button', '运行示例');
  await until(
    'return document.querySelector("[data-testid=case-execution]")?.dataset.state === "completed";',
  );
  const viewLength = await js(
    'return Number(document.querySelector("[data-testid=player-controls]").dataset.length);',
  );
  assert.ok(viewLength > 0);
  const corePosition = await js(
    'const r=document.querySelector("[data-testid=trace-view] [aria-label=当前变量]").getBoundingClientRect();return {delta:Math.round(r.top+r.height/2-innerHeight/2),height:innerHeight,width:innerWidth};',
  );
  await wd(`/session/${sessionId}/actions`, 'POST', {
    actions: [
      {
        type: 'wheel',
        id: 'case-state-wheel',
        actions: [
          {
            type: 'scroll',
            x: corePosition.width - 20,
            y: Math.floor(corePosition.height / 2),
            deltaX: 0,
            deltaY: corePosition.delta,
            duration: 200,
          },
        ],
      },
    ],
  });
  await delay(150);
  const presentedCursors = [0];
  for (let cursor = 1; cursor <= viewLength; cursor++) {
    await clickText('button', '前进');
    await until(
      'return Number(document.querySelector("[data-testid=case-view-coverage]").dataset.covered)===arguments[0];',
      [cursor],
    );
    presentedCursors.push(cursor);
  }
  assert.deepEqual(await storageSnapshot(), finished);
  await until(
    'return document.querySelector("[data-testid=case-view-confirmation]").dataset.viewState === "ready";',
  );
  await clickText('button', '确认已观看');
  await until(
    'return document.querySelector("[data-testid=case-view-confirmation]").dataset.viewState === "saved";',
  );
  await locallyReady();
  const caseSaved = await storageSnapshot();
  assert.equal(caseSaved.rows.ledger.length, 14);
  assert.equal(
    caseSaved.rows.ledger.reduce((sum, row) => sum + row.points, 0),
    190,
  );
  assert.equal(
    caseSaved.rows.ledger.filter(
      (row) => row.sourceId === 'reward.case.first-view' && row.points === 5,
    ).length,
    1,
  );
  assert.equal(caseSaved.rows.receipts.length, 19);
  assert.equal(caseSaved.rows.dailyFacts.length, 13);
  await wd(`/session/${sessionId}/refresh`, 'POST', {});
  await until(
    'return document.querySelector("[data-testid=case-execution]")?.dataset.state === "ready";',
  );
  await locallyReady();
  await unrunWorkspace('case');
  assert.deepEqual(
    await js(
      'const coverage=document.querySelector("[data-testid=case-view-coverage]");return {covered:coverage.dataset.covered,total:coverage.dataset.total};',
    ),
    { covered: '0', total: '0' },
  );
  assert.deepEqual(await storageSnapshot(), caseSaved);
  const caseViewing = {
    presentedCursors,
    explicitConfirmation: true,
    firstCasePoints: 5,
    totalPoints: 190,
    refreshUnchanged: true,
    archive: caseSaved,
  };
  const fullProfile = await profile(3, 190);
  levelObservations.push({ stage: 'all-six-lessons-and-case', ...fullProfile });
  writeFileSync(
    join(output, 'firefox-profile-home-earned.png'),
    Buffer.from(await wd(`/session/${sessionId}/screenshot`), 'base64'),
  );
  await navigate('/settings?panel=avatar');
  await locallyReady();
  await until('return document.querySelectorAll("input[type=radio]").length === 4;');
  // Native WebDriver radio clicks and color-key entry; browser scripts remain readonly.
  const avatarVariants = [
    { presetId: 'avatar.basic.02', label: '芽苗', color: '#A246C8' },
    { presetId: 'avatar.basic.03', label: '方块', color: '#246AC8' },
    { presetId: 'avatar.basic.04', label: '星光', color: '#CA6432' },
    { presetId: 'avatar.basic.01', label: '嫩叶', color: '#168A72' },
  ];
  const avatarChecks = [];
  let previous = caseSaved;
  for (const variant of avatarVariants) {
    await click(`input[type=radio][aria-label="${variant.label}"]`);
    await fill('input[aria-label="强调色十六进制"]', variant.color);
    await until(
      'return document.querySelector("[data-testid=avatar-preview]")?.dataset.avatarPreset === arguments[0] && document.querySelector("[data-testid=avatar-preview]")?.dataset.avatarColor === arguments[1];',
      [variant.presetId, variant.color],
    );
    assert.deepEqual(await storageSnapshot(), previous);
    await clickText('button', '保存基础形象');
    await locallyReady();
    const saved = await storageSnapshot();
    assert.deepEqual(saved.rows.avatar, [
      { presetId: variant.presetId, accentColor: variant.color },
    ]);
    for (const store of [
      'settings',
      'progress',
      'receipts',
      'ledger',
      'dailyFacts',
      'goals',
      'aliases',
    ])
      assert.deepEqual(saved.rows[store], caseSaved.rows[store]);
    assert.equal(saved.rows.meta[0].generation, caseSaved.rows.meta[0].generation);
    const home = await profile(3, 190, variant.presetId, variant.color);
    await wd(`/session/${sessionId}/refresh`, 'POST', {});
    await locallyReady();
    await profile(3, 190, variant.presetId, variant.color);
    assert.deepEqual(await storageSnapshot(), saved);
    avatarChecks.push({
      ...variant,
      home,
      archive: saved,
      refreshUnchanged: true,
      noLearningSideEffects: true,
    });
    previous = saved;
    await navigate('/settings?panel=avatar');
    await locallyReady();
    await until(
      'return document.querySelector("[data-testid=avatar-preview]")?.dataset.avatarPreset === arguments[0];',
      [variant.presetId],
    );
  }
  writeFileSync(
    join(output, 'firefox-profile-settings.png'),
    Buffer.from(await wd(`/session/${sessionId}/screenshot`), 'base64'),
  );
  await profile(3, 190);
  writeFileSync(
    join(output, 'firefox-profile-home-restored.png'),
    Buffer.from(await wd(`/session/${sessionId}/screenshot`), 'base64'),
  );
  report = {
    task: '11.3',
    passed: true,
    evidenceLevel:
      'stock-Firefox-native-profile-Blockly-learning-UI-and-readonly-nine-store-archive',
    capabilities,
    actions:
      'Native WebDriver select, text, button and link interactions. Browser scripts only read DOM and readonly IDB/local/session storage. No Blockly API, application import, test hook, seeded fact or IDB write.',
    boundary:
      'One real all-group pass per exercise, followed by minimal durable pass and derived completion. Twelve first rewards and one daily goal reward are posted for 185 points. The daily goal is triggered by the real first complete lesson; its snapshot and reward survive refresh. Review checks compare exact retained presentation and unchanged archive; no Worker monkey patch or internal execution counter is installed.',
    caseViewing,
    profile: {
      thresholds: [0, 30, 100, 200, 400],
      levelObservations,
      avatarChecks,
      finalLevel: 3,
      finalPoints: 190,
    },
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
      pendingLedger: 0,
      dailyFacts: 12,
      postedEntries: 13,
      totalPoints: 185,
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
    task: '11.3',
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
    report.invocationEvidenceTask = evidenceTask;
    report.ownedServicesStopped = !cleanupFailure;
    writeFileSync(join(output, 'firefox-profile.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  writeFileSync(join(output, 'firefox-profile-services.log'), serviceLog);
}
if (failure) throw failure;
console.log(
  `Stock Firefox ${capabilities.browserVersion}: six lessons, 24 real groups, 185 earned points to Lv.3, genuine case viewing to 190, four saved preset/color changes and unchanged learning archive after refresh passed.`,
);
