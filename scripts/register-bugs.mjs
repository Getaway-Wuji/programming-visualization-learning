// Immutable review registration; candidate execution does not grant learning rights.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { bugPaths } from './bug-release-inputs.mjs';
const folder = '.artifacts/14.3';
const read = (p) => readFileSync(p);
const json = (p) =>
  JSON.parse(
    read(p)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (p) => createHash('sha256').update(read(p)).digest('hex');
const proof = (path) => ({ path, sha256: sha(path) });
const save = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const priorPath = 'content/c/p0/blockly-release-1.0.22.json',
  prior = json(priorPath);
for (const p of Object.values(prior.evidence)) assert.equal(sha(p.path), p.sha256);
assert.equal(sha('web/src/generated/c_viz_wasm_bg.wasm'), prior.engine.wasmSha256);
const changed = bugPaths.filter((p) => prior.files.find((e) => e.path === p)?.sha256 !== sha(p));
const newest = Math.max(...changed.map((p) => statSync(p).mtimeMs));
const cases = (suites) =>
  suites.flatMap((s) => [
    ...(s.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(s.suites ?? []),
  ]);
const key = (spec) => `${basename(spec.file.replaceAll('\\', '/'))}: ${spec.title}`;
const old = cases(json('.artifacts/13.5/legacy-final.json').suites)
  .map(({ spec }) => key(spec))
  .sort();
const evidence = {};
for (const [label, count] of [
  ['14-3-legacy-final5', 60],
  ['14-3-candidate-final4', 7],
]) {
  const p = `${folder}/${label}.json`,
    r = json(p);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.expected, count);
  assert.equal(r.stats.unexpected + r.stats.flaky + r.stats.skipped, 0);
  assert.ok(Date.parse(r.stats.startTime) >= newest);
  assert.deepEqual(
    r.config.filteredProjects.map((p) => p.name),
    ['chrome'],
  );
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
  if (count === 60) assert.deepEqual(list.map(({ spec }) => key(spec)).sort(), old);
  evidence[label] = { ...proof(p), passed: count };
}
const unitPath = `${folder}/frontend-fifth.json`,
  unit = json(unitPath);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
assert.ok(unit.numPassedTests >= 1464);
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
const registry = json('content/c/bugs/questions-1.0.0.json');
assert.equal(registry.questions.length, 4);
const actual = {};
for (const q of registry.questions) {
  const record = json(`${folder}/browser/14-3-candidate-final4/${q.exerciseRef.id}.json`);
  const groups = new Map();
  for (const c of record.captures) {
    assert.equal(c.moduleSeen, true);
    assert.equal(c.result.producer, 'rust');
    const id = c.request.identity.submissionId;
    groups.set(id, [...(groups.get(id) ?? []), c]);
  }
  const passing = [...groups.values()].filter(
    (group) =>
      group.length === 4 &&
      group.every(
        (c) => c.result.judgeResult?.status === 'met' && c.result.terminal.status === 'completed',
      ),
  );
  assert.ok(passing.length >= 2, q.exerciseRef.id);
  for (const group of passing) {
    assert.deepEqual(
      group.map((c) => c.request.identity.testCaseKey),
      q.tests.map((t) => t.caseKey),
    );
    assert.ok(group[0].request.remainingMs <= 1000);
    assert.ok(group[3].request.remainingMs < group[0].request.remainingMs);
    for (let i = 1; i < 4; i++)
      assert.ok(group[i].request.remainingMs <= group[i - 1].request.remainingMs);
  }
  actual[q.exerciseRef.id] = record;
}
const unitActualPath = `${folder}/bugs-execution-frontend-fifth.json`,
  unitActual = json(unitActualPath);
assert.equal(unitActual.filter((r) => r.kind === 'receive-failure').length, 0);
for (const q of registry.questions.filter((q) => q.category === 'syntax'))
  assert.ok(
    unitActual.some(
      (r) =>
        r.kind === 'analysis' &&
        r.request.sourceText.includes(q.brokenBody) &&
        r.result.status === 'invalid' &&
        r.result.diagnostics.some((d) => d.code === 'E_PARSE_INVALID' && d.origin === 'rust'),
    ),
  );
save(`${folder}/bug-execution-final.json`, actual);
evidence.actual = proof(`${folder}/bug-execution-final.json`);
evidence.unitActual = proof(unitActualPath);
evidence.rejected22 = { ...proof('.artifacts/14.3/rejected22-build.json'), accepted: false };
for (const label of [
  'unit-first',
  'unit-second',
  'unit-third',
  '14-3-first',
  '14-3-candidate-final2',
  'frontend-third',
  '14-3-legacy-final2',
  '14-3-legacy-final4',
])
  evidence[label] = { ...proof(`${folder}/${label}.json`), accepted: false };
const target = 'content/c/p0/blockly-release-1.0.23.json';
assert.equal(existsSync(target), false);
save(target, {
  ...prior,
  releaseVersion: '1.0.23',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.22', ...proof(priorPath) },
  scope:
    '14.3 four independent optional Bug repair exercises, atomic bundle1.1.0 supplement, real Rust teaching judgments and existing learning/history/reward paths. Original32 required exercises, Rust and SAVE3 unchanged.',
  reason:
    'Final-source complete frontend, identical60 legacy Chrome cases and7 Bug candidate scenarios pass; broken diagnostics, logical failure, reference/alternative repairs, four groups per question, input dependence and original shared deadline verified.',
  supplementalReason:
    'Reading catalog is isolated after the rejected1.0.22 immutable check; original reading bytes stay exact. Formal persistence/retry/independent rights follow registration; no original CONTENT mutation or new event/reward source.',
  files: bugPaths.map(proof),
  evidenceFreshness: { lastSourceModifiedAtUtc: new Date(newest).toISOString() },
  evidence,
});
const archive = '项目文档/验收/发布凭据/14.3-1.0.23';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((entry) => {
  const file = basename(entry.path);
  writeFileSync(`${archive}/${file}`, read(entry.path), { flag: 'wx' });
  return { ...entry, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: entries });
console.log(
  `Registered1.0.23: ${bugPaths.length} reviewed sources; ${unit.numPassedTests} frontend checks,60 legacy+7 Bug Chrome cases.`,
);
