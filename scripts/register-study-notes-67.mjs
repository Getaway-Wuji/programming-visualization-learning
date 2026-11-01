import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { studyNotesPaths } from './study-notes-release-inputs.mjs';
const dir = '.artifacts/20.1',
  target = 'content/c/p0/blockly-release-1.0.67.json',
  priorPath = 'content/c/p0/blockly-release-1.0.66.json';
const read = (p) => readFileSync(p),
  json = (p) => JSON.parse(read(p).toString()),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (p) => ({ path: p, sha256: sha(read(p)) }),
  save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
assert.equal(existsSync(target), false);
const prior = json(priorPath),
  unit = json(`${dir}/unit-full-r2.json`),
  browser = json(`${dir}/r201-formal-r2.json`),
  regression = json(`${dir}/r201-snapshot-regression.json`);
assert.equal(
  sha(read(priorPath)),
  json('项目文档/验收/发布凭据/20.1-1.0.66/index.json').registration.sha256,
);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 2154);
assert.equal(unit.numFailedTests + unit.numPendingTests, 0);
for (const [r, count] of [
  [browser, 8],
  [regression, 37],
]) {
  assert.equal(r.stats.expected, count);
  assert.equal(r.stats.unexpected + r.stats.skipped + r.stats.flaky, 0);
  assert.deepEqual(r.errors, []);
}
for (const p of ['type-r3.log', 'lint-r3.log']) assert.equal(read(`${dir}/${p}`).length, 0);
assert.match(read(`${dir}/format-r4.log`).toString(), /All matched files use Prettier code style/);
const files = studyNotesPaths.map(proof),
  latest = Math.max(...studyNotesPaths.map((p) => statSync(p).mtimeMs));
assert.ok(unit.startTime >= latest, 'Final source checks must follow edits');
const changed = files.filter(
  (e) => prior.files.find((p) => p.path === e.path)?.sha256 !== e.sha256,
);
assert.deepEqual(
  changed.map((e) => e.path).sort(),
  [
    'scripts/build-p05-course.mjs',
    'scripts/restore-release-evidence.mjs',
    'web/src/study-notes/NotesPage.tsx',
    'web/src/study-notes/notes.css',
  ].sort(),
);
for (const [key, p] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
  ['generatorEngine', 'web/src/generated/practice/c_viz_practice_bg.wasm'],
])
  assert.equal(sha(read(p)), prior[key].wasmSha256);
const review = {
  task: '20.1',
  sources: files,
  frontendPassed: 2154,
  quality: { type: 0, lint: 0, format: 0 },
  priorFormalChrome: 8,
  priorSnapshotRegressionChrome: 37,
  changed,
  scope:
    'Successor fixes source preview line layout; each captured code line is a separate block. Original 66 and all successful/failed evidence preserved.',
  limitations:
    '8 task and 37 snapshot browser checks belong to 66. Final 67 geometry, workflow and screenshots follow registration. This source review is not task acceptance.',
  taskAccepted: false,
};
save(`${dir}/release-review67.json`, review);
const archive = '项目文档/验收/发布凭据/20.1-1.0.67';
mkdirSync(archive, { recursive: true });
const evidence = {},
  archived = [];
for (const name of ['unit-full-r2.json', 'release-review67.json']) {
  const file = `${name}.gz`,
    path = `${dir}/${file}`,
    bytes = gzipSync(read(`${dir}/${name}`));
  writeFileSync(path, bytes, { flag: 'wx' });
  writeFileSync(`${archive}/${file}`, bytes, { flag: 'wx' });
  const entry = proof(path);
  evidence[name.replace(/[^a-zA-Z]/g, '')] = entry;
  archived.push({ ...entry, file });
}
save(target, {
  ...prior,
  releaseVersion: '1.0.67',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.66', ...proof(priorPath) },
  scope: review.scope,
  reason:
    'Visual review fixes code lines collapsing horizontally; final 2154 units/types/lint/format passed; final browser verification pending separately.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 2154,
    candidateUniquePassed: 0,
  },
  files,
  evidence,
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: archived });
const frozen = `${dir}/sources-67`;
mkdirSync(frozen, { recursive: true });
save(`${frozen}/index.json`, {
  registration: proof(target),
  files: files.map((e, i) => {
    const file = `${String(i).padStart(4, '0')}.gz`;
    writeFileSync(`${frozen}/${file}`, gzipSync(read(e.path)), { flag: 'wx' });
    return { ...e, file };
  }),
});
console.log(JSON.stringify({ registered: '1.0.67', sources: files.length, taskAccepted: false }));
