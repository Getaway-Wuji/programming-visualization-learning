import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import {
  parseJava3CourseChunk,
  parseJava3CourseManifest,
  javaCourseBudgets,
  javaCourseCounts,
} from '../shared/contracts/java-content.mjs';
import {
  loadEditorialCourseAssets,
  publishEditorialCourseAssets,
} from './editorial-course-assets.mjs';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bundle = await loadEditorialCourseAssets({
  language: 'java',
  editorialId: 'editorial.java.runoob',
  parseManifest: parseJava3CourseManifest,
  parseChunk: parseJava3CourseChunk,
  budgets: javaCourseBudgets,
});
const { release, manifest } = bundle;
const [wasm, registry] = await Promise.all([
  read('web/src/generated/java/c_viz_java_bg.wasm'),
  read('content/java/judges-1.0.0.json'),
]);
assert.equal(hash(wasm), manifest.engine.buildSha256, 'Java course engine build');
assert.equal(hash(registry), manifest.judgeRegistrySha256, 'Java course judge registry');
const questions = new Map(JSON.parse(registry).map(({ id, cases }) => [id, cases]));
assert.equal(questions.size, javaCourseCounts.executionQuestions);
const seenSourceIds = new Set(manifest.sections.map((row) => row.sourceNodeId));
const seenPlatformIds = new Set();
const counts = Object.fromEntries(Object.keys(javaCourseCounts).map((key) => [key, 0]));
const lessonIds = [];
const exerciseIndex = {};
counts.supplementarySidebarLinks = manifest.supplementarySidebarLinks.length;
for (const entry of manifest.chunks) {
  const chunk = bundle.chunks.get(entry.articleSourceOrder);
  counts.sourceArticles++;
  counts.sourceSubheadings += chunk.nodes.length - 1;
  for (const node of chunk.nodes) {
    assert(!seenSourceIds.has(node.sourceNodeId) && !seenPlatformIds.has(node.platformRef.id));
    seenSourceIds.add(node.sourceNodeId);
    seenPlatformIds.add(node.platformRef.id);
    if (node.status === 'authored') {
      counts.teachingTexts++;
      if (node.leaf) {
        counts.teachingLeaves++;
        lessonIds.push(node.platformRef.id);
        if (node.questionId) {
          const activity = chunk.activities.find((item) => item.id === node.questionId);
          exerciseIndex[node.questionId] = {
            lessonId: node.platformRef.id,
            articleOrder: entry.articleSourceOrder,
            title: activity.title,
          };
        }
      }
    } else if (node.status === 'context-only') counts.captionContexts++;
    else counts.referenceTexts++;
  }
  counts.examples += chunk.examples.length;
  counts.activities += chunk.activities.length;
  for (const example of chunk.examples) {
    if (example.status === 'reading-only') counts.readingExamples++;
    else counts.runnableExamples++;
  }
  for (const activity of chunk.activities) {
    if (activity.kind === 'optional-self-check') {
      counts.understandingActivities++;
      continue;
    }
    const cases = questions.get(activity.profileRef.id);
    assert.equal(cases?.length, activity.caseCount, activity.id);
    assert(
      cases.every(
        ([input, stdout]) =>
          typeof input === 'string' &&
          Buffer.byteLength(input) <= 256 &&
          typeof stdout === 'string',
      ),
    );
    questions.delete(activity.profileRef.id);
    counts.executionQuestions++;
    counts.judgeCases += cases.length;
  }
}
assert.equal(questions.size, 0);
assert.deepEqual(counts, javaCourseCounts);

await publishEditorialCourseAssets(bundle);
await mkdir(new URL('web/src/java/', root), { recursive: true });
await writeFile(
  new URL('web/src/java/release.generated.ts', root),
  await format(
    'export const javaCourseRelease = ' +
      JSON.stringify(release) +
      ' as const;\n' +
      'export const javaLessonIds = ' +
      JSON.stringify(lessonIds) +
      ' as const;\n' +
      'export const javaExerciseIndex = ' +
      JSON.stringify(exerciseIndex) +
      ' as const;\n',
    { ...(await resolveConfig('.prettierrc.json')), parser: 'typescript' },
  ),
);
console.log(
  'Java CONTENT5: ' +
    counts.sourceArticles +
    ' articles, ' +
    counts.teachingLeaves +
    ' lessons, ' +
    counts.judgeCases +
    ' locked judge cases; editorial ' +
    release.editorialRef.version +
    '; manifest ' +
    release.manifestSha256 +
    '.',
);
