// Append the reviewed 11.4 integration registration; never overwrite a release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const priorVersion = process.env.BLOCKLY_PRIOR_VERSION ?? '1.0.3';
const nextVersion = process.env.BLOCKLY_NEXT_VERSION ?? '1.0.4';
assert.match(priorVersion, /^1\.0\.[0-9]+$/);
assert.equal(nextVersion, `1.0.${Number(priorVersion.split('.')[2]) + 1}`);
const priorPath = `content/c/p0/blockly-release-${priorVersion}.json`;
const priorBytes = read(priorPath);
const registration = JSON.parse(priorBytes);
assert.equal(registration.releaseVersion, priorVersion);
const latestSourceChange = Math.max(
  ...registration.files.map(({ path }) => statSync(new URL(`../${path}`, import.meta.url)).mtimeMs),
);
const specs = (suites) =>
  suites.flatMap((suite) => [...(suite.specs ?? []), ...specs(suite.suites ?? [])]);
const evidence = {};
for (const [key, path, expected, allowedFiles] of [
  [
    'browser',
    process.env.BLOCKLY_GATE_REPORT ?? '.artifacts/11.4/block-gate-second.json',
    45,
    ['blocks.spec.ts', 'practice.spec.ts'],
  ],
  [
    'navigation',
    process.env.BLOCKLY_NAV_REPORT ?? '.artifacts/11.4/nav-gate-second.json',
    3,
    ['navigation.spec.ts'],
  ],
]) {
  const bytes = read(path);
  const report = JSON.parse(bytes);
  assert.equal(report.stats.expected, expected);
  for (const counter of ['unexpected', 'skipped', 'flaky']) assert.equal(report.stats[counter], 0);
  assert.ok(report.config.projects.every((entry) => entry.retries === 0));
  assert.deepEqual(report.config.projects.map((entry) => entry.name).sort(), [
    'chrome',
    'edge',
    'firefox-automation',
  ]);
  assert.ok(
    Date.parse(report.stats.startTime) >= latestSourceChange,
    'Repeat the gate after the last registered source edit',
  );
  const checkedSpecs = specs(report.suites);
  assert.ok(
    checkedSpecs.length > 0 &&
      checkedSpecs.every((entry) =>
        allowedFiles.includes(entry.file.replaceAll('\\', '/').split('/').at(-1)),
      ),
  );
  if (key === 'navigation')
    assert.ok(checkedSpecs.every((entry) => entry.title.includes('workspaces keep real blocks')));
  evidence[key] = { sha256: sha(bytes), path, retries: 0, passed: expected };
}
const unitPath = process.env.BLOCKLY_UNIT_REPORT ?? '.artifacts/11.4/unit-candidate-07.json';
const unitBytes = read(unitPath);
const unit = JSON.parse(unitBytes);
assert.equal(unit.success, true);
assert.equal(unit.numFailedTests, 0);
assert.equal(unit.numPendingTests, 0);
assert.equal(unit.numPassedTests, unit.numTotalTests);
assert.ok(
  unit.startTime >= latestSourceChange,
  'Repeat complete frontend checks after the last registered source edit',
);
for (const name of ['block-generator.test.ts', 'block-workspace.test.ts'])
  assert.ok(
    unit.testResults.some((entry) => entry.name.endsWith(name) && entry.status === 'passed'),
  );
evidence.frontend = { sha256: sha(unitBytes), path: unitPath, passed: unit.numPassedTests };
registration.releaseVersion = nextVersion;
registration.reviewedAtUtc = new Date().toISOString();
registration.files = registration.files.map(({ path }) => ({ path, sha256: sha(read(path)) }));
registration.evidence = {
  ...evidence,
  generator: { ...evidence.frontend, includedSuite: 'block-generator.test.ts' },
  workspace: { ...evidence.frontend, includedSuite: 'block-workspace.test.ts' },
};
registration.reason =
  '11.4 restores the empty-review boundary after automatic published-source preparation: unsubmitted drafts stay available in the practice workspace, while review source and animation require an accepted real result, including genuine failure prefixes. The keyboard block editor also retains its valid target when the native canvas loses focus; explicit empty selection, deletion and connection legality remain guarded. Real Rust execution/judgement, invalidation and learning rules remain guarded. The 45+3 real integration gate and complete frontend checks were repeated after the registered source edits.';
registration.priorRegistration = { sha256: sha(priorBytes), path: priorPath };
writeFileSync(
  new URL(`../content/c/p0/blockly-release-${nextVersion}.json`, import.meta.url),
  JSON.stringify(registration, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  `Blockly ${nextVersion} registered after 45+3 real-browser and complete frontend checks.`,
);
