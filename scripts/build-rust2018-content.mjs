import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const root = new URL('../', import.meta.url);
const folder = new URL('content/rust2018/course/', root);
const output = new URL('web/public/content/rust2018/course/', root);
const version = '1.0.0';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => readFile(new URL(path, root));
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const entry = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });
const sourceBytes = await readFile(new URL('source-1.0.0.json', folder));
const source = JSON.parse(sourceBytes);
assert.equal(source.version, version);
assert.equal(source.language, 'rust');
assert.equal(source.referenceEdition, '2018');
assert.equal(source.book.isbn, '978-7-121-38706-7');
assert.equal(source.book.physicalPages, 730);
assert.equal(source.catalog.length, 388);
assert.equal(new Set(source.catalog.map((row) => row.sourceNodeId)).size, 388);

const engine = JSON.parse(await read('content/build/rust2018-engine-0.1.0.json'));
assert.equal(
  hash(await read('web/src/generated/rust2018/c_viz_rust2018_bg.wasm')),
  engine.wasmSha256,
);
const fixed = JSON.parse(await read('shared/contracts/rust2018-profiles-1.0.0.json'));
const registryBytes = await readFile(new URL('exercises-1.0.0.json', folder));
const registryRows = JSON.parse(registryBytes);
const registry = new Map(registryRows.map((row) => [row.id, row]));
assert.equal(registry.size, 12);
assert.equal(registryRows.length, fixed.length);
for (const [index, profile] of registryRows.entries()) {
  for (const key of Object.keys(fixed[index])) assert.deepEqual(profile[key], fixed[index][key]);
  assert(text(profile.goal) && text(profile.starter) && text(profile.topic));
  assert(profile.hints.length === 3 && profile.hints.every(text));
  assert.equal(profile.cases.length, 4);
  assert.equal(new Set(profile.cases.map((group) => group.input)).size, 4);
}

