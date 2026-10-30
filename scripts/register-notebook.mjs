// Exact26 review registration; selective rechecks retain the original failed reports.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { notebookPaths } from './notebook-release-inputs.mjs';
const dir = '.artifacts/15.2';
const read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (path) => ({ path, sha256: sha(read(path)) });
const save = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const priorPath = 'content/c/p0/blockly-release-1.0.25.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.26.json';
assert.equal(existsSync(target), false);
for (const e of Object.values(prior.evidence)) assert.equal(sha(read(e.path)), e.sha256);
const changed = notebookPaths.filter(
  (p) => prior.files.find((e) => e.path === p)?.sha256 !== sha(read(p)),
);
const latest = Math.max(...changed.map((p) => statSync(p).mtimeMs));
const unitPaths = [`${dir}/frontend-release.json`, `${dir}/unit-capability-final.json`];
const files = new Map();
for (const p of unitPaths) {
  const report = json(p);
  for (const result of report.testResults)
    files.set(resolve(result.name).toLowerCase(), { result, report: p });
}
const walk = (p) =>
  readdirSync(p, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${p}/${e.name}`) : [`${p}/${e.name}`],
  );
assert.deepEqual(
  [...files.keys()].sort(),
  walk('tests/unit')
    .filter((p) => p.endsWith('.test.ts'))
    .map((p) => resolve(p).toLowerCase())
    .sort(),
);
let units = 0;
for (const { result } of files.values()) {
  assert.equal(result.status, 'passed');
  for (const t of result.assertionResults) assert.equal(t.status, 'passed');
  units += result.assertionResults.length;
}
assert.equal(units, 1511);
assert.ok(json(unitPaths[0]).startTime >= latest);
const unitSummary = `${dir}/unit-summary.json`;
save(unitSummary, {
  passed: units,
  singleAllGreenRun: false,
  reports: unitPaths.map(proof),
  files: [...files.values()].map(({ result, report }) => ({
    path: result.name,
    tests: result.assertionResults.length,
    report,
  })),
  note: 'Initial1510/1511 plus entire19-case practice-learning file rechecked after updating the old capability expectation; no product change or timing relaxation.',
});
const cases = (suites) =>
  suites.flatMap((s) => [
    ...(s.specs ?? []).flatMap((spec) => spec.tests.map((test) => ({ spec, test }))),
    ...cases(s.suites ?? []),
  ]);
const browserReports = [
    `${dir}/storage-release.json`,
    `${dir}/storage-known-final.json`,
    `${dir}/storage-future-final.json`,
  ],
  browserCases = new Map();
for (const p of browserReports) {
  const report = json(p);
  assert.deepEqual(report.errors, []);
  for (const entry of cases(report.suites)) {
    assert.equal(entry.test.projectName, 'chrome');
    browserCases.set(`${basename(entry.spec.file.replaceAll('\\', '/'))}: ${entry.spec.title}`, {
      ...entry,
      report: p,
    });
  }
}
assert.equal(browserCases.size, 36);
for (const { spec, test } of browserCases.values()) {
  assert.equal(spec.ok, true);
  assert.equal(test.results.length, 1);
  assert.equal(test.results[0].status, 'passed');
  assert.equal(test.results[0].retry, 0);
}
const browserSummary = `${dir}/storage-summary.json`;
save(browserSummary, {
  passed: 36,
  singleAllGreenRun: false,
  reports: browserReports.map(proof),
  cases: [...browserCases].map(([id, { report }]) => ({ id, report })),
  note: '34/36 plus two precise version-expectation repairs rechecked1/1 each; unknown future remains9, currentDB4. Original reports preserved.',
});
const candidatePath = `${dir}/candidate-release.json`,
  candidate = json(candidatePath);
assert.equal(candidate.stats.expected, 2);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
assert.deepEqual(candidate.errors, []);
assert.ok(Date.parse(candidate.stats.startTime) >= latest);
const baseline = json(`${dir}/baseline.json`),
  protectedFiles = baseline.files.filter(
    (e) => e.path.startsWith('engine/') || /web\/src\/generated\/.*\.wasm$/.test(e.path),
  );
// Generated WASM is ignored by Git; also bind all three actual binary files.
for (const e of protectedFiles) assert.equal(sha(read(e.path)), e.sha256);
const binaries = [
  'web/src/generated/c_viz_wasm_bg.wasm',
  'web/src/generated/algorithm/c_viz_algorithm_bg.wasm',
  'web/src/generated/memory/c_viz_memory_bg.wasm',
];
assert.equal(sha(read(binaries[0])), prior.engine.wasmSha256);
assert.equal(sha(read(binaries[2])), prior.memoryEngine.wasmSha256);
const inherited = `${dir}/inherited-engines.json`;
save(inherited, {
  inheritedOnly: true,
  prior: proof(priorPath),
  rustPassed: 507,
  originalIgnored: 1,
  fullRustSuiteRerun: false,
  protectedFiles,
  wasm: binaries.map(proof),
});
const evidence = {
  unitSummary: proof(unitSummary),
  storageSummary: proof(browserSummary),
  candidate: proof(candidatePath),
  inherited: proof(inherited),
  legacy25Build: proof(`${dir}/legacy25-dist-index.json`),
};
for (const p of [...unitPaths, ...browserReports])
  evidence[basename(p, '.json')] = { ...proof(p), aggregateInput: true };
save(target, {
  ...prior,
  releaseVersion: '1.0.26',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.25', ...proof(priorPath) },
  scope:
    '15.2 private real-Rust failure facts and receipt-derived mistake notebook; explicit knowledgeMarks partition,SAVE4/DB4/13store,strict predecessor migration and local manual self-assessment. No scheduling,badges,new reward or engine.',
  reason:
    '1511 unique frontend checks and36 native storage/history/recovery Chrome checks passed across recorded batches;2 candidate read-only notebook scenarios passed. Actual formal production mistakes,manual save/CAS/clear and original25 UI migration are separate following acceptance.',
  files: notebookPaths.map(proof),
  evidenceFreshness: { lastProductSourceModifiedAtUtc: new Date(latest).toISOString() },
  evidence,
});
const archive = '项目文档/验收/发布凭据/15.2-1.0.26';
mkdirSync(archive, { recursive: true });
const archived = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: archived });
console.log(
  JSON.stringify({
    release: '1.0.26',
    sources: notebookPaths.length,
    frontend: units,
    storageChrome: 36,
    candidate: 2,
    formalAcceptancePending: true,
  }),
);
