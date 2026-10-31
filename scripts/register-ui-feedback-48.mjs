import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { uiFeedbackPaths } from './ui-feedback-release-inputs.mjs';

const dir = '.artifacts/UI-20261031';
const read = (p) => readFileSync(p);
const json = (p) =>
  JSON.parse(
    read(p)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (b) => createHash('sha256').update(b).digest('hex');
const proof = (p) => ({ path: p, sha256: sha(read(p)) });
const save = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const target = 'content/c/p0/blockly-release-1.0.48.json';
assert.equal(existsSync(target), false, 'A reviewed release is immutable.');
const previous = 'content/c/p0/blockly-release-1.0.47.json',
  prior = json(previous);
assert.equal(
  sha(read(previous)),
  json('项目文档/验收/发布凭据/16.10-1.0.47/index.json').registration.sha256,
);
for (const entry of Object.values(prior.evidence))
  assert.equal(sha(read(entry.path)), entry.sha256);
assert.equal(new Set(uiFeedbackPaths).size, uiFeedbackPaths.length);
const units = json(`${dir}/units-controlled.json`),
  browser = json(`${dir}/browser-candidate-second.json`);
assert.equal(units.numPassedTests, 1854);
assert.equal(units.numFailedTests + units.numPendingTests, 0);
assert.equal(browser.stats.expected, 18);
assert.equal(browser.stats.unexpected + browser.stats.skipped + browser.stats.flaky, 0);
assert.deepEqual(browser.errors, []);
for (const name of ['typecheck-final', 'lint', 'build-candidate-second'])
  assert.equal(Number(read(`${dir}/${name}.exit`).toString().trim()), 0);
const preparedPath = 'web/src/generated/prepared-sources.ts';
assert.equal(
  sha(read(preparedPath)),
  prior.files.find((item) => item.path === preparedPath).sha256,
  'Rebuilt prepared sources must retain their exact reviewed bytes.',
);
const sources = uiFeedbackPaths.map(proof),
  latest = Math.max(
    ...uiFeedbackPaths.filter((path) => path !== preparedPath).map((p) => statSync(p).mtimeMs),
  );
assert.ok(units.startTime >= latest, 'Units must cover the final source.');
assert.ok(
  Date.parse(browser.stats.startTime) >= latest,
  'Browser evidence must cover the final source.',
);
save(`${dir}/release-review.json`, {
  task: 'UI-20261031',
  sourceCount: sources.length,
  frontendPassed: 1854,
  candidateChromePassed: 18,
  scope:
    'User-requested home layout, easy-to-hard catalog, real-trace key stops with full detail retained, explicit key-view coverage and readable array values. No new algorithms, language, execution semantics, persistence schema or rewards.',
  limitations:
    'One representative minimal theme/Chrome. No new full performance, other browsers, six-theme sweep or remote deployment. Existing engine/source boundaries retained.',
  failuresRetained: [
    'initial key-unit fixture called prepareClassic with an array instead of draft text',
    'two unrestricted parallel unit batches exceeded an existing Bug test initialization wait; isolated and controlled 2-worker full run passed',
    'candidate first catalog hydration wait and three families of raw/key slider mismatch, fixed and all18 passed',
  ],
  sourceProof: sources,
});
const evidence = {};
const archive = '项目文档/验收/发布凭据/UI-20261031-1.0.48';
mkdirSync(archive, { recursive: true });
const files = [];
for (const name of [
  'units-controlled.json',
  'browser-candidate-second.json',
  'release-review.json',
]) {
  const p = `${dir}/${name}.gz`,
    file = `${name}.gz`;
  writeFileSync(p, gzipSync(read(`${dir}/${name}`)), { flag: 'wx' });
  writeFileSync(`${archive}/${file}`, read(p), { flag: 'wx' });
  const item = proof(p);
  evidence[name.replace(/[^a-zA-Z]/g, '')] = item;
  files.push({ ...item, file });
}
save(target, {
  ...prior,
  releaseVersion: '1.0.48',
  registeredAt: '2026-10-31',
  reviewedAtUtc: new Date().toISOString(),
  supersedes: { version: '1.0.47', ...proof(previous) },
  scope: 'User-requested UI corrections to the delivered P1 product; no entry into17/21.',
  reason:
    '1854 full frontend checks and18 real Chrome candidate checks pass; formal viewing-save and array-label verification follows registration.',
  evidenceFreshness: {
    latestSourceAt: new Date(latest).toISOString(),
    frontendPassed: 1854,
    candidateUniquePassed: 18,
  },
  files: sources,
  evidence,
});
save(`${archive}/index.json`, { version: '1.0.0', registration: proof(target), files });
console.log(
  JSON.stringify({
    registered: '1.0.48',
    sources: sources.length,
    frontend: 1854,
    candidateChrome: 18,
  }),
);