const catalog = [];
const chunks = [];
const assets = new Map([
  ['source-1.0.0.json', sourceBytes],
  ['exercises-1.0.0.json', registryBytes],
]);
const bodies = new Set();
const parents = new Set();
const lessonIds = [];
const profiles = {};
let reading = 0;
let globalOrder = 0;
for (let group = 1; group <= 25; group++) {
  const file = `unit-${String(group).padStart(2, '0')}-1.0.0.json`;
  const bytes = await readFile(new URL(file, folder));
  assert(bytes.length <= 1048576);
  const chunk = JSON.parse(bytes);
  assert.equal(chunk.version, version);
  assert.equal(chunk.language, 'rust');
  assert.equal(chunk.edition, '2018');
  assert.equal(chunk.group, group);
  for (const node of chunk.nodes) {
    const original = source.catalog[globalOrder];
    assert(original, `Extra node ${node.id}`);
    assert.equal(node.id, original.sourceNodeId.replace('rust.source.', 'rust.book.'));
    assert.equal(node.sourceNodeId, original.sourceNodeId);
    assert.equal(node.title, original.titleOriginal);
    assert.equal(node.depth, original.level);
    assert.equal(node.parent, original.parent?.replace('rust.source.', 'rust.book.') ?? null);
    assert.equal(node.physicalPage, original.physicalPage);
    assert.equal(node.printedPage, null);
    assert.equal(node.group, group);
    assert.equal(node.order, ++globalOrder);
    assert.match(node.id, /^rust\.book\.root\d{2}(?:\.\d{2}){0,2}$/);
    if (node.parent) parents.add(node.parent);
    const { body, example, activity, ...summary } = node;
    assert(Array.isArray(body) && body.every(text));
    const prose = body.join('\n');
    assert(prose.length >= (node.leaf ? 140 : 50), `Incomplete prose ${node.id}`);
    assert(!bodies.has(prose), `Duplicate prose ${node.id}`);
    bodies.add(prose);
    catalog.push(summary);
    if (!node.leaf) {
      assert.equal(example, null);
      assert.equal(activity, null);
      continue;
    }
    lessonIds.push(node.id);
    assert(example && activity && text(example.description) && text(activity.prompt));
    assert(text(example.source) && text(example.result));
    assert(['rust', 'shell', 'text'].includes(example.language));
    assert(
      Array.isArray(activity.hints) && activity.hints.length > 0 && activity.hints.every(text),
    );
    if (example.mode === 'reading') {
      reading++;
      assert(text(example.reason));
      assert.equal(activity.mode, 'self-check');
      assert(text(activity.answer));
    } else {
      assert.equal(example.mode, 'wasm');
      assert.equal(example.language, 'rust');
      assert.equal(activity.mode, 'judge');
      const profile = registry.get(activity.profile);
      assert(profile && !Object.hasOwn(profiles, activity.profile));
      assert.equal(profile.lesson, node.id);
      assert.equal(example.source, profile.source);
      assert.deepEqual(example.cases, profile.cases);
      assert.equal(activity.prompt, profile.goal);
      assert.equal(activity.starter, profile.starter);
      assert.deepEqual(activity.hints, profile.hints);
      profiles[activity.profile] = { lesson: node.id, title: node.title, topic: profile.topic };
    }
  }
  chunks.push({ group, nodes: chunk.nodes.length, ...entry(file, bytes) });
  assets.set(file, bytes);
}
assert.equal(globalOrder, 388);
assert.equal(lessonIds.length, 299);
assert.equal(reading, 287);
assert.equal(Object.keys(profiles).length, 12);
assert(catalog.every((node) => node.leaf === !parents.has(node.id)));
assert.deepEqual(
  catalog
    .map((node) => node.depth)
    .reduce(
      (counts, depth) => {
        counts[depth - 1]++;
        return counts;
      },
      [0, 0, 0],
    ),
  [25, 115, 248],
);
const manifest = {
  version,
  language: 'rust',
  edition: '2018',
  packageRef: { id: 'content.rust2018.book', version },
  source: source.book,
  sourceFile: entry('source-1.0.0.json', sourceBytes),
  engineSha256: engine.wasmSha256,
  registryFile: entry('exercises-1.0.0.json', registryBytes),
  counts: {
    nodes: 388,
    chapters: 20,
    appendices: 5,
    sections: 115,
    subsections: 248,
    leaves: 299,
    reading: 287,
    runnable: 12,
    judgeCases: 48,
  },
  catalog,
  chunks,
};
const manifestBytes = encode(manifest);
const release = entry('manifest-1.0.0.json', manifestBytes);
const lock = new URL('content/build/rust2018-content-1.0.0.json', root);
if (process.argv.includes('--record')) {
  await writeFile(new URL(release.file, folder), manifestBytes);
  await writeFile(lock, encode(release));
} else {
  assert.deepEqual(JSON.parse(await readFile(lock)), release);
  assert.deepEqual(await readFile(new URL(release.file, folder)), manifestBytes);
}
assets.set(release.file, manifestBytes);
assert.deepEqual((await readdir(folder)).sort(), [...assets.keys()].sort());
await mkdir(output, { recursive: true });
for (const [file, bytes] of assets) await writeFile(new URL(file, output), bytes);
const generated = new URL('web/src/rust2018-course/release.generated.ts', root);
await mkdir(new URL('.', generated), { recursive: true });
await writeFile(
  generated,
  await format(
    `// Generated from the frozen Rust course package.\nexport const rust2018CourseRelease = ${JSON.stringify(release)} as const;\nexport const rust2018LessonIds = ${JSON.stringify(lessonIds)} as const;\nexport const rust2018Profiles = ${JSON.stringify(profiles)} as const;\n`,
    { ...(await resolveConfig(fileURLToPath(generated))), parser: 'typescript' },
  ),
);
console.log(
  `Rust CONTENT 1.0.0: ${globalOrder} bodies / ${lessonIds.length} leaves / ${reading} reading / 48 judge cases; ${release.sha256}.`,
);
