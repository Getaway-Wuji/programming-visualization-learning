// Dedicated 07.3 product-page acceptance in stock Firefox; authored public data only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceDir } from './process.mjs';
import { checkEnvironment } from './environment.mjs';

checkEnvironment({ bindgen: true });
const output = join(workspaceDir, '.artifacts/07.3');
mkdirSync(output, { recursive: true });
const binary = join(workspaceDir, '.tools/firefox/core/firefox.exe');
const executable = join(workspaceDir, '.tools/geckodriver/geckodriver.exe');
assert.ok(existsSync(binary) && existsSync(executable), 'Prepare fixed Firefox and geckodriver.');
for (const port of [4178, 4447])
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
const driver = spawn(executable, ['--host', '127.0.0.1', '--port', '4447', '--log', 'warn'], {
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
      /* startup */
    }
    await delay(100);
  }
  throw new Error(`07.3 QA service failed: ${childErrors}`);
}
async function wd(path, method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:4447${path}`, {
    method,
    signal: globalThis.AbortSignal.timeout(15000),
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
async function until(script, args = []) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await js(script, args);
    if (value) return value;
    await delay(50);
  }
  throw new Error('07.3 Firefox UI did not reach its expected state.');
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
const installation = String.raw`
const audit=window.__verticalFirefox={records:[],fault:arguments[0],mutationCount:0};
const nativeFetch=window.fetch;
window.fetch=async function(...args){
  const response=await nativeFetch.apply(window,args);
  const url=String(args[0]);
  if(!audit.fault||!url.endsWith('/content/sample/02.1-content-1.0.0.json'))return response;
  const data=await response.clone().json();
  const program=data.programs.find(p=>p.id===audit.fault.programId);
  if(!program||!program.sourceExample.includes(audit.fault.needle))throw new Error('Missing authored fault site');
  program.sourceExample=program.sourceExample.replace(audit.fault.needle,audit.fault.replacement);
  audit.mutationCount++;
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
const NativeWorker=window.Worker;
window.Worker=class extends NativeWorker{
  constructor(...args){super(...args);this.record={kind:null,terminated:false,received:false};audit.records.push(this.record);
    this.addEventListener('message',event=>{
      // WebDriver's script sandbox has a different ArrayBuffer realm in stock Firefox.
      if(this.record.kind==='execute'&&Object.prototype.toString.call(event.data.buffer)==='[object ArrayBuffer]'){
        const copied=event.data.buffer.slice(0);this.record.resultBytes=copied.byteLength;
        this.record.result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(copied));this.record.received=true;
      }
    });
  }
  postMessage(message,options=[]){this.record.kind=message.kind;
    if(message.kind==='execute'){
      const copied=message.buffer.slice(0);this.record.requestBytes=copied.byteLength;
      this.record.request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(copied));
      this.record.catalog=JSON.parse(message.catalogJson);
    }
    super.postMessage(message,options);
  }
  terminate(){this.record.terminated=true;super.terminate();}
};`;
const samples = [
  { key: 'assignment', id: 'assignment', values: { x: -7 }, output: '-5\n' },
  {
    key: 'array-traversal',
    id: 'array-traversal',
    values: { values: [-2, 5, 5, 0] },
    output: '8\n',
  },
  {
    key: 'bubble-sort',
    id: 'bubble-sort',
    values: { values: [4, -1, 4, 0] },
    output: '-1 0 4 4\n',
  },
  { key: 'array-empty', id: 'array-traversal', values: { values: [] }, output: '0\n' },
  {
    key: 'assignment-div-zero',
    id: 'assignment',
    values: { x: -7 },
    output: '-7\n',
    code: 'E_DIV_ZERO',
    fault: {
      programId: 'program.c.assignment',
      needle: 'x = x + 2;',
      replacement: 'printf("%d\\n", x); x = x / 0;',
    },
  },
  {
    key: 'array-out-of-bounds',
    id: 'array-traversal',
    values: { values: [-2, 5, 5, 0] },
    output: '8\n',
    code: 'E_INDEX_BOUNDS',
    fault: {
      programId: 'program.c.array-sum',
      needle: 'return 0;',
      replacement: 'sum = values[n]; return 0;',
    },
  },
];
async function capture(sample) {
  // Discard the document and its test-only fetch observer before every sample/recovery.
  await wd(`/session/${sessionId}/url`, 'POST', { url: 'about:blank' });
  await wd(`/session/${sessionId}/url`, 'POST', { url: 'http://127.0.0.1:4178/#/cases' });
  await until(
    'return !!document.querySelector("main [data-testid=content-sample][data-state=ready]");',
  );
  await js(installation, [sample.fault ?? null]);
  await js('location.hash=arguments[0];', [`#/visualize/case.c.${sample.id}`]);
  await until('return !!document.querySelector("[data-testid=input-panel]");');
  for (const [key, value] of Object.entries(sample.values)) {
    const text = Array.isArray(value) ? (value.length ? value.join(', ') : '[]') : String(value);
    await js(
      `const field=document.querySelector(arguments[0]);
      Object.getOwnPropertyDescriptor(field.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(field,arguments[1]);
      field.dispatchEvent(new Event('input',{bubbles:true}));`,
      [`[data-testid=input-field-${key}]`, text],
    );
  }
  await click('[data-testid=input-panel] button.button-primary');
  await until(
    'return document.querySelector("[data-testid=case-execution]")?.dataset.state==="ready";',
  );
  await click('[data-testid=case-execution] > .inline-actions button.button-primary');
  await until(
    'return ["completed","program-error","resource-limit","infrastructure-failure"].includes(document.querySelector("[data-testid=case-execution]")?.dataset.state);',
  );
  const observation = await js(
    String.raw`
    const record=window.__verticalFirefox.records.find(r=>r.kind==='execute');
    const result=record.result;
    const output=result.trace.initialState.output+result.trace.steps.flatMap(s=>s.changes).filter(c=>c.op==='output').map(c=>c.append).join('');
    return {key:arguments[0],request:record.request,catalogSource:record.catalog.program.sourceExample,
      requestBytes:record.requestBytes,resultBytes:record.resultBytes,terminated:record.terminated,
      mutationCount:window.__verticalFirefox.mutationCount,
      source:document.querySelector('[aria-label="当前执行的 C 代码"]').value,
      input:document.querySelector('[data-testid=execution-input]').textContent,
      uiState:document.querySelector('[data-testid=case-execution]').dataset.state,
      uiOutput:document.querySelector('[data-testid=execution-output]').textContent,
      uiSteps:document.querySelector('[data-testid=execution-steps]').textContent,
      uiTerminal:document.querySelector('[data-testid=execution-terminal]').textContent,
      uiDiagnostics:[...document.querySelectorAll('[data-testid=animation-panel] p')].map(p=>p.textContent),
      result:{producer:result.producer,identity:result.identity,terminal:result.terminal,
        completeness:result.trace.completeness,steps:result.trace.steps.length,output,
        stats:result.stats,judgeResult:result.judgeResult},
      playbackNotice:document.querySelector('[data-testid=trace-view]')?.dataset.cursor==='0'};`,
    [sample.key],
  );
  assert.equal(observation.source, observation.request.source.text);
  assert.deepEqual(observation.request.input.values, sample.values);
  assert.ok(observation.input.includes(JSON.stringify(sample.values)));
  assert.equal(observation.result.producer, 'rust');
  assert.deepEqual(observation.result.identity, observation.request.identity);
  assert.equal(observation.result.output, sample.output);
  assert.equal(observation.uiOutput, sample.output);
  assert.ok(observation.uiSteps.includes(String(observation.result.steps)));
  assert.equal(observation.terminated, true);
  assert.equal(observation.playbackNotice, true);
  assert.equal(observation.result.judgeResult, null);
  const expectedStatus = sample.code ? 'program-error' : 'completed';
  assert.equal(observation.uiState, expectedStatus);
  assert.equal(observation.result.terminal.status, expectedStatus);
  assert.equal(observation.result.completeness, sample.code ? 'prefix' : 'complete');
  if (sample.code) {
    assert.ok(
      observation.result.terminal.diagnostics.some(
        (d) => d.code === sample.code && d.origin === 'rust' && d.stage === 'execute',
      ),
    );
    assert.ok(
      observation.uiDiagnostics.some(
        (text) => text.includes(sample.code) && text.includes('execute'),
      ),
    );
    assert.ok(observation.mutationCount > 0);
    assert.equal(observation.result.terminal.exitCode, null);
  } else {
    assert.deepEqual(observation.result.terminal.diagnostics, []);
    assert.equal(observation.result.terminal.exitCode, 0);
    assert.equal(observation.mutationCount, 0);
  }
  const screenshot = await wd(`/session/${sessionId}/screenshot`);
  writeFileSync(join(output, `firefox-${sample.key}.png`), Buffer.from(screenshot, 'base64'));
  return observation;
}
try {
  await service('http://127.0.0.1:4178/', server);
  await service('http://127.0.0.1:4447/status', driver);
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
  const observations = [],
    recoveries = [];
  for (const sample of samples) {
    const value = await capture(sample);
    observations.push(value);
    if (sample.code) {
      const recovered = await capture({
        ...samples.find((item) => item.id === sample.id && !item.code),
        key: `recovered-${sample.key}`,
      });
      assert.notEqual(recovered.request.identity.runId, value.request.identity.runId);
      assert.notEqual(recovered.request.identity.submissionId, value.request.identity.submissionId);
      recoveries.push({ failedKey: sample.key, recovered });
    }
  }
  writeFileSync(
    join(output, 'firefox-vertical.json'),
    JSON.stringify(
      {
        task: '07.3',
        evidenceLevel: 'stock-Firefox-production-page-controlled-worker-observation',
        provenance:
          'Project-authored public developer cases and explicitly isolated fault content copies; KEEP-09 acceptance data, never user data.',
        capabilities: session.capabilities,
        observations,
        recoveries,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Stock Firefox ${session.capabilities.browserVersion}: six vertical cases and two fresh-content recoveries passed.`,
  );
} catch (error) {
  const page = sessionId
    ? await js('return {url:location.href,text:document.body.innerText};').catch(() => null)
    : null;
  if (sessionId) {
    const screenshot = await wd(`/session/${sessionId}/screenshot`).catch(() => null);
    if (screenshot)
      writeFileSync(join(output, 'firefox-failure.png'), Buffer.from(screenshot, 'base64'));
  }
  writeFileSync(
    join(output, 'firefox-vertical-failure.json'),
    JSON.stringify({ message: error.message, stack: error.stack, page }, null, 2) + '\n',
  );
  throw error;
} finally {
  if (sessionId) await wd(`/session/${sessionId}`, 'DELETE').catch(() => {});
  driver.kill();
  server.kill();
}
