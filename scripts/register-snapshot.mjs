// Append an immutable reviewed successor; no rewriting of35/36/37 or their evidence.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { snapshotPaths } from './snapshot-release-inputs.mjs';
const dir = '.artifacts/16.3';
const read = (path) => readFileSync(path);
const json = (path) =>
  JSON.parse(
    read(path)
      .toString()
      .replace(/^\uFEFF/, ''),
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = (path) => ({ path, sha256: sha(read(path)) });
const save = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const priorPath = 'content/c/p0/blockly-release-1.0.37.json',
  prior = json(priorPath);
const target = 'content/c/p0/blockly-release-1.0.38.json';
assert.equal(existsSync(target), false);
assert.equal(snapshotPaths.length, 220);
const baseline = json(`${dir}/baseline.json`);
for (const item of [...baseline.prior, ...baseline.external])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
for (const item of Object.values(prior.evidence)) assert.equal(sha(read(item.path)), item.sha256);
const inherited = json('.artifacts/16.2/inherited-engines.json');
for (const item of [...inherited.protectedFiles, ...inherited.wasm])
  assert.equal(sha(read(item.path)), item.sha256, item.path);
save(`${dir}/inherited-engines.json`, {
  ...inherited,
  inheritedFrom: proof('.artifacts/16.2/inherited-engines.json'),
  task: '16.3',
  fullRustSuiteRerun: false,
});
const latest = Math.max(...snapshotPaths.map((path) => statSync(path).mtimeMs));
const units = json(`${dir}/units-close.json`),
  candidate = json(`${dir}/candidate-final.json`);
assert.equal(units.numTotalTests, 200);
assert.equal(units.numFailedTests, 0);
assert.equal(units.numPassedTests, 200);
assert.ok(units.startTime >= latest, 'Final unit gate must follow the final source');
assert.equal(candidate.stats.expected, 37);
assert.equal(candidate.stats.unexpected + candidate.stats.skipped + candidate.stats.flaky, 0);
assert.deepEqual(candidate.errors, []);
assert.ok(Date.parse(candidate.stats.startTime) >= latest);
const visual = json(`${dir}/taste/inspect-accepted/report.json`);
assert.equal(visual.findings.filter((item) => item.level === 'FAIL').length, 0);
assert.ok(Date.parse(visual.at) >= latest);
save(`${dir}/visual.json`, visual);
for (const name of [
  'typecheck-close',
  'lint-close',
  'format-close',
  'build-candidate-final',
  'visual-accepted',
  'ui-lint-close',
])
  assert.equal(Number(read(`${dir}/${name}.exit`).toString().trim()), 0, name);
save(`${dir}/candidate-build.json`, json(`${dir}/course-build.json`));
save(`${dir}/release-review.json`, {
  task: '16.3',
  format: 'SNAPSHOT-01 1.0.0',
  latestSourceAt: new Date(latest).toISOString(),
  scope:
    'Actual paused current state from the seven original C cases and ten existing C/C++ memory observations. Independent JSON and reflowed PNG downloads; PNG carries identical JSON in uncompressed UTF-8 iTXt. Original execution/learning/storage untouched; source/input/run/cursor/view/session/unmount changes revoke pending async captures.',
  budgets: {
    exportMs: 5000,
    jsonBytes: 2097152,
    pngBytes: 8388608,
    width: 1440,
    maxHeight: 8192,
    objects: 512,
    frames: 64,
    liveSlots: 2048,
  },
  prior: proof(priorPath),
  units: proof(`${dir}/units-close.json`),
  candidate: proof(`${dir}/candidate-final.json`),
  candidateMode:
    'Explicit reviewed legacy content fallback; current-course verification remains pending until formal38 build.',
  visual: proof(`${dir}/visual.json`),
  fullRustSuiteRerun: false,
  failureReportsPreserved: [
    'unit-first',
    'typecheck-first',
    'candidate-download-first',
    'candidate-download-second',
    'lint-final',
  ],
  uiLintWarning: 'padStart(2) encodes SHA-256 bytes, not ornamental numbered labels.',
  formalCurrentCoursePending: true,
});
const evidence = Object.fromEntries(
  [
    'units-close.json',
    'candidate-final.json',
    'candidate-build.json',
    'inherited-engines.json',
    'visual.json',
    'release-review.json',
  ].map((name, index) => [`snapshotGate${index + 1}`, proof(`${dir}/${name}`)]),
);
save(target, {
  ...prior,
  releaseVersion: '1.0.38',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.37', ...proof(priorPath) },
  scope:
    '16.3 current paused JSON/PNG snapshot export; prior courses, engines, comparison, challenge and learning gates inherited unchanged.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    candidatePassed: 37,
    frontendPassed: 200,
  },
  reason:
    'Actual Worker download checks and complete current-state comparisons passed. Immutable predecessor37/36/35 and all earlier failures retained. Formal38 current-course downloads and affected browser regressions remain separately required.',
  supplementalReason:
    'SNAPSHOT-01 1.0.0; no whole traces, no new learning facts, no automatic persistence or upload.',
  files: snapshotPaths.map(proof),
  evidence,
});
const archive = '项目文档/验收/发布凭据/16.3-1.0.38';
mkdirSync(archive, { recursive: true });
const files = Object.values(evidence).map((item) => {
  const file = basename(item.path);
  writeFileSync(`${archive}/${file}`, read(item.path), { flag: 'wx' });
  return { ...item, file };
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.38',
    sources: snapshotPaths.length,
    frontend: 200,
    candidate: 37,
    formalPending: true,
  }),
);
