import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import {
  parsePython3CourseChunk,
  parsePython3CourseManifest,
  python3CourseCounts,
} from '../shared/contracts/python3-content.mjs';

const root = new URL('../', import.meta.url);
const folder = new URL('content/python3/course/', root);
const publicFolder = new URL('web/public/content/python3/course/', root);
const read = (file) => readFile(new URL(file, root));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const release = JSON.parse(await read('content/build/python3-course-1.0.0.json'));
const manifestBytes = await readFile(new URL('manifest-1.0.0.json', folder));
const manifest = await parsePython3CourseManifest(manifestBytes, release);
const [wasm, registry] = await Promise.all([
  read('web/src/generated/python3/c_viz_python3_bg.wasm'),
  read('content/python3/judges-1.0.0.json'),
]);
assert.equal(hash(wasm), manifest.engine.buildSha256, 'Python course engine build');
assert.equal(hash(registry), manifest.judgeRegistrySha256, 'Python course judge registry');
const questions = new Map(JSON.parse(registry).map(({ id, cases }) => [id, cases]));
assert.equal(questions.size, python3CourseCounts.executionQuestions);
const expectedAssets = [release.manifestFile, ...manifest.chunks.map((entry) => entry.file)].sort();
assert.deepEqual((await readdir(folder)).sort(), expectedAssets);

const assets = new Map([[release.manifestFile, manifestBytes]]);
const seenSourceIds = new Set(manifest.sections.map((row) => row.sourceNodeId));
const seenPlatformIds = new Set();
const counts = Object.fromEntries(Object.keys(python3CourseCounts).map((key) => [key, 0]));
const lessonIds = [];
const exerciseIndex = {};
counts.supplementarySidebarLinks = manifest.supplementarySidebarLinks.length;
for (const entry of manifest.chunks) {
  const bytes = await readFile(new URL(entry.file, folder));
  const chunk = await parsePython3CourseChunk(bytes, manifest, entry.articleSourceOrder);
  assets.set(entry.file, bytes);
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
assert.deepEqual(counts, python3CourseCounts);

await mkdir(publicFolder, { recursive: true });
await Promise.all(
  [...assets].map(([file, bytes]) => writeFile(new URL(file, publicFolder), bytes)),
);
await writeFile(
  new URL('web/src/python3/release.generated.ts', root),
  await format(
    'export const pythonCourseRelease = ' +
      JSON.stringify(release) +
      ' as const;\n' +
      'export const pythonLessonIds = ' +
      JSON.stringify(lessonIds) +
      ' as const;\n' +
      'export const pythonExerciseIndex = ' +
      JSON.stringify(exerciseIndex) +
      ' as const;\n',
    { ...(await resolveConfig('.prettierrc.json')), parser: 'typescript' },
  ),
);
console.log(
  'Python CONTENT4: ' +
    counts.sourceArticles +
    ' articles, ' +
    counts.teachingLeaves +
    ' lessons, ' +
    counts.judgeCases +
    ' locked judge cases; manifest ' +
    release.manifestSha256 +
    '.',
);
