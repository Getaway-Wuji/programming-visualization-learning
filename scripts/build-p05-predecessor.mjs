// Reproduce the already reviewed fallback bytes; this grants no new capability.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const registrationPath = 'content/c/p0/blockly-release-1.0.13.json';
const registration = JSON.parse(await read(registrationPath));
assert.equal(registration.releaseVersion, '1.0.13');
assert.equal(registration.files.length, 36);
const predecessor = JSON.parse(await read('content/learning/p05-predecessors-1.0.0.json'));
const readingBytes = await read('web/public/content/reading/course-reading-1.0.0.json');
const practiceBytes = await read('web/public/content/practice/course-practice-1.0.0.json');
const sourceBytes = await read('content/c/p0/course-1.0.1.json');
for (const [path, bytes] of [
  ['content/c/p0/course-1.0.1.json', sourceBytes],
  ['web/public/content/reading/course-reading-1.0.0.json', readingBytes],
  ['web/public/content/practice/course-practice-1.0.0.json', practiceBytes],
])
  assert.equal(sha(bytes), predecessor.sources.find((entry) => entry.path === path)?.sha256);
const reading = JSON.parse(readingBytes);
assert.deepEqual({ ...reading.catalog, purpose: 'course-practice' }, predecessor.course);
const resource = {
  learningVersion: '1.0.0',
  sourceSha256: sha(sourceBytes),
  readingSha256: sha(readingBytes),
  practiceSha256: sha(practiceBytes),
  blocksBuildSha256: sha(JSON.stringify(registration.files)),
  capabilities: ['lesson.started', 'lesson.study-confirmed', 'exercise.passed'],
  catalog: { ...reading.catalog, purpose: 'course-practice' },
};
const bytes = Buffer.from(JSON.stringify(resource, null, 2) + '\n');
const path = 'web/public/content/learning/course-learning-1.0.13.json';
assert.equal(sha(bytes), predecessor.sources.find((entry) => entry.path === path)?.sha256);
await mkdir(new URL('web/public/content/learning/', root), { recursive: true });
await writeFile(new URL(path, root), bytes, { flag: 'wx' }).catch(async (error) => {
  if (error.code !== 'EEXIST') throw error;
  assert.deepEqual(await read(path), bytes, 'Reviewed predecessor bytes are immutable');
});
const manifest = {
  file: path.replace(/^web\/public\//, ''),
  bytes: bytes.length,
  sha256: sha(bytes),
  readingSha256: resource.readingSha256,
  practiceSha256: resource.practiceSha256,
  sourceSha256: resource.sourceSha256,
};
await writeFile(
  new URL('web/public/content/learning/manifest.json', root),
  JSON.stringify(
    {
      ...manifest,
      capabilities: resource.capabilities,
      fullContentPublication: false,
      goalsConfigurable: false,
      rewardPolicy: false,
      blockRegistrationSha256: sha(await read(registrationPath)),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Reproduced exact reviewed 1.0.13 predecessor; no current source registration inferred.',
);
