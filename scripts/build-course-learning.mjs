import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { format } from 'prettier';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const registrationPath = 'content/c/p0/blockly-release-1.0.10.json';
// This reviewed source manifest is registered only after the 10.3 real-browser gate.
const registration = JSON.parse(await read(registrationPath));
assert.equal(registration.releaseVersion, '1.0.10');
assert.equal(registration.library, 'blockly');
assert.equal(registration.libraryVersion, '13.4.0');
assert.equal(registration.acceptanceGate, '10.3-real-blockly-rust-playback');
assert.equal(registration.blockTypes.length, 20);
assert.equal(new Set(registration.blockTypes).size, 20);
const expectedFiles = [
  'web/src/blocks/model.ts',
  'web/src/blocks/generator.ts',
  'web/src/blocks/starters.ts',
  'web/src/blocks/definitions.ts',
  'web/src/blocks/workspace.ts',
  'web/src/blocks/BlockWorkspace.tsx',
  'web/src/blocks/blocks.css',
  'web/src/practice/session.ts',
  'web/src/practice/react.tsx',
  'web/src/practice/block-location.ts',
  'web/src/components/PracticeExecution.tsx',
  'web/src/styles.css',
  'web/src/blocks/interaction.ts',
  'web/src/blocks/block-interaction.css',
  'web/src/components/PracticeGuidance.tsx',
  'web/src/components/practice-experience.css',
  'web/src/components/LessonCompletion.tsx',
  'web/src/components/practice-progress.css',
  'web/src/learning/completion.ts',
  'web/src/pages/LessonPage.tsx',
];
assert.deepEqual(
  registration.files.map((entry) => entry.path),
  expectedFiles,
);
for (const entry of registration.files) {
  assert.equal(
    sha(await read(entry.path)),
    entry.sha256,
    `Blockly source changed; repeat the integration gate before republishing ${entry.path}`,
  );
}
const readingBytes = await read('web/public/content/reading/course-reading-1.0.0.json');
const practiceBytes = await read('web/public/content/practice/course-practice-1.0.0.json');
const sourceBytes = await read('content/c/p0/course-1.0.1.json');
assert.equal(sha(sourceBytes), '713133313e65ba9ea000daa18d5feaea84beeb65f296b8102edc5de114fa2611');
assert.equal(sha(readingBytes), '0a223bd495298518bb4f81e833743d802b601262f720f2c084e4853a1d2ad5ab');
assert.equal(
  sha(practiceBytes),
  '9f2e834d76f1bbf5b3f8aaaa0de1326dba8cedd23a735d9502a306a32a819ed2',
);
const reading = JSON.parse(readingBytes);
const practice = JSON.parse(practiceBytes);
assert.deepEqual(reading.packageRef, practice.packageRef);
assert.equal(reading.catalog.purpose, 'lesson-reading');
assert.equal(practice.exercises.length, 6);
assert.equal(
  practice.exercises.reduce((sum, value) => sum + value.tests.length, 0),
  24,
);
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
const manifest = {
  file: 'content/learning/course-learning-1.0.10.json',
  bytes: bytes.length,
  sha256: sha(bytes),
  readingSha256: resource.readingSha256,
  practiceSha256: resource.practiceSha256,
  sourceSha256: resource.sourceSha256,
};
await mkdir(new URL('web/public/content/learning/', root), { recursive: true });
await writeFile(new URL('web/public/' + manifest.file, root), bytes, { flag: 'wx' }).catch(
  async (error) => {
    if (error.code !== 'EEXIST') throw error;
    assert.deepEqual(
      await read('web/public/' + manifest.file),
      bytes,
      'Learning release is immutable',
    );
  },
);
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
await writeFile(
  new URL('web/src/content/course-learning-release.generated.ts', root),
  await format(
    '// Generated after the reviewed 10.3 Blockly/Rust integration gate.\nexport const courseLearningRelease = ' +
      JSON.stringify(manifest) +
      ' as const;\n',
    { parser: 'typescript', singleQuote: true, printWidth: 100 },
  ),
);
console.log(
  '09.4 learning release: only reviewed lesson actions and genuine complete exercise passes.',
);
