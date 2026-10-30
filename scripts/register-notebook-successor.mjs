import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { notebookPaths } from './notebook-release-inputs.mjs';
const dir = '.artifacts/15.2',
  read = (p) => readFileSync(p),
  json = (p) =>
    JSON.parse(
      read(p)
        .toString()
        .replace(/^\uFEFF/, ''),
    ),
  sha = (b) => createHash('sha256').update(b).digest('hex'),
  proof = (path) => ({ path, sha256: sha(read(path)) });
const priorPath = 'content/c/p0/blockly-release-1.0.26.json',
  prior = json(priorPath),
  target = 'content/c/p0/blockly-release-1.0.27.json';
assert.equal(existsSync(target), false);
const allowed = new Set([
  'web/src/review-notebook/NotebookPage.tsx',
  'scripts/build-p05-course.mjs',
  'scripts/restore-release-evidence.mjs',
]);
for (const entry of prior.files)
  if (!allowed.has(entry.path)) assert.equal(sha(read(entry.path)), entry.sha256, entry.path);
const candidate = json(`${dir}/candidate-successor.json`);
assert.equal(candidate.stats.expected, 2);
assert.equal(candidate.stats.unexpected + candidate.stats.flaky + candidate.stats.skipped, 0);
const unit = json(`${dir}/unit-summary.json`);
assert.equal(unit.passed, 1511);
const evidence = {
  ...Object.fromEntries(Object.entries(prior.evidence).map(([k, e]) => [k, { ...e }])),
  candidateSuccessor: proof(`${dir}/candidate-successor.json`),
  formal26: { ...proof(`${dir}/formal-first.json`), accepted: false },
};
const changedProof = `${dir}/successor-review.json`;
writeFileSync(
  changedProof,
  JSON.stringify(
    {
      reason:
        'Notebook renders unknown for damaged receipts/aliases/progress rather than an empty collection;27 selector added, no execution/storage semantic change.',
      changed: [...allowed].map(proof),
      unitExisting: prior.evidence.unitSummary,
      targetedTypecheck: proof(`${dir}/typecheck-successor.log`),
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
evidence.successorReview = proof(changedProof);
writeFileSync(
  target,
  JSON.stringify(
    {
      ...prior,
      releaseVersion: '1.0.27',
      registeredAt: '2026-10-31',
      reviewedAtUtc: new Date().toISOString(),
      supersedes: { version: '1.0.26', ...proof(priorPath) },
      scope:
        '15.2 notebook successor: damaged core summaries explicitly unknown; actual same controlled failure facts and SAVE4 mark partition, no engine change.',
      reason:
        '26 retained with formal-first6/10 report. Arithmetic eligibility and deadline/clear QA preconditions corrected;2 final-source candidate checks pass. Formal27 real behavior acceptance follows separately.',
      files: notebookPaths.map(proof),
      evidence,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
const archive = '项目文档/验收/发布凭据/15.2-1.0.27';
mkdirSync(archive, { recursive: true });
const entries = Object.values(evidence).map((e) => {
  const file = basename(e.path);
  writeFileSync(`${archive}/${file}`, read(e.path), { flag: 'wx' });
  return { ...e, file };
});
writeFileSync(
  `${archive}/index.json`,
  JSON.stringify({ version: '1.0.0', registration: proof(target), files: entries }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  `Registered27,${notebookPaths.length} sources;26 and failed formal originals retained.`,
);
