// Append P0.5-06 after genuine interaction/integration gates; never overwrite a release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const priorVersion = process.env.BLOCKLY_PRIOR_VERSION ?? '1.0.8';
const nextVersion = process.env.BLOCKLY_NEXT_VERSION ?? '1.0.9';
assert.match(priorVersion, /^1\.0\.[0-9]+$/);
assert.equal(nextVersion, `1.0.${Number(priorVersion.split('.')[2]) + 1}`);
const priorPath = `content/c/p0/blockly-release-${priorVersion}.json`;
const priorBytes = read(priorPath);
const registration = JSON.parse(priorBytes);
assert.equal(registration.releaseVersion, priorVersion);
const reviewedPaths = [
  ...new Set([
    ...registration.files.map(({ path }) => path),
    'web/src/blocks/interaction.ts',
    'web/src/blocks/block-interaction.css',
  ]),
];
assert.equal(new Set(reviewedPaths).size, 14);
assert.equal(reviewedPaths.length, 14);
const latestSourceChange = Math.max(
  ...reviewedPaths
    .map((path) => ({ path }))
    .map(({ path }) => statSync(new URL(`../${path}`, import.meta.url)).mtimeMs),
);
const specs = (suites) =>
  suites.flatMap((suite) => [...(suite.specs ?? []), ...specs(suite.suites ?? [])]);
const evidence = {};
for (const [key, path, expected, allowedFiles] of [
  [
    'browser',
    process.env.BLOCKLY_GATE_REPORT ?? '.artifacts/P0.5-06/block-final-results.json',
    45,
    ['blocks.spec.ts', 'practice.spec.ts'],
  ],
  [
    'navigation',
    process.env.BLOCKLY_NAV_REPORT ?? '.artifacts/P0.5-06/nav-final-results.json',
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
const interactionPath =
  process.env.BLOCKLY_INTERACTION_REPORT ?? '.artifacts/P0.5-06/interaction-final-results.json';
const interactionBytes = read(interactionPath);
const interaction = JSON.parse(interactionBytes);
assert.equal(interaction.stats.unexpected, 0);
assert.equal(interaction.stats.skipped, 0);
assert.equal(interaction.stats.flaky, 0);
assert.equal(interaction.stats.expected, 15);
assert.ok(Date.parse(interaction.stats.startTime) >= latestSourceChange);
assert.deepEqual(interaction.config.projects.map((project) => project.name).sort(), [
  'chrome',
  'edge',
  'firefox-automation',
]);
assert.ok(interaction.config.projects.every((project) => project.retries === 0));
assert.ok(
  specs(interaction.suites).every((spec) => spec.file.endsWith('block-interaction.spec.ts')),
);
evidence.interaction = {
  path: interactionPath,
  sha256: sha(interactionBytes),
  passed: interaction.stats.expected,
  retries: 0,
};
const unitPath = process.env.BLOCKLY_UNIT_REPORT ?? '.artifacts/P0.5-06/unit-final.json';
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
registration.files = reviewedPaths.map((path) => ({ path, sha256: sha(read(path)) }));
registration.evidence = {
  ...evidence,
  generator: { ...evidence.frontend, includedSuite: 'block-generator.test.ts' },
  workspace: { ...evidence.frontend, includedSuite: 'block-workspace.test.ts' },
};
registration.reason =
  'P0.5-06 collapses the optional keyboard block editor by default and retains native disclosure/focus and the same mounted workspace. Scoped Blockly13.4 public Dragger/Strategy hooks normalize finite snap search to28 CSS pixels at all existing zoom levels, including flyout clones; original connection legality, insertion preview, undo groups and source generation remain native. Edge dwell pans only inside the real viewport, with actual clamped scroll compensation and cleanup. Short candidate feedback and undo/redo controls follow the six adopted themes. The14 registered files include the original12 plus interaction.ts and block-interaction.css. After their final edits, the genuine45 block/practice and3 named navigation gates, complete frontend checks and the new real-pointer interaction suite passed. No C, Step, judge, SAVE, dependency, reward, course/case identity or runtime budget changes.';
registration.priorRegistration = { sha256: sha(priorBytes), path: priorPath };
writeFileSync(
  new URL(`../content/c/p0/blockly-release-${nextVersion}.json`, import.meta.url),
  JSON.stringify(registration, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  `Blockly ${nextVersion} registered after 45+3 real-browser and complete frontend checks.`,
);
