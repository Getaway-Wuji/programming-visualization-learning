// Append P0.5-07 after genuine practice/integration gates; never overwrite a release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const priorVersion = process.env.BLOCKLY_PRIOR_VERSION ?? '1.0.9';
const nextVersion = process.env.BLOCKLY_NEXT_VERSION ?? '1.0.10';
assert.match(priorVersion, /^1\.0\.[0-9]+$/);
assert.equal(nextVersion, `1.0.${Number(priorVersion.split('.')[2]) + 1}`);
const priorPath = `content/c/p0/blockly-release-${priorVersion}.json`;
const priorBytes = read(priorPath);
const registration = JSON.parse(priorBytes);
assert.equal(registration.releaseVersion, priorVersion);
const reviewedPaths = [
  ...new Set([
    ...registration.files.map(({ path }) => path),
    'web/src/components/PracticeGuidance.tsx',
    'web/src/components/practice-experience.css',
    'web/src/components/LessonCompletion.tsx',
    'web/src/components/practice-progress.css',
    'web/src/learning/completion.ts',
    'web/src/pages/LessonPage.tsx',
  ]),
];
assert.equal(new Set(reviewedPaths).size, 20);
assert.equal(reviewedPaths.length, 20);
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
    process.env.BLOCKLY_GATE_REPORT ?? '.artifacts/P0.5-07/block-final-results.json',
    45,
    ['blocks.spec.ts', 'practice.spec.ts'],
  ],
  [
    'navigation',
    process.env.BLOCKLY_NAV_REPORT ?? '.artifacts/P0.5-07/nav-final-results.json',
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
  process.env.BLOCKLY_INTERACTION_REPORT ?? '.artifacts/P0.5-07/interaction-final-results.json';
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
const practicePath =
  process.env.BLOCKLY_PRACTICE_REPORT ?? '.artifacts/P0.5-07/experience-final-results.json';
const practiceBytes = read(practicePath);
const practice = JSON.parse(practiceBytes);
assert.equal(practice.stats.expected, 15);
for (const counter of ['unexpected', 'skipped', 'flaky']) assert.equal(practice.stats[counter], 0);
assert.ok(Date.parse(practice.stats.startTime) >= latestSourceChange);
assert.deepEqual(practice.config.projects.map((project) => project.name).sort(), [
  'chrome',
  'edge',
  'firefox-automation',
]);
assert.ok(practice.config.projects.every((project) => project.retries === 0));
assert.ok(
  specs(practice.suites).every((spec) => spec.file.endsWith('practice-experience.spec.ts')),
);
evidence.practiceExperience = {
  path: practicePath,
  sha256: sha(practiceBytes),
  passed: practice.stats.expected,
  retries: 0,
};
const unitPath = process.env.BLOCKLY_UNIT_REPORT ?? '.artifacts/P0.5-07/unit-final.json';
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
  'P0.5-07 starts independent exercises with main and controlled inputs only. Explicit correction mode retains the earlier unfinished solution and each mode keeps its own ephemeral draft. Progressive hints and read-only course examples remain separate. Real first-test execution never authorizes learning; full submission retains every original Rust test and teaching check. Durable compatible snapshot history drives the lesson checklist, with original retry and reward idempotency. The20 reviewed files extend the earlier14 by guidance, completion UI, its pure durable projection and lesson integration. Final sources passed the genuine45+3+15 integration gates,15 new practice experience checks and complete frontend suite. No C, Step, judge, SAVE, dependency, reward, content identity or runtime budget changes.';
registration.priorRegistration = { sha256: sha(priorBytes), path: priorPath };
writeFileSync(
  new URL(`../content/c/p0/blockly-release-${nextVersion}.json`, import.meta.url),
  JSON.stringify(registration, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  `Blockly ${nextVersion} registered after 45+3 real-browser and complete frontend checks.`,
);
