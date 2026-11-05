// Isolated stock Firefox, native W3C interactions and passive real IPC evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'vite';
const { performance, AbortSignal, structuredClone } = globalThis;
import { pathToFileURL } from 'node:url';
import { verifyBuildInputs } from './build-inputs.mjs';

const label = process.env.TASK_EVIDENCE_LABEL ?? `stock-firefox-${Date.now()}`;
assert.match(label, /^[a-zA-Z0-9_.-]+$/);
const output = resolve('.artifacts/cross-browser', label, 'stock-firefox');
assert(!existsSync(output), 'Keep previous runs and failures immutable');
mkdirSync(output, { recursive: true });
const downloads = join(output, 'downloads');
mkdirSync(downloads);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const sourceLockBefore = sha(readFileSync('content/build/source-lock.json'));
const lock = verifyBuildInputs();
// Compile the current production validators/projector and passive observer into
// this invocation's evidence directory. Never reuse a historical decoder.
const decoderEntry = 'virtual:stock-firefox-decoder';
await build({
  configFile: false,
  logLevel: 'warn',
  plugins: [
    {
      name: 'current-stock-firefox-validator',
      resolveId(id) {
        if (id === decoderEntry) return id;
      },
      load(id) {
        if (id === decoderEntry)
          return [
            "export {installC6Packets} from '/tests/browser/c6-observation.ts';",
            "export {decodeC6Response} from '/web/src/engine/c6-protocol.ts';",
            "export {C6Player} from '/web/src/engine/c6-player.ts';",
            "export {decodeResult} from '/web/src/engine/protocol.ts';",
            "export {decodeBugResult} from '/web/src/memory-bugs/protocol.ts';",
            "export {MemoryPlayer} from '/web/src/engine/memory-player.ts';",
            "export {engineBuild as memoryBuild} from '/web/src/generated/memory/engine-build.ts';",
            "export {engineBuild as c6BuildInfo} from '/web/src/generated/c6-teaching/engine-build.ts';",
          ].join('\n');
      },
    },
  ],
  build: {
    ssr: true,
    outDir: join(output, 'decoder'),
    emptyOutDir: false,
    rollupOptions: { input: decoderEntry, output: { entryFileNames: 'decoder.mjs' } },
  },
});
const {
  installC6Packets,
  decodeC6Response,
  C6Player,
  decodeResult,
  decodeBugResult,
  MemoryPlayer,
  memoryBuild,
  c6BuildInfo,
} = await import(pathToFileURL(join(output, 'decoder/decoder.mjs')).href);
const programs = read('tests/fixtures/c6-current-browser-programs.json');
const exercises = read('content/c/primer6-teaching/source-2.0.0.json').chapters.flatMap(
  (c) => c.exercises,
);
const c6Exercise = exercises.find((e) => e.ref.id === 'exercise.c6.s10.1.1');
const cppQuestions = read('content/cpp/bugs/questions-1.0.0.json').questions;
const c6Build = c6BuildInfo.wasmSha256;
const expectedStores = [
  'meta',
  'settings',
  'avatar',
  'progress',
  'dailyFacts',
  'goals',
  'ledger',
  'receipts',
  'aliases',
  'appearance',
  'appearanceAssets',
  'editHistory',
  'knowledgeMarks',
  'reviewCards',
  'achievements',
  'customDrafts',
  'weaknesses',
  'courseActivities',
  'courseDrafts',
];
const report = {
  label,
  startedAt: new Date().toISOString(),
  release: lock.releaseVersion,
  sourceLockBefore,
  stockFirefox: true,
  functionalOnly: true,
  results: [],
  passed: false,
};
const children = [];
let route;
let childLog = '';
function save() {
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
async function wait(fn, message, ms = 20000) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const value = await fn();
    if (value) return value;
    await delay(60);
  }
  throw Error(message);
}
async function wd(path, method = 'GET', body) {
  const response = await fetch('http://127.0.0.1:4456' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || data.value?.error) throw Error(`W3C ${path}: ${JSON.stringify(data.value)}`);
  return data.value;
}
const js = (script, args = []) =>
  wd(route + '/execute/sync', 'POST', {
    script: `const deepQuery=(selector,root=document)=>[...root.querySelectorAll(selector),...Array.from(root.querySelectorAll('*')).flatMap(e=>e.shadowRoot?deepQuery(selector,e.shadowRoot):[])];\n${script}`,
    args,
  });
