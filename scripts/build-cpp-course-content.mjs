import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const root = new URL('../', import.meta.url);
const folder = new URL('content/cpp/course/', root);
const out = new URL('web/public/content/cpp/course/', root);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const read = (path) => readFile(new URL(path, root));
const version = '1.0.0';
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const exactFile = async (entry) => {
  const bytes = await readFile(new URL(entry.file, folder));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256);
  return bytes;
};

const release = JSON.parse(await read('content/build/cpp-course-content-1.0.0.json'));
assert.equal(release.file, 'manifest-1.0.0.json');
const manifestBytes = await exactFile(release);
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.version, version);
assert.equal(manifest.language, 'cpp');
assert.equal(manifest.source.isbn, '978-7-302-28847-3');
assert.equal(
  hash(await read('web/src/generated/cpp-course/c_viz_cpp_course_bg.wasm')),
  manifest.engineSha256,
);
const registryBytes = await read('content/cpp/course/exercises-1.0.0.json');
assert.equal(hash(registryBytes), manifest.registrySha256);
const registry = new Map(JSON.parse(registryBytes).map((row) => [row.id, row]));
assert.equal(registry.size, 12);
const assets = new Map([[release.file, manifestBytes]]);
const catalog = new Map();
const lessonIds = [];
const profiles = {};
const levels = [0, 0, 0, 0];
const parents = new Set();
for (const [at, item] of manifest.catalog.entries()) {
  assert.equal(item.order, at + 1);
  assert.match(item.id, /^cpp\.book\.(?:part-\d|chapter-\d+|\d+(?:-\d+){1,2})$/);
  assert(!catalog.has(item.id) && text(item.title));
  assert(Number.isInteger(item.printedPage) && item.printedPage >= 1 && item.printedPage <= 394);
  assert(Number.isInteger(item.depth) && item.depth >= 1 && item.depth <= 4);
  assert(Number.isInteger(item.group) && item.group >= 0 && item.group <= 18);
  assert.equal(item.parent === null, item.depth === 1);
  if (item.parent) {
    assert.equal(catalog.get(item.parent)?.depth, item.depth - 1);
    parents.add(item.parent);
  }
  if (item.leaf) lessonIds.push(item.id);
  levels[item.depth - 1]++;
  catalog.set(item.id, item);
}
assert.deepEqual(levels, [4, 18, 126, 228]);
assert.equal(lessonIds.length, 295);
assert(catalog.values().every((row) => row.leaf === !parents.has(row.id)));
assert.equal(manifest.chunks.length, 19);
const seen = new Set();
const prose = new Set();
let reading = 0;
let judgeCases = 0;
for (const [group, entry] of manifest.chunks.entries()) {
  assert.equal(entry.group, group);
  assert.equal(entry.file, `unit-${String(group).padStart(2, '0')}-1.0.0.json`);
  assert(entry.bytes > 0 && entry.bytes <= 1048576);
  const bytes = await exactFile(entry);
  const chunk = JSON.parse(bytes);
  assert.equal(chunk.version, version);
  assert.equal(chunk.language, 'cpp');
  assert.equal(chunk.group, group);
  assert.equal(chunk.nodes.length, entry.nodes);
  for (const node of chunk.nodes) {
    const { body, example, activity, ...summary } = node;
    assert(!seen.has(node.id));
    seen.add(node.id);
    assert.deepEqual(summary, catalog.get(node.id));
    assert.equal(node.group, group);
    assert(Array.isArray(body) && body.length > 0 && body.every(text));
    assert(!prose.has(body[0]), `Duplicate lesson body: ${node.id}`);
    prose.add(body[0]);
    if (!node.leaf) {
      assert.equal(example, null);
      assert.equal(activity, null);
      continue;
    }
    assert(text(example.description) && text(activity.prompt));
    if (example.mode === 'reading') {
      reading++;
      assert(text(example.reason));
      assert(
        example.source === null
          ? example.result === null
          : text(example.source) && text(example.result),
      );
      assert.equal(activity.mode, 'self-check');
      assert(text(activity.answer));
    } else {
      assert.equal(example.mode, 'wasm');
      assert.equal(activity.mode, 'judge');
      const profile = registry.get(activity.profile);
      assert(profile && !Object.hasOwn(profiles, activity.profile));
      assert.equal(profile.lesson, node.id);
      assert.equal(activity.starter, profile.starter);
      assert.equal(activity.prompt, profile.goal);
      assert.equal(example.source, profile.source);
      assert.deepEqual(example.cases, profile.cases);
      assert.equal(profile.cases.length, 4);
      assert.equal(new Set(profile.cases.map((row) => JSON.stringify(row.input))).size, 4);
      profiles[activity.profile] = { lesson: node.id, title: node.title };
      judgeCases += profile.cases.length;
    }
  }
  assets.set(entry.file, bytes);
}
assert.equal(seen.size, catalog.size);
assert.deepEqual(manifest.counts, {
  parts: 4,
  chapters: 18,
  sections: 126,
  subsections: 228,
  nodes: 376,
  leaves: 295,
  reading: 283,
  runnable: 12,
  judgeCases: 48,
});
assert.equal(reading, 283);
assert.equal(Object.keys(profiles).length, 12);
assert.equal(judgeCases, 48);
assert.deepEqual((await readdir(folder)).sort(), [...assets.keys(), 'exercises-1.0.0.json'].sort());
await mkdir(out, { recursive: true });
for (const [file, data] of assets) await writeFile(new URL(file, out), data);

const source = new URL('web/src/cpp-course/release.generated.ts', root);
await mkdir(new URL('.', source), { recursive: true });
const generated = `// Generated from the frozen C++ course package.\nexport const cppCourseRelease = ${JSON.stringify(release)} as const;\nexport const cppLessonIds = ${JSON.stringify(lessonIds)} as const;\nexport const cppProfiles = ${JSON.stringify(profiles)} as const;\n`;
await writeFile(
  source,
  await format(generated, {
    ...(await resolveConfig(fileURLToPath(source))),
    parser: 'typescript',
  }),
);
console.log(
  `C++ CONTENT 1.0.0: ${seen.size} nodes / ${lessonIds.length} leaves / ${judgeCases} judge cases; ${release.sha256}.`,
);
