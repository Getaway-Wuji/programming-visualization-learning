// Review registration authorizes only the exact source/engine/content assembly.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { basename, resolve } from 'node:path';
import { memoryBugPaths } from './memory-bug-release-inputs.mjs';
const dir = '.artifacts/14.4';
const read = (path) => readFileSync(path);
const parse = (bytes) => JSON.parse(bytes.toString().replace(/^\uFEFF/, ''));
const json = (path) => parse(read(path));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, sha256: hash(read(path)) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const priorPath = 'content/c/p0/blockly-release-1.0.23.json',
  prior = json(priorPath);
const target = 'content/c/p0/blockly-release-1.0.24.json';
assert.equal(existsSync(target), false);
for (const e of Object.values(prior.evidence)) assert.equal(hash(read(e.path)), e.sha256);
assert.equal(hash(read('web/src/generated/c_viz_wasm_bg.wasm')), prior.engine.wasmSha256);
const changed = memoryBugPaths.filter(
  (p) => prior.files.find((e) => e.path === p)?.sha256 !== hash(read(p)),
);
const newest = Math.max(...changed.map((p) => statSync(p).mtimeMs));
const cases = (suites) =>
  suites.flatMap((s) => [
    ...(s.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(s.suites ?? []),
  ]);
const caseKey = (spec) => `${basename(spec.file.replaceAll('\\', '/'))}: ${spec.title}`;
const old = cases(json('项目文档/验收/发布凭据/14.3-1.0.23/14-3-legacy-final5.json').suites)
  .map(({ spec }) => caseKey(spec))
  .sort();
const evidence = {};
for (const [label, count] of [
  ['14-4-candidate-release', 8],
  ['14-4-teaching-release', 14],
  ['14-4-legacy-release', 60],
  ['memory-browser-14-4-release', 9],
]) {
  const path = `${dir}/${label}.json`,
    r = json(path);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.expected, count);
  assert.equal(r.stats.unexpected + r.stats.flaky + r.stats.skipped, 0);
  assert.ok(Date.parse(r.stats.startTime) >= newest, label);
  const list = cases(r.suites);
  assert.equal(list.length, count);
  for (const { spec, test } of list) {
    assert.equal(spec.ok, true);
    assert.equal(test.results.length, 1);
    assert.equal(test.results[0].status, 'passed');
    assert.equal(test.results[0].retry, 0);
    assert.ok(
      Date.parse(r.stats.startTime) >=
        statSync(`tests/browser/${basename(spec.file.replaceAll('\\', '/'))}`).mtimeMs,
    );
  }
  if (count === 60) assert.deepEqual(list.map(({ spec }) => caseKey(spec)).sort(), old);
  evidence[label] = { ...proof(path), passed: count };
}
const unitPath = `${dir}/frontend-release2.json`,
  unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 1473);
