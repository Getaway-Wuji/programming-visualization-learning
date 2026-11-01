import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { notesDownloadPaths } from './notes-download-release-inputs.mjs';
const dir = '.artifacts/20.2',
  target = 'content/c/p0/blockly-release-1.0.68.json',
  priorPath = 'content/c/p0/blockly-release-1.0.67.json';
const read = (p) => readFileSync(p),
  json = (p) => JSON.parse(read(p).toString()),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (p) => ({ path: p, sha256: sha(read(p)) }),
  save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
assert.equal(existsSync(target), false);
const prior = json(priorPath),
  unit = json(`${dir}/unit-full-r2.json`);
assert.equal(
  sha(read(priorPath)),
  json('项目文档/验收/发布凭据/20.1-1.0.67/index.json').registration.sha256,
);
assert.equal(unit.success, true);
assert.equal(unit.numPassedTests, 2171);
assert.equal(unit.numFailedTests + unit.numPendingTests, 0);
for (const path of ['type-r3.log', 'lint-r4.log']) assert.equal(read(`${dir}/${path}`).length, 0);
assert.match(read(`${dir}/format-r4.log`).toString(), /All matched files use Prettier code style/);
const files = notesDownloadPaths.map(proof),
  latest = Math.max(...notesDownloadPaths.map((p) => statSync(p).mtimeMs));
assert.ok(unit.startTime >= latest, 'Unit verification predates a source edit');
for (const [key, p] of [
  ['engine', 'web/src/generated/c_viz_wasm_bg.wasm'],
  ['memoryEngine', 'web/src/generated/memory/c_viz_memory_bg.wasm'],
  ['algorithmEngine', 'web/src/generated/algorithm/c_viz_algorithm_bg.wasm'],
  ['advancedEngine', 'web/src/generated/advanced/c_viz_advanced_bg.wasm'],
  ['generatorEngine', 'web/src/generated/practice/c_viz_practice_bg.wasm'],
])
  assert.equal(sha(read(p)), prior[key].wasmSha256);
const review = {
  task: '20.2',
  sources: files,
  frontendPassed: 2171,
  newDownloadUnitTests: 17,
  quality: { type: 0, lint: 0, format: 0 },
  scope:
    'Browser-only selected Markdown/PNG/JSON UTF-8 ZIP download, literal text and fenced source, cancellable bounded generation, final meta-only readonly generation/revision gate; no persistence, upload or new language.',
  limitations:
    'Source registration follows final unit and candidate build checks. Formal real saved-record downloads, Python ZIP/PNG verification, independent Markdown reader and lifecycle/native storage checks follow registration and are not claimed here. Candidate is intentionally unauthorized for durable learning.',
  taskAccepted: false,
};
save(`${dir}/release-review68.json`, review);
const archive = '项目文档/验收/发布凭据/20.2-1.0.68';
mkdirSync(archive, { recursive: true });
const evidence = {},
  archived = [];
for (const name of ['unit-full-r2.json', 'release-review68.json']) {
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
  releaseVersion: '1.0.68',
  registeredAt: '2026-11-01',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.67', ...proof(priorPath) },
  scope: review.scope,
  reason:
    '2171 frontend tests including 17 new download checks, types/lint/format and candidate build; source approved, formal download acceptance follows separately.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 2171,
    candidateUniquePassed: 0,
  },
  files,
  evidence,
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files: archived });
const frozen = `${dir}/sources-68`;
mkdirSync(frozen, { recursive: true });
save(`${frozen}/index.json`, {
  registration: proof(target),
  files: files.map((e, i) => {
    const file = `${String(i).padStart(4, '0')}.gz`;
    writeFileSync(`${frozen}/${file}`, gzipSync(read(e.path)), { flag: 'wx' });
    return { ...e, file };
  }),
});
console.log(JSON.stringify({ registered: '1.0.68', sources: files.length, taskAccepted: false }));