async function nativeElement(selector, text = null) {
  return wait(
    () =>
      js(
        `const matches=deepQuery(arguments[0]).filter(e=>arguments[1]===null||e.textContent.trim()===arguments[1]);
    if(matches.length>1)throw Error('Ambiguous native locator: '+arguments[0]+' '+arguments[1]);return matches[0]??null;`,
        [selector, text],
      ),
    `Missing actual native element: ${selector} ${text}`,
  );
}
async function click(selector, text = null) {
  const e = await nativeElement(selector, text);
  await wd(`${route}/element/${e['element-6066-11e4-a52e-4f735466cecf']}/click`, 'POST', {});
}
async function button(text, scope = 'main') {
  return click(scope + ' button', text);
}
async function fill(selector, text) {
  const e = await nativeElement(selector);
  const endpoint = `${route}/element/${e['element-6066-11e4-a52e-4f735466cecf']}`;
  await wd(endpoint + '/clear', 'POST', {});
  if (text) await wd(endpoint + '/value', 'POST', { text, value: [...text] });
  await wait(
    () =>
      js(
        'const el=deepQuery(arguments[0])[0];return (el?.value??el?.cmTile?.root?.view?.state.doc.toString())===arguments[1]',
        [selector, text],
      ),
    'Native editor value mismatch',
  );
}
async function navigate(hash) {
  await js('location.hash=arguments[0]', [hash]);
  const prompt = await wd(route + '/alert/text').catch(() => null);
  if (prompt) await wd(route + '/alert/accept', 'POST', {});
  await wait(
    () => js('return location.hash===arguments[0]&&!!document.querySelector("main h1")', [hash]),
    'Hash navigation failed',
  );
}
async function snapshot(name) {
  writeFileSync(
    join(output, name + '.png'),
    Buffer.from(await wd(route + '/screenshot'), 'base64'),
  );
}
async function archive() {
  const data = await wd(route + '/execute/async', 'POST', {
    args: [],
    script: `
    const done=arguments[arguments.length-1];
    (async()=>{const db=await new Promise((yes,no)=>{const r=indexedDB.open('c-viz-learning');r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error)});
    try{const names=[...db.objectStoreNames];const tx=db.transaction(names,'readonly');
    const complete=new Promise((yes,no)=>{tx.oncomplete=yes;tx.onabort=()=>no(tx.error)});
    const rows=Object.fromEntries(await Promise.all(names.map(name=>new Promise((yes,no)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>yes([name,r.result]);r.onerror=()=>no(r.error)}))));
    await complete;return {version:db.version,names,rows};}finally{db.close()}})().then(done,e=>done({error:String(e)}));`,
  });
  assert(!data.error, data.error);
  assert.equal(data.version, 10);
  assert.deepEqual(data.names.toSorted(), expectedStores.toSorted());
  return data;
}
async function packetsSince(start) {
  return js(
    `const encode=b=>{if(!b)return null;const bytes=new Uint8Array(b);let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)};
    return window.c6CurrentPackets.slice(arguments[0]).map(p=>({moduleSeen:p.moduleSeen,terminated:p.terminated,request:encode(p.request),response:encode(p.response)}));`,
    [start],
  );
}
async function download(action, extension) {
  const before = new Set(readdirSync(downloads));
  await action();
  return wait(async () => {
    const matches = readdirSync(downloads).filter(
      (n) => !before.has(n) && n.endsWith(extension) && !existsSync(join(downloads, n) + '.part'),
    );
    return matches.length === 1 && statSync(join(downloads, matches[0])).size > 0
      ? join(downloads, matches[0])
      : null;
  }, 'No completed native Firefox download ' + extension);
}
async function runC6(program) {
  await navigate(
    program.judge
      ? '#/practice/' + c6Exercise.ref.id
      : '#/c6/program/teach.c6.ch01.welcome?node=c6.ch01',
  );
  await wait(
    () =>
      js('return document.querySelector(".c6-workbench")?.dataset.documentId===arguments[0]', [
        program.judge ? c6Exercise.ref.id : 'teach.c6.ch01.welcome',
      ]),
    'Current C6 document not mounted',
  );
  await fill('[contenteditable="true"]', program.code);
  if (!program.judge) await fill('#c6-stdin', program.input ?? '');
  const start = await js('return window.c6CurrentPackets.length');
  await button(program.judge ? '提交' : '运行当前代码');
  await wait(
    () =>
      js(
        'return window.c6CurrentPackets.at(-1)?.terminated && (document.querySelector("[data-testid=oj-verdict]")?.textContent==="通过" || !!document.querySelector(".c6-trace"))',
      ),
    'Actual C6 response missing',
  );
  if (program.judge)
    await wait(async () => {
      const a = await archive();
      return a.rows.progress.some(
        (r) => r.eventType === 'exercise.passed' && r.subjectRef.id === c6Exercise.ref.id,
      );
    }, 'Real native judge receipt missing');
  const captures = (await packetsSince(start)).filter(
    (p) => p.request && !('editVersion' in JSON.parse(Buffer.from(p.request, 'base64').toString())),
  );
  writeFileSync(
    join(output, program.id + '-observed-before-validation.json.gz'),
    gzipSync(JSON.stringify(captures)),
  );
  assert.equal(captures.length, 1);
  const captured = captures[0];
  assert(captured.moduleSeen && captured.terminated && captured.request && captured.response);
  const request = JSON.parse(Buffer.from(captured.request, 'base64').toString());
  assert.equal(request.source, program.code);
  const bytes = Uint8Array.from(Buffer.from(captured.response, 'base64'));
  const decoded = await decodeC6Response(bytes.buffer, request, c6Build);
  assert(!('editVersion' in decoded));
  const packets = 'cases' in decoded ? decoded.cases.map((c) => c.packet) : [decoded];
  assert.equal(packets.length, program.judge ? 4 : 1);
  if (program.judge) assert.equal(decoded.status, 'passed');
  for (const [i, packet] of packets.entries()) {
    assert.equal(packet.engine.buildId, c6Build);
    assert.equal(packet.terminal.status, 'completed');
    const stdout =
      packet.trace.initialState.output +
      packet.trace.steps
        .flatMap((s) => s.changes.filter((c) => c.op === 'output').map((c) => c.append))
        .join('');
    assert.equal(stdout, program.judge ? c6Exercise.tests[i].expectedStdout : program.stdout);
  }
  for (const [i, packet] of packets.entries()) {
    const player = new C6Player(packet),
      states = [structuredClone(player.state)];
    for (let cursor = 1; cursor <= packet.trace.steps.length; cursor++) {
      player.seek(cursor);
      states.push(structuredClone(player.state));
    }
    assert.equal(
      player.state.output,
      program.judge ? c6Exercise.tests[i].expectedStdout : program.stdout,
    );
    for (let cursor = packet.trace.steps.length - 1; cursor >= 0; cursor--) {
      player.seek(cursor);
      assert.deepEqual(player.state, states[cursor]);
    }
  }
  if (!program.judge) {
    const initial = await js('return document.querySelector(".c6-trace").textContent');
    await button('到本次末尾', '.c6-trace');
    await wait(
      () =>
        js('return document.querySelector(".c6-trace")?.dataset.cursor===arguments[0]', [
          String(packets[0].trace.steps.length),
        ]),
      'C6 final cursor mismatch',
    );
    assert.equal(
      await js('return document.querySelector(".c6-output").textContent'),
      program.judge ? c6Exercise.tests[0].expectedStdout : program.stdout,
    );
    await button('回到开始', '.c6-trace');
    assert.equal(await js('return document.querySelector(".c6-trace").textContent'), initial);
  }
  const db = await archive();
  if (!program.judge && !program.preserveLearning)
    for (const n of ['progress', 'ledger', 'receipts', 'dailyFacts'])
      assert.deepEqual(db.rows[n], []);
  else if (program.judge) {
    assert.equal(db.rows.progress.length, 1);
    assert.equal(db.rows.progress[0].eventType, 'exercise.passed');
    assert.deepEqual(db.rows.progress[0].subjectRef, c6Exercise.ref);
    assert.equal(db.rows.ledger.length, 1);
    assert.equal(db.rows.ledger[0].points, 10);
    assert.equal(db.rows.ledger[0].status, 'posted');
  }
  const proof = { program, request, captured, db };
  writeFileSync(join(output, program.id + '.json.gz'), gzipSync(JSON.stringify(proof)));
  if (!program.exportPreparation)
    report.results.push({
      id: program.id,
      passed: true,
      actualSteps: packets.map((p) => p.trace.steps.length),
      realCases: packets.length,
    });
  save();
  console.log('PASS actual Firefox C6', program.id);
}
async function exports() {
  await runC6({
    id: 'export-program',
    code: c6Exercise.referenceSource,
    input: c6Exercise.tests[0].stdin,
    stdout: c6Exercise.tests[0].expectedStdout,
    preserveLearning: true,
    exportPreparation: true,
  });
  for (let n = 0; n < 3; n++) await button('下一步', '.c6-trace');
  const before = await archive();
  const stateFile = await download(() => button('下载状态文件（JSON）'), '.json');
  const state = read(stateFile);
  assert.equal(state.formatVersion, '2.0.0');
  assert.equal(state.position.cursor, 3);
  assert.equal(state.source.text, c6Exercise.referenceSource);
  const pngFile = await download(() => button('下载快照图片（PNG）'), '.png');
  const png = readFileSync(pngFile);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let embedded;
  for (let offset = 8; offset + 12 <= png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'iTXt') {
      const body = png.subarray(offset + 8, offset + 8 + size),
        header = Buffer.from('c-viz.snapshot\0\0\0\0\0');
      if (body.subarray(0, header.length).equals(header))
        embedded = JSON.parse(body.subarray(header.length).toString());
    }
    offset += size + 12;
  }
  assert.equal(embedded?.formatVersion, '2.0.0');
  assert.deepEqual(embedded.source, state.source);
  assert.deepEqual(embedded.currentState, state.currentState);
  await button('加入本次笔记');
  await wait(
    () =>
      js('return document.querySelector("main").textContent.includes("当前快照已加入本次笔记。")'),
    'Snapshot was not captured',
  );
  await click('main a', '查看学习笔记');
  const snapType = await wait(
    () =>
      js(
        'return [...document.querySelectorAll(".note-types label")].find(e=>e.textContent.trim()==="快照")?.querySelector("input")??null',
      ),
    'Snapshot filter missing',
  );
  const selected = await wd(
    route + '/element/' + snapType['element-6066-11e4-a52e-4f735466cecf'] + '/selected',
  );
  if (!selected)
    await wd(
      route + '/element/' + snapType['element-6066-11e4-a52e-4f735466cecf'] + '/click',
      'POST',
      {},
    );
  await click('[data-note-kind="snapshot"] input[type="checkbox"]');
  await button('生成所选内容预览');
  await wait(
    () => js('return !!document.querySelector("[aria-label=笔记源码]")'),
    'Source preview missing',
  );
  assert.equal(
    await js('return document.querySelectorAll("[aria-label=笔记源码] .note-code-line").length'),
    state.source.text.split('\n').length,
  );
  const range = state.position.executedRange;
  assert.equal(
    await js(
      'return document.querySelectorAll("[aria-label=笔记源码] .note-code-highlight").length',
    ),
    range ? range.end.line - range.start.line + 1 : 0,
  );
  await button('预览完整状态图片');
  await wait(
    () => js('return !!document.querySelector(".note-picture img")'),
    'Actual state image missing',
  );
  const zipFile = await download(() => button('下载 Markdown 压缩包'), '.zip');
  const after = await archive();
  // Session snapshot capture is in memory; these downloads grant no learning facts.
  for (const n of ['progress', 'ledger', 'receipts', 'dailyFacts'])
    assert.deepEqual(after.rows[n], before.rows[n]);
  const verifier = spawn(
    'python',
    ['scripts/verify-notes-archive.py', zipFile, join(output, 'independently-extracted-notes')],
    { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  );
  let log = '';
  verifier.stdout.on('data', (d) => (log += d));
  verifier.stderr.on('data', (d) => (log += d));
  const code = await new Promise((yes, no) => {
    verifier.once('error', no);
    verifier.once('close', yes);
  });
  writeFileSync(join(output, 'independent-export-verification.log'), log);
  assert.equal(code, 0, log);
  await snapshot('notes-real-source-and-state');
  report.results.push({
    id: 'native-json-png-markdown-zip',
    passed: true,
    files: [stateFile, pngFile, zipFile].map((path) => ({
      path,
      sha256: sha(readFileSync(path)),
      bytes: statSync(path).size,
    })),
    independentVerifier: code,
  });
  save();
  console.log('PASS actual Firefox JSON/PNG/Markdown ZIP');
}
async function cpp(question) {
  await navigate('#/bugs/memory/' + question.exerciseRef.id);
  await wait(
    () =>
      js(
        'return !!document.querySelector("[data-testid=memory-bug-session]") && document.querySelector("main h1")?.textContent===arguments[0]',
        [question.title],
      ),
    'Current C++ question not mounted',
  );
  await fill('[contenteditable="true"]', question.solutionSource);
  const start = await js('return window.c6CurrentPackets.length');
  await button('提交');
  await wait(
    () =>
      js(
        'const p=document.querySelector("[data-testid=memory-bug-session]");return p?.dataset.state==="passed"&&p?.dataset.saveState==="saved"',
      ),
    'Actual C++ four cases not saved',
  );
  const captures = await packetsSince(start);
  assert.equal(captures.length, 4);
  for (const [i, p] of captures.entries()) {
    assert(p.moduleSeen && p.terminated && p.request && p.response);
    const req = JSON.parse(Buffer.from(p.request, 'base64').toString());
    assert.equal(req.source, question.solutionSource);
    assert.equal(req.language, 'cpp');
    assert.equal(req.bug.caseKey, question.tests[i].caseKey);
    const raw = Uint8Array.from(Buffer.from(p.response, 'base64'));
    const decoded = await decodeBugResult(raw.buffer, req, memoryBuild.wasmSha256);
    assert.equal(decoded.terminal.status, 'completed');
    assert.equal(decoded.trace.completeness, 'complete');
    // OJ submissions expose a verdict. Replay each actual Firefox packet with
    // the production projector without introducing a player into that UI.
    const player = new MemoryPlayer();
    player.accept(decoded);
    const initial = player.snapshot();
    const states = [initial.state];
    for (let cursor = 1; cursor <= initial.length; cursor++) {
      assert(player.seek(cursor));
      states.push(player.snapshot().state);
    }
    assert.equal(player.snapshot().state.output, question.tests[i].expectedStdout);
    for (let cursor = initial.length - 1; cursor >= 0; cursor--) {
      assert(player.seek(cursor));
      assert.deepEqual(player.snapshot().state, states[cursor]);
    }
    assert.deepEqual(player.snapshot(), initial);
    const original = JSON.parse(Buffer.from(p.response, 'base64').toString());
    assert.equal(original.bugJudgement.status, 'met');
  }
  assert.equal(
    await js('return document.querySelector("[data-testid=oj-verdict]").textContent'),
    '通过',
  );
  const db = await archive();
  assert(
    db.rows.progress.some(
      (p) => p.eventType === 'exercise.passed' && p.subjectRef.id === question.exerciseRef.id,
    ),
  );
  writeFileSync(
    join(output, question.exerciseRef.id + '.json.gz'),
    gzipSync(JSON.stringify({ question, captures, db })),
  );
  report.results.push({
    id: question.exerciseRef.id,
    passed: true,
    actualCases: 4,
    buildId: memoryBuild.wasmSha256,
  });
  save();
  console.log('PASS actual Firefox C++', question.exerciseRef.id);
}
async function retainedC() {
  await navigate('#/visualize/case.c.assignment');
  await wait(
    () =>
      js('return document.querySelector("[data-testid=case-execution]")?.dataset.state==="ready"'),
    'Independent C case not ready',
  );
  const start = await js('return window.c6CurrentPackets.length');
  await button('运行示例');
  await wait(
    () =>
      js(
        'return Number(document.querySelector("[data-testid=player-controls]")?.dataset.length)>0',
      ),
    'Independent C trace missing',
  );
  const captures = await packetsSince(start);
  const run =
    captures.find(
      (p) =>
        p.request && JSON.parse(Buffer.from(p.request, 'base64').toString()).kind === 'execute',
    ) ?? captures.at(-1);
  assert(run?.moduleSeen && run.terminated && run.request && run.response);
  const request = JSON.parse(Buffer.from(run.request, 'base64').toString());
  const raw = Uint8Array.from(Buffer.from(run.response, 'base64'));
  const decoded = await decodeResult(raw.buffer, request);
  assert.equal(decoded.producer, 'rust');
  assert.equal(decoded.terminal.status, 'completed');
  assert.equal(request.languageRef.id, 'lang.c');
  const visible = await js('return document.querySelector(arguments[0]).value', [
    'textarea[aria-label="当前执行的 C 代码"]',
  ]);
  assert.equal(visible, request.source.text);
  writeFileSync(
    join(output, 'retained-C-assignment.json.gz'),
    gzipSync(JSON.stringify({ request, run })),
  );
  report.results.push({
    id: 'retained-C-assignment',
    passed: true,
    actualSteps: decoded.trace.steps.length,
  });
  save();
  console.log('PASS actual Firefox independent C case');
}
try {
  for (const port of [4212, 4456])
    await new Promise((yes, no) => {
      const s = createServer();
      s.once('error', no);
      s.listen(port, '127.0.0.1', () => s.close(yes));
    });
  const server = spawn(process.execPath, ['scripts/serve-checks.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, CHECK_DIST: 'web/dist', CHECK_PORT: '4212' },
    windowsHide: true,
    stdio: 'pipe',
  });
  const driver = spawn(
    resolve('.tools/geckodriver/geckodriver.exe'),
    ['--host', '127.0.0.1', '--port', '4456', '--log', 'warn'],
    { cwd: process.cwd(), windowsHide: true, stdio: 'pipe' },
  );
  children.push(server, driver);
  report.ownedPids = children.map((c) => c.pid);
  for (const c of children) {
    c.on('error', (e) => (childLog += String(e) + '\n'));
    c.stdout.on('data', (d) => (childLog += d));
    c.stderr.on('data', (d) => (childLog += d));
  }
  for (const url of ['http://127.0.0.1:4212/', 'http://127.0.0.1:4456/status'])
    await wait(async () => {
      try {
        return (await fetch(url)).ok;
      } catch {
        return false;
      }
    }, 'Owned service unavailable ' + url);
  const session = await wd('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        unhandledPromptBehavior: 'accept',
        'moz:firefoxOptions': {
          binary: resolve('.tools/firefox/core/firefox.exe'),
          args: ['-headless'],
          prefs: {
            'app.update.auto': false,
            'browser.shell.checkDefaultBrowser': false,
            'browser.download.folderList': 2,
            'browser.download.dir': downloads,
            'browser.download.useDownloadDir': true,
            'browser.download.alwaysOpenPanel': false,
            'browser.helperApps.neverAsk.saveToDisk': 'application/json,image/png,application/zip',
          },
        },
      },
    },
  });
  route = '/session/' + session.sessionId;
  report.capabilities = session.capabilities;
  assert.equal(session.capabilities.browserName, 'firefox');
  await wd(route + '/timeouts', 'POST', { script: 30000, pageLoad: 30000, implicit: 0 });
  await wd(route + '/window/rect', 'POST', { width: 1440, height: 900 });
  await wd(route + '/url', 'POST', { url: 'http://127.0.0.1:4212/#/' });
  await wait(
    () => js('return !!document.querySelector(".c6-home-columns")'),
    'Current home unavailable',
  );
  report.viewport = await js(
    'return {innerWidth,innerHeight,devicePixelRatio,visibility:document.visibilityState,userAgent:navigator.userAgent}',
  );
  // Marionette and real page messages have distinct realms. As in the reviewed
  // stock-Firefox runner, observe byteLength rather than realm-local instanceof.
  // This copies only native buffers and never supplies a Worker message.
  const observer = installC6Packets
    .toString()
    .replace(
      'event.data?.buffer instanceof ArrayBuffer',
      'typeof event.data?.buffer?.byteLength === "number"',
    )
    .replace(
      'message.module instanceof WebAssembly.Module',
      'Object.prototype.toString.call(message.module) === "[object WebAssembly.Module]"',
    );
  assert(observer.includes('typeof event.data?.buffer?.byteLength'));
  writeFileSync(join(output, 'passive-marionette-observer.js'), observer);
  await js('(' + observer + ')()');
  const initial = await archive();
  report.initialNativeStores = initial.names;
  assert.deepEqual(initial.rows.progress, []);
  assert.deepEqual(initial.rows.ledger, []);
  save();
  for (const program of programs) await runC6(program);
  await exports();
  for (const question of cppQuestions) await cpp(question);
  await retainedC();
  await navigate('#/');
  await wait(
    () => js('return document.querySelector("main").textContent.includes("0 / 404")'),
    'Old completions leaked into new book',
  );
  const durable = await archive();
  assert.equal(durable.rows.ledger.length, 5);
  assert.equal(
    durable.rows.ledger.reduce((n, r) => n + r.points, 0),
    50,
  );
  await wd(route + '/refresh', 'POST', {});
  await wait(() => js('return !!document.querySelector(".c6-home-columns")'), 'Reload unavailable');
  const reloaded = await archive();
  for (const n of ['progress', 'ledger', 'receipts'])
    assert.deepEqual(reloaded.rows[n], durable.rows[n]);
  await navigate('#/settings?panel=data');
  await button('清除本地数据');
  await button('取消', 'dialog[open]');
  assert.deepEqual((await archive()).rows.progress, durable.rows.progress);
  await button('清除本地数据');
  await button('确认清除', 'dialog[open]');
  await wait(async () => {
    const a = await archive();
    return JSON.stringify(a.rows.meta) !== JSON.stringify(durable.rows.meta);
  }, 'Generation did not change');
  const cleared = await archive();
  // The product defines 19 stores: five protected/nonlearning plus fourteen RESET domains.
  const actualLearning = cleared.names.filter(
    (n) => !['meta', 'settings', 'avatar', 'appearance', 'appearanceAssets'].includes(n),
  );
  assert.equal(actualLearning.length, 14);
  report.actualResetStores = actualLearning;
  for (const name of actualLearning) assert.deepEqual(cleared.rows[name], [], name);
  writeFileSync(
    join(output, 'native-save-reload-clear.json'),
    JSON.stringify({ initial, durable, reloaded, cleared }, null, 2),
  );
  report.results.push({ id: 'native-db10-save-refresh-cancel-and-clear', passed: true });
  assert.equal(report.results.length, programs.length + cppQuestions.length + 3);
  assert.equal(sha(readFileSync('content/build/source-lock.json')), sourceLockBefore);
  verifyBuildInputs();
  report.passed = true;
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  if (route) {
    try {
      await snapshot('failure');
      report.failurePage = await js(
        'return {url:location.href,text:document.querySelector("main")?.innerText}',
      );
    } catch (e) {
      report.failureCaptureError = String(e);
    }
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  save();
  if (route)
    try {
      await wd(route, 'DELETE');
    } catch (e) {
      report.sessionCloseError = String(e);
    }
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill();
  writeFileSync(join(output, 'owned-services.log'), childLog);
  save();
}
