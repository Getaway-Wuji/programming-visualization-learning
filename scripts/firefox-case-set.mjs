// Stock Firefox 08.4 acceptance. Only public developer inputs, no product hooks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { caseSetSamples } from '../tests/fixtures/case-set.ts';
import { workspaceDir } from './process.mjs';
import { checkEnvironment } from './environment.mjs';

checkEnvironment({ bindgen: true });
const output = join(workspaceDir, '.artifacts/08.4');
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
assert.ok(existsSync(binary) && existsSync(executable));
mkdirSync(output, { recursive: true });
for (const port of [4178, 4449])
  await new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(port, '127.0.0.1', () => socket.close(resolve));
  });
const server = spawn(process.execPath, ['scripts/serve-checks.mjs'], {
  cwd: workspaceDir,
  stdio: 'pipe',
  windowsHide: true,
});
const driver = spawn(executable, ['--host', '127.0.0.1', '--port', '4449', '--log', 'warn'], {
  cwd: workspaceDir,
  stdio: 'pipe',
  windowsHide: true,
});
let childErrors = '',
  sessionId;
for (const child of [server, driver]) {
  child.on('error', (error) => {
    childErrors += error.message;
  });
  child.stderr.on('data', (data) => {
    childErrors += data.toString();
  });
}
async function service(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, childErrors);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* owned service startup */
    }
    await delay(100);
  }
  throw new Error(`08.4 owned QA service did not start: ${childErrors}`);
}
async function wd(path, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:4449${path}`, {
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
async function until(script, args = [], attempts = 150) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await js(script, args);
    if (value) return value;
    await delay(50);
  }
  throw new Error('08.4 Firefox expected UI state was not reached.');
}
async function click(selector) {
  const element = await wd(`/session/${sessionId}/element`, 'POST', {
    using: 'css selector',
    value: selector,
  });
  await wd(
    `/session/${sessionId}/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`,
    'POST',
    {},
  );
}
async function playerButton(name) {
  await js(
    `const button=[...document.querySelectorAll('[data-testid=player-controls] button')].find(b=>b.textContent.trim()===arguments[0]);if(!button||button.disabled)throw Error('Unavailable player action');button.click();`,
    [name],
  );
}
async function key(value) {
  await wd(`/session/${sessionId}/actions`, 'POST', {
    actions: [
      {
        type: 'key',
        id: '08.4-keyboard',
        actions: [
          { type: 'keyDown', value },
          { type: 'keyUp', value },
        ],
      },
    ],
  });
}
const installation = String.raw`
const audit=window.__caseSetFirefox={records:[]};const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{
 constructor(...args){super(...args);this.record={kind:null,terminated:false};audit.records.push(this.record);
  this.addEventListener('message',event=>{if(this.record.kind==='execute'&&Object.prototype.toString.call(event.data.buffer)==='[object ArrayBuffer]'){
    this.record.resultBytes=Array.from(new Uint8Array(event.data.buffer));}});}
 postMessage(message,options=[]){this.record.kind=message.kind;if(message.kind==='execute'){
   this.record.requestBytes=Array.from(new Uint8Array(message.buffer));this.record.catalog=message.catalogJson;}
   super.postMessage(message,options);}
 terminate(){this.record.terminated=true;super.terminate();}
};`;
const snapshotScript = String.raw`
const view=document.querySelector('[data-testid=trace-view]');
const attributes=(element,names)=>Object.fromEntries(names.map(name=>[name,element.getAttribute('data-'+name)]));
return {cursor:Number(view.dataset.cursor),output:document.querySelector('[data-testid=step-output]').dataset.output,
 variables:[...view.querySelectorAll('[data-testid=trace-variable]')].map(e=>attributes(e,['object-id','name','scope-id','value','read','write'])),
 arrays:[...view.querySelectorAll('[data-testid=trace-array]')].map(e=>({...attributes(e,['object-id','name','logical-length']),cells:[...e.querySelectorAll('[data-testid=trace-array-cell]')].map(c=>attributes(c,['index','value','read','write']))})),
 counters:attributes(view.querySelector('[data-testid=step-counters]'),['comparisons','scalar-writes','array-writes','swaps']),
 marks:[...document.querySelectorAll('[data-testid=source-step-highlight]')].map(e=>attributes(e,['byte-start','byte-end','start','end']))};`;
async function storageSnapshot() {
  return wd(`/session/${sessionId}/execute/async`, 'POST', {
    script: String.raw`
const done=arguments[arguments.length-1];const open=indexedDB.open('c-viz-learning');
open.onerror=()=>done({error:'open'});open.onsuccess=()=>{
 const db=open.result,names=[...db.objectStoreNames],rows={},tx=db.transaction(names,'readonly');
 for(const name of names){const request=tx.objectStore(name).getAll();request.onsuccess=()=>rows[name]=request.result;}
 tx.oncomplete=()=>{db.close();done({rows,local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))});};
 tx.onabort=()=>done({error:'transaction'});};`,
    args: [],
  });
}
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function capture(sample) {
  await wd(`/session/${sessionId}/url`, 'POST', { url: 'about:blank' });
  await wd(`/session/${sessionId}/url`, 'POST', { url: 'http://127.0.0.1:4178/#/cases' });
  await until(
    'return !!document.querySelector("main [data-testid=content-sample][data-state=ready]");',
  );
  await js(installation);
  await js('location.hash=arguments[0];', [`#/visualize/${sample.caseId}`]);
  await until('return !!document.querySelector("[data-testid=input-panel]");');
  const before = await storageSnapshot();
  assert.equal(before.error, undefined);
  for (const [name, value] of Object.entries(sample.values)) {
    await js(
      `const field=document.querySelector(arguments[0]);
      Object.getOwnPropertyDescriptor(field.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(field,arguments[1]);
      field.dispatchEvent(new Event('input',{bubbles:true}));`,
      [
        `[data-testid=input-field-${name}]`,
        Array.isArray(value) ? (value.length ? value.join(', ') : '[]') : String(value),
      ],
    );
  }
  await click('[data-testid=input-panel] button.button-primary');
  await until(
    'return document.querySelector("[data-testid=case-execution]")?.dataset.state==="ready";',
  );
  await click('[data-testid=case-execution] > .inline-actions button.button-primary');
  await until(
    'return ["completed","resource-limit","program-error","infrastructure-failure"].includes(document.querySelector("[data-testid=case-execution]")?.dataset.state);',
  );
  const record = await js('return window.__caseSetFirefox.records.find(r=>r.kind==="execute");');
  const requestBytes = Uint8Array.from(record.requestBytes),
    resultBytes = Uint8Array.from(record.resultBytes);
  const request = JSON.parse(new TextDecoder().decode(requestBytes));
  const result = JSON.parse(new TextDecoder().decode(resultBytes));
  const displayed = await js('return document.querySelector(arguments[0]).value;', [
    '[aria-label="当前执行的 C 代码"]',
  ]);
  assert.equal(record.terminated, true);
  assert.equal(result.producer, 'rust');
  assert.equal(result.terminal.status, 'completed');
  assert.equal(result.terminal.exitCode, 0);
  assert.deepEqual(result.identity, request.identity);
  assert.deepEqual(request.input.values, sample.values);
  assert.equal(displayed, request.source.text);
  assert.equal(
    await js('return document.querySelector("[data-testid=execution-output]").textContent;'),
    sample.stdout,
  );
  const length = result.trace.steps.length;
  const snapshots = [await js(snapshotScript)];
  assert.equal(snapshots[0].cursor, 0);
  await js('document.querySelector("[data-testid=player-workspace]").focus();');
  for (let cursor = 1; cursor <= length; cursor++) {
    await key('\uE014');
    const snapshot = await js(snapshotScript);
    assert.equal(snapshot.cursor, cursor);
    assert.ok(snapshot.marks.length > 0);
    snapshots.push(snapshot);
  }
  assert.equal(snapshots.at(-1).output, sample.stdout);
  if (sample.finalArray)
    assert.deepEqual(
      snapshots.at(-2).arrays[0].cells.map((c) => Number(c.value)),
      sample.finalArray,
    );
  for (let cursor = length - 1; cursor >= 0; cursor--) {
    await key('\uE012');
    assert.deepEqual(await js(snapshotScript), snapshots[cursor]);
  }
  const rates = sample.caseId === 'case.c.assignment' ? [0.25, 1, 4] : [4];
  for (const rate of rates) {
    await js(
      `const select=document.querySelector('[data-testid=player-controls] select');select.value=String(arguments[0]);select.dispatchEvent(new Event('change',{bubbles:true}));`,
      [rate],
    );
    await playerButton('重播');
    await until(
      'return document.querySelector("[data-testid=player-controls]")?.dataset.playerStatus==="ended";',
      [],
      Math.ceil((length * 500) / rate / 50) + 100,
    );
    assert.deepEqual(await js(snapshotScript), snapshots.at(-1));
  }
  const after = await storageSnapshot();
  assert.deepEqual(after, before);
  assert.equal(
    await js('return window.__caseSetFirefox.records.filter(r=>r.kind==="execute").length;'),
    1,
  );
  const screenshot = await wd(`/session/${sessionId}/screenshot`);
  writeFileSync(join(output, `firefox-${sample.key}.png`), Buffer.from(screenshot, 'base64'));
  const directory = join(output, 'stock-captures', sample.key);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'request.json'), requestBytes);
  writeFileSync(join(directory, 'result.json'), resultBytes);
  writeFileSync(join(directory, 'catalog.json'), record.catalog);
  writeFileSync(join(directory, 'source.c'), displayed);
  return {
    key: sample.key,
    caseId: sample.caseId,
    identity: result.identity,
    steps: length,
    forward: length,
    reverse: length,
    replayRates: rates,
    output: sample.stdout,
    storageBeforeSha256: digest(before),
    storageAfterSha256: digest(after),
    executeWorkers: 1,
    requestSha256: createHash('sha256').update(requestBytes).digest('hex'),
    resultSha256: createHash('sha256').update(resultBytes).digest('hex'),
  };
}
try {
  await service('http://127.0.0.1:4178/', server);
  await service('http://127.0.0.1:4449/status', driver);
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
  const cases = [];
  for (const sample of caseSetSamples.filter((sample) => sample.walk))
    cases.push(await capture(sample));
  writeFileSync(
    join(output, 'firefox-case-set.json'),
    JSON.stringify(
      {
        task: '08.4',
        evidenceLevel: 'stock-Firefox-real-Rust-public-case-set',
        capabilities: session.capabilities,
        rewardBoundary:
          'Unpublished preview: zero learning writes, not acceptance of 11.1 first-view rewards',
        cases,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Stock Firefox ${session.capabilities.browserVersion}: all seven real cases, native keyboard forward/reverse, real-time replay and unchanged learning storage passed.`,
  );
} catch (error) {
  const page = sessionId
    ? await js('return {url:location.href,text:document.body.innerText};').catch(() => null)
    : null;
  if (sessionId) {
    const screenshot = await wd(`/session/${sessionId}/screenshot`).catch(() => null);
    if (screenshot)
      writeFileSync(
        join(output, 'firefox-case-set-failure.png'),
        Buffer.from(screenshot, 'base64'),
      );
  }
  writeFileSync(
    join(output, 'firefox-case-set-failure.json'),
    JSON.stringify({ message: error.message, stack: error.stack, page }, null, 2) + '\n',
  );
  throw error;
} finally {
  if (sessionId) await wd(`/session/${sessionId}`, 'DELETE').catch(() => {});
  driver.kill();
  server.kill();
}