assert.equal(unit.numFailedTests + unit.numPendingTests, 0);
assert.ok(unit.startTime >= newest);
const walk = (p) =>
  readdirSync(p, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${p}/${e.name}`) : [`${p}/${e.name}`],
  );
assert.deepEqual(
  unit.testResults.map((r) => resolve(r.name).toLowerCase()).sort(),
  walk('tests/unit')
    .filter((p) => p.endsWith('.test.ts'))
    .map((p) => resolve(p).toLowerCase())
    .sort(),
);
for (const r of unit.testResults) {
  assert.equal(r.status, 'passed');
  assert.ok(unit.startTime >= statSync(r.name).mtimeMs);
}
evidence.frontend = { ...proof(unitPath), passed: unit.numPassedTests };
const rustLog = `${dir}/rust-release.log`,
  rustText = read(rustLog).toString();
assert.equal(Number(read(`${dir}/rust-release.exit`).toString().trim()), 0);
const rustCounts = [
  ...rustText.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored/g),
].reduce(
  (n, m) => ({ passed: n.passed + +m[1], failed: n.failed + +m[2], ignored: n.ignored + +m[3] }),
  { passed: 0, failed: 0, ignored: 0 },
);
assert.deepEqual(rustCounts, { passed: 507, failed: 0, ignored: 1 });
const rustSources = walk('engine').filter((p) => /\.(rs|toml)$/.test(p));
assert.ok(
  statSync(rustLog).birthtimeMs >=
    Math.max(
      ...[...rustSources, 'content/cpp/bugs/questions-1.0.0.json'].map((p) => statSync(p).mtimeMs),
    ),
);
save(`${dir}/rust-verification-final.json`, {
  ...rustCounts,
  fmt: true,
  nativeClippy: true,
  wasmClippy: true,
  log: proof(rustLog),
  sourcePaths: rustSources.map(proof),
});
evidence.rust = proof(`${dir}/rust-verification-final.json`);
const wasmPath = 'web/src/generated/memory/c_viz_memory_bg.wasm',
  wasm = json(`${dir}/memory-wasm-build.json`);
assert.equal(hash(read(wasmPath)), wasm.wasmSha256);
assert.equal(wasm.memories[0].maximum, 2048);
assert.equal(wasm.memories[0].shared, false);
evidence.memoryBuild = proof(`${dir}/memory-wasm-build.json`);
const schema = json(`${dir}/schema-release.json`);
assert.equal(schema.passed, true);
assert.equal(schema.positive, 74);
assert.equal(schema.negative, 6);
assert.equal(schema.schemaSha256, hash(read('项目文档/契约/14.4-内存关卡.schema.json')));
evidence.schema = proof(`${dir}/schema-release.json`);
const registry = json('content/cpp/bugs/questions-1.0.0.json');
assert.equal(registry.questions.length, 4);
const actual = {};
for (const [index, q] of registry.questions.entries()) {
  const folder = `${dir}/browser/14-4-candidate-release`,
    record = json(`${folder}/${q.exerciseRef.id}.json`);
  assert.ok(record.observations.brokenElapsedMs > 0 && record.observations.brokenElapsedMs < 1000);
  assert.ok(
    record.observations.repairedAcceptedMs > 0 && record.observations.repairedAcceptedMs < 1000,
  );
  assert.equal(record.captures.length, 9);
  const responses = [];
  for (const c of record.captures) {
    assert.equal(c.moduleSeen, true);
    assert.equal(c.request.language, 'cpp');
    assert.equal(c.request.bug.exerciseId, q.exerciseRef.id);
    assert.match(c.raw.file, /^[A-Za-z0-9_.-]+\.json\.gz$/);
    const compressed = read(`${folder}/${c.raw.file}`),
      raw = gunzipSync(compressed),
      r = parse(raw);
    assert.equal(hash(raw), c.raw.sha256);
    assert.equal(raw.length, c.raw.bytes);
    assert.equal(r.engine.buildId, wasm.wasmSha256);
    assert.deepEqual(r.bugJudgement, c.verdict);
    assert.deepEqual(r.terminal, c.terminal);
    responses.push({ rawSha256: c.raw.sha256, gzipBase64: compressed.toString('base64') });
  }
  const broken = record.captures[0];
  assert.equal(broken.request.source, q.brokenSource);
  assert.equal(
    broken.terminal.code,
    ['E_UNINITIALIZED', 'E_DANGLING_POINTER', 'E_STEP_LIMIT', 'E_STEP_LIMIT'][index],
  );
  assert.equal(broken.verdict.status, 'unmet');
  assert.equal(broken.completeness, 'prefix');
  if (index >= 2) assert.equal(broken.steps, 20000);
  const budget = new Map(record.budgets.map((b) => [b.operationId, b]));
  for (const offset of [1, 5]) {
    const group = record.captures.slice(offset, offset + 4);
    assert.deepEqual(
      group.map((c) => c.request.bug.caseKey),
      q.tests.map((t) => t.caseKey),
    );
    assert.ok(
      group.every(
        (c) =>
          c.verdict.status === 'met' &&
          c.terminal.status === 'completed' &&
          c.request.source === q.solutionSource,
      ),
    );
    const values = group.map((c) => budget.get(c.operationId));
    assert.ok(
      values.every(
        (v) =>
          v && v.remainingMs > 0 && v.remainingMs <= 1000 && v.wasmPages > 0 && v.wasmPages <= 2048,
      ),
    );
    for (let i = 1; i < 4; i++) assert.ok(values[i].remainingMs <= values[i - 1].remainingMs);
    assert.ok(values[3].remainingMs < values[0].remainingMs);
  }
  actual[q.exerciseRef.id] = { record, responses };
}
save(`${dir}/actual-native-final.json`, actual);
evidence.actualNative = proof(`${dir}/actual-native-final.json`);
const unitActualPath = `${dir}/memory-bug-execution-frontend-release2.json`,
  unitActual = json(unitActualPath),
  unitRaw = read(`${dir}/memory-bug-raw-frontend-release2.json.gz`);
assert.equal(unitActual.buildId, wasm.wasmSha256);
assert.equal(unitActual.rawGzipSha256, hash(unitRaw));
assert.equal(unitActual.summaries.filter((s) => s.kind === 'broken' && s.restored).length, 4);
assert.equal(
  unitActual.summaries.filter(
    (s) => ['solutionSource', 'alternativeSource'].includes(s.kind) && s.status === 'met',
  ).length,
  32,
);
save(`${dir}/actual-unit-final.json`, {
  summary: unitActual,
  rawGzipBase64: unitRaw.toString('base64'),
});
evidence.actualUnit = proof(`${dir}/actual-unit-final.json`);
for (const label of [
  'unit-first',
  'frontend-release',
  '14-4-candidate-first',
  '14-4-teaching-final',
])
  evidence[label] = { ...proof(`${dir}/${label}.json`), accepted: false };
save(target, {
  ...prior,
  releaseVersion: '1.0.24',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.23', ...proof(priorPath) },
  scope:
    '14.4 four independent C++ pointer/loop repair levels through actual memory Rust, closed BUG-MEMORY companion, effective40 learning identities and existing SAVE3/reward paths.',
  reason:
    'Final-source1473 frontend,507 Rust/1 inherited ignore, identical60 legacy Chrome,8 new candidate,14 teaching and9 original memory-engine scenarios pass; original budget, real20000-step prefixes, full inverse, both repairs and shared1000ms verified.',
  memoryEngine: {
    id: 'engine.rust.memory',
    version: '0.1.0',
    companion: 'BUG-MEMORY-01@1.0.0',
    wasmSha256: wasm.wasmSha256,
    wasmBytes: wasm.wasmBytes,
  },
  files: memoryBugPaths.map(proof),
  evidenceFreshness: { lastSourceModifiedAtUtc: new Date(newest).toISOString() },
  evidence,
});
const archive = '项目文档/验收/发布凭据/14.4-1.0.24';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  `Registered1.0.24: ${memoryBugPaths.length} sources;1473 frontend,507 Rust/1 inherited ignore;60+8+14+9 Chrome. Formal save/reward and full-block delivery remain to be verified.`,
);
