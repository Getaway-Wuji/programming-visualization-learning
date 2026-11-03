// A bounded learning index; teaching bodies and code stay in their lazy chunks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { produceC6Teaching } from './build-teaching-content.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const source = readFileSync('content/c/primer6-teaching/source-2.0.0.json');
const produced = await produceC6Teaching(source);
const manifestBytes = readFileSync('content/c/primer6-teaching/manifest-2.0.0.json');
assert.deepEqual(manifestBytes, produced.assets.get('manifest-2.0.0.json'));
const chapters = JSON.parse(source.toString('utf8')).chapters;
const lessons = chapters.flatMap((chapter) => chapter.lessons);
const exercises = chapters.flatMap((chapter) => chapter.exercises);
const activities = chapters.flatMap((chapter) => chapter.activities);
const compatibility = chapters.find((chapter) => chapter.compatibility)?.compatibility;
assert(compatibility);
const knowledge = chapters.flatMap((chapter) => chapter.knowledge);
const index = {
  indexVersion: '1.0.0',
  catalogSetRef: { id: 'catalog-set.c.primer6', version: '2.0.0' },
  packageRef: produced.manifest.packageRef,
  manifestSha256: hash(manifestBytes),
  sourceSha256: hash(source),
  engineBuildSha256: produced.manifest.engineBuildSha256,
  judgeOwnerPackageRef: produced.manifest.judgeOwnerPackageRef,
  // Each tuple is a real source projection, not an inferred teaching requirement.
  lessons: lessons.map((lesson) => [
    lesson.ref.id,
    lesson.sourceNodeRef.id,
    lesson.chapterRef.id,
    lesson.knowledgeRefs[0].id,
    lesson.rewardGroupId,
    lesson.requiredActivityRefs.map((ref) => {
      const activity = activities.find((entry) => entry.ref.id === ref.id);
      assert(activity?.kind === 'rust-execution' && activity.mandatory);
      return activity.exerciseRef.id;
    }),
  ]),
  exercises: exercises.map((exercise) => [
    exercise.ref.id,
    exercise.sourceNodeRef.id,
    exercise.lessonRef.id,
    exercise.profileRef.id,
    exercise.programRef.id,
    exercise.tests.map((test) => test.caseKey),
  ]),
  knowledge: knowledge.map((item) => [
    item.ref.id,
    item.sourceNodeRef.id,
    item.kind,
    item.chapterKnowledgeRef?.id ?? null,
  ]),
  rewardGroups: compatibility.rewardGroups,
  legacyLinks: compatibility.legacyLinks,
};
assert.equal(index.lessons.length, 404);
assert.equal(index.exercises.length, 44);
assert.equal(index.knowledge.length, 421);
assert.equal(index.rewardGroups.length, 42);
assert.equal(index.legacyLinks.length, 79);
const bytes = Buffer.from(`${JSON.stringify(index)}\n`);
assert(bytes.length <= 262144, 'The learning index keeps the 256 KiB metadata budget.');
const name = 'index-1.0.0.json';
const folder = 'content/c/primer6-learning';
const publicFolder = 'web/public/content/c/primer6-learning';
const pinFile = 'web/src/c6-learning/release.generated.ts';
const release = {
  indexVersion: index.indexVersion,
  catalogSetRef: index.catalogSetRef,
  packageRef: index.packageRef,
  file: name,
  bytes: bytes.length,
  sha256: hash(bytes),
  manifestSha256: index.manifestSha256,
  sourceSha256: index.sourceSha256,
  engineBuildSha256: index.engineBuildSha256,
};
const pin = await format(
  `// Generated from the validated full teaching source.\nexport const c6LearningRelease = ${JSON.stringify(release)} as const;\n`,
  { ...(await resolveConfig('.prettierrc.json')), parser: 'typescript' },
);
const rewardsFile = 'web/src/c6-learning/rewards.generated.ts';
const rewards = await format(
  `// Exact reward ownership from the validated course source.\nexport const c6RewardGroups = ${JSON.stringify(
    index.rewardGroups.map((g) => ({
      lessonSubjectId: g.lessonReward.subjectId,
      exerciseSubjectId: g.exerciseReward.subjectId,
      lessonIds: g.lessonRefs.map((r) => r.id),
      exerciseIds: g.exerciseRefs.map((r) => r.id),
    })),
  )} as const;\n`,
  { ...(await resolveConfig('.prettierrc.json')), parser: 'typescript' },
);
if (process.argv.includes('--inspect')) {
  console.log(JSON.stringify({ ...release, written: false }));
} else {
  if (process.argv.includes('--write')) {
    mkdirSync(folder, { recursive: true });
    mkdirSync('web/src/c6-learning', { recursive: true });
    writeFileSync(`${folder}/${name}`, bytes);
    writeFileSync(pinFile, pin);
    writeFileSync(rewardsFile, rewards);
  } else {
    assert.deepEqual(readFileSync(`${folder}/${name}`), bytes);
    assert.equal(readFileSync(pinFile, 'utf8'), pin);
    assert.equal(readFileSync(rewardsFile, 'utf8'), rewards);
  }
  mkdirSync(publicFolder, { recursive: true });
  writeFileSync(`${publicFolder}/${name}`, bytes);
  console.log(JSON.stringify(release));
}
