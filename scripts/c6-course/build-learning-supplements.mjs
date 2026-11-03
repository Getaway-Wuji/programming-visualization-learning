import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { format, resolveConfig } from 'prettier';
const bytes = readFileSync('web/public/content/course/course-bundle-1.2.0.json');
assert.equal(
  createHash('sha256').update(bytes).digest('hex'),
  '0a0f9de9cd62a694fe8cf9b43d8c10d5b70d1decc9ab9fd640743b083dc78b50',
);
const reviewed = JSON.parse(bytes);
const ids = new Set(
  [
    ...JSON.parse(readFileSync('content/c/bugs/questions-1.0.0.json')).questions,
    ...JSON.parse(readFileSync('content/cpp/bugs/questions-1.0.0.json')).questions,
  ].map((q) => q.exerciseRef.id),
);
const exercises = reviewed.practice.exercises.filter((e) => ids.has(e.id));
assert.equal(exercises.length, 4);
const programIds = new Set(exercises.map((e) => e.programRef.id));
const inputIds = new Set(
  reviewed.practice.programs.filter((p) => programIds.has(p.id)).map((p) => p.inputRef.id),
);
const judgeIds = new Set(exercises.map((e) => e.judgeRef.id));
const value = {
  supplementVersion: '1.0.0',
  reviewedBundleSha256: '0a0f9de9cd62a694fe8cf9b43d8c10d5b70d1decc9ab9fd640743b083dc78b50',
  // The exact frozen authority catalog is internal. Its old lessons are never displayed or credited.
  learning: reviewed.learning,
  practice: {
    ...reviewed.practice,
    exercises,
    programs: reviewed.practice.programs.filter((p) => programIds.has(p.id)),
    inputSpecs: reviewed.practice.inputSpecs.filter((p) => inputIds.has(p.id)),
    judgeProfiles: reviewed.practice.judgeProfiles.filter((p) => judgeIds.has(p.id)),
  },
};
const text = JSON.stringify(value) + '\n';
const file = 'content/c/primer6-learning/supplements-1.0.0.json';
const hash = createHash('sha256').update(text).digest('hex');
const pin = await format(
  `// Generated from the exact reviewed independent Bug resources.\nexport const c6SupplementRelease = ${JSON.stringify({ bytes: Buffer.byteLength(text), sha256: hash })} as const;\n`,
  { ...(await resolveConfig('.prettierrc.json')), parser: 'typescript' },
);
for (const [path, content] of [
  [file, text],
  ['web/src/c6-learning/supplements.generated.ts', pin],
]) {
  if (process.argv.includes('--write')) writeFileSync(path, content);
  else assert.equal(readFileSync(path, 'utf8'), content, `${path} is stale`);
}
console.log(
  JSON.stringify({
    file,
    bytes: Buffer.byteLength(text),
    sha256: hash,
    independentExercises: ids.size,
  }),
);
