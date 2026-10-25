// Append the reviewed P0.5-02 theme integration; never overwrite a release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const priorVersion = process.env.BLOCKLY_PRIOR_VERSION ?? '1.0.5';
const nextVersion = process.env.BLOCKLY_NEXT_VERSION ?? '1.0.6';
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
    process.env.BLOCKLY_GATE_REPORT ?? '.artifacts/P0.5-02/block-gate-delivery.json',
    45,
    ['blocks.spec.ts', 'practice.spec.ts'],
  ],
  [
    'navigation',
    process.env.BLOCKLY_NAV_REPORT ?? '.artifacts/P0.5-02/nav-gate-delivery.json',
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
const unitPath = process.env.BLOCKLY_UNIT_REPORT ?? '.artifacts/P0.5-02/unit-delivery.json';
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
  'P0.5-02 delivery retains the six adopted appearance profiles, independent colors, settings-only controls, SAVE2/DB2 compatibility and same-tab settings draft/accepted-trace preservation from 1.0.5. A measured 9-15 second native AudioContext stall in Blockly 13.4.0 trashcan initialization is fixed for this silent editor: synchronous injection temporarily hides the audio feature and restores its exact descriptor in finally, without modifying dependencies or retaining a browser API replacement. The existing classic renderer CSS class and two-hash CSP remain. Real Rust generation/execution/judgement and learning identities are unchanged. The 45+3 real integration gates and complete frontend checks, including audio restoration invariants, were repeated after the final registered source edits.';
registration.priorRegistration = { sha256: sha(priorBytes), path: priorPath };
writeFileSync(
  new URL(`../content/c/p0/blockly-release-${nextVersion}.json`, import.meta.url),
  JSON.stringify(registration, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  `Blockly ${nextVersion} registered after 45+3 real-browser and complete frontend checks.`,
);
