import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const root = new URL('../', import.meta.url);
const folder = new URL('content/mysql/course/', root);
const output = new URL('web/public/content/mysql/course/', root);
const version = '1.0.0';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const entry = (file, bytes) => ({ file, bytes: bytes.length, sha256: hash(bytes) });
const text = (value) => typeof value === 'string' && value.trim().length > 0;
function keys(value, names) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...names].sort());
}
const metaKeys = [
  'id',
  'sourceNodeId',
  'number',
  'title',
  'parent',
  'depth',
  'order',
  'group',
  'leaf',
  'printedPage',
  'physicalPage',
  'coverage',
];
const counts = {
  nodes: 374,
  chapters: 17,
  sections: 128,
  subsections: 229,
  leaves: 300,
  parents: 74,
  reading: 288,
  runnable: 12,
  exampleCases: 48,
  judgeCases: 48,
};
const hosts = new Set([
  'dev.mysql.com',
  'docs.oracle.com',
  'docs.phpmyadmin.net',
  'learn.microsoft.com',
  'www.navicat.com',
  'www.php.net',
  'www.xp.cn',
]);
function metadata(node, order) {
  assert.match(node.number, /^(?:[1-9]|1[0-7])(?:\.[1-9]\d*){0,2}$/u);
  assert.equal(node.id, 'mysql.lesson.' + node.number);
  assert.equal(
    node.sourceNodeId,
    node.depth === 1
      ? 'mysql.source.chapter-' + node.number
      : 'mysql.source.' + node.number.replaceAll('.', '-'),
  );
  assert.equal(node.depth, node.number.split('.').length);
  assert.equal(
    node.parent,
    node.depth === 1 ? null : 'mysql.lesson.' + node.number.slice(0, node.number.lastIndexOf('.')),
  );
  assert.equal(node.group, Number(node.number.split('.')[0]));
  assert.equal(node.order, order);
  assert.equal(typeof node.leaf, 'boolean');
  assert(text(node.title));
  assert(
    Number.isSafeInteger(node.printedPage) && node.printedPage >= 1 && node.printedPage <= 369,
  );
  assert.equal(node.coverage, node.group === 1 ? 'body-present' : 'toc-only');
  if (node.group === 1)
    assert(
      Number.isSafeInteger(node.physicalPage) && node.physicalPage >= 11 && node.physicalPage <= 24,
    );
  else assert.equal(node.physicalPage, null);
}
async function json(file) {
  const bytes = await readFile(new URL(file, folder));
  assert(bytes.length > 0 && bytes.length <= 1048576, file);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  // Re-encoding rejects duplicate fields, noncanonical numbers and alternate spellings.
  assert(bytes.equals(encode(value)), `Noncanonical JSON ${file}`);
  return { bytes, value };
}
const { bytes: sourceBytes, value: source } = await json('source-1.0.0.json');
keys(source, ['version', 'language', 'dialect', 'book', 'coverage', 'catalog']);
assert.equal(source.version, version);
assert.equal(source.language, 'mysql');
assert.equal(source.dialect, '8.0');
keys(source.book, ['title', 'author', 'publisher', 'edition', 'isbn', 'pdfSha256']);
assert(Object.values(source.book).every(text));
assert.equal(source.book.isbn, '978-7-302-66582-3');
assert.equal(
  source.book.pdfSha256,
  '1b3a99aa60325cf12c7feabdcc75b90e5b0f32a388d38b3ff5abaa7f3077099f',
);
keys(source.coverage, [
  'physicalPages',
  'bodyChapters',
  'bodyNodes',
  'tocOnlyNodes',
  'bodyPrintedPages',
  'bodyPhysicalPages',
  'note',
]);
assert.equal(source.coverage.physicalPages, 24);
assert.equal(source.coverage.bodyNodes, 21);
assert.equal(source.coverage.tocOnlyNodes, 353);
assert.deepEqual(source.coverage.bodyChapters, [1]);
assert.deepEqual(source.coverage.bodyPrintedPages, [1, 14]);
assert.deepEqual(source.coverage.bodyPhysicalPages, [11, 24]);
assert(text(source.coverage.note));
assert.equal(source.catalog.length, 374);
source.catalog.forEach((row, index) => {
  keys(row, metaKeys);
  metadata(row, index + 1);
});
assert.equal(new Set(source.catalog.map((row) => row.id)).size, 374);
const fixed = JSON.parse(
  await readFile(new URL('shared/contracts/mysql-profiles-1.0.0.json', root)),
);
assert.deepEqual(fixed.packageRef, { id: 'content.mysql.book', version });
const { bytes: registryBytes, value: registry } = await json('exercises-1.0.0.json');
assert.deepEqual(
  registry,
  fixed.profiles,
  'Published registry must be the exact frozen profiles array',
);
assert.equal(registry.length, 12);
const profileMap = new Map(registry.map((row) => [row.id, row]));
assert.equal(profileMap.size, 12);
const engine = JSON.parse(await readFile(new URL('content/build/mysql-engine-0.1.0.json', root)));
assert.equal(
  hash(await readFile(new URL('web/src/generated/mysql/c_viz_mysql_bg.wasm', root))),
  engine.wasmSha256,
);
const assets = new Map([
  ['source-1.0.0.json', sourceBytes],
  ['exercises-1.0.0.json', registryBytes],
]);
const catalog = [],
  chunks = [],
  lessonIds = [],
  prose = new Set(),
  parents = new Set(),
  profiles = {};
let order = 0,
  reading = 0,
  runnable = 0;
for (let group = 1; group <= 17; group++) {
  const file = `unit-${String(group).padStart(2, '0')}-1.0.0.json`;
  const { bytes, value: unit } = await json(file);
  keys(unit, ['version', 'language', 'dialect', 'group', 'nodes']);
  assert.equal(unit.version, version);
  assert.equal(unit.language, 'mysql');
  assert.equal(unit.dialect, '8.0');
  assert.equal(unit.group, group);
  assert(Array.isArray(unit.nodes) && unit.nodes.length > 0);
  for (const node of unit.nodes) {
    keys(node, [...metaKeys, 'body', 'example', 'activity', 'references']);
    const summary = Object.fromEntries(metaKeys.map((key) => [key, node[key]]));
    metadata(summary, ++order);
    assert.equal(node.group, group);
    assert.deepEqual(summary, source.catalog[order - 1]);
    if (node.parent) {
      assert(catalog.some((row) => row.id === node.parent));
      parents.add(node.parent);
    }
    assert(
      Array.isArray(node.body) && node.body.length >= (node.leaf ? 3 : 2) && node.body.every(text),
    );
    const body = node.body.join('\n');
    assert(
      body.length >= (node.leaf ? 140 : 80) && !prose.has(body),
      `Incomplete/duplicate body ${node.id}`,
    );
    prose.add(body);
    assert(
      Array.isArray(node.references) && node.references.length > 0 && node.references.length <= 16,
    );
    for (const ref of node.references) {
      keys(ref, ['title', 'url']);
      assert(text(ref.title));
      const url = new URL(ref.url);
      assert(
        url.protocol === 'https:' &&
          hosts.has(url.hostname) &&
          !url.username &&
          !url.password &&
          !url.port,
      );
    }
    catalog.push(summary);
    if (!node.leaf) {
      assert.equal(node.example, null);
      assert.equal(node.activity, null);
      continue;
    }
    lessonIds.push(node.id);
    const e = node.example,
      a = node.activity;
    assert(e && a && text(e.source) && text(e.description) && text(e.result));
    assert(Array.isArray(a.hints) && a.hints.length === 3 && a.hints.every(text));
    if (e.mode === 'reading') {
      reading++;
      keys(e, ['mode', 'language', 'source', 'description', 'result', 'reason']);
      keys(a, ['mode', 'prompt', 'answer', 'hints']);
      assert(['sql', 'text', 'shell', 'php'].includes(e.language));
      assert(text(e.reason) && a.mode === 'self-check' && text(a.prompt) && text(a.answer));
    } else {
      runnable++;
      keys(e, ['mode', 'language', 'source', 'description', 'result', 'profile', 'caseIndices']);
      keys(a, ['mode', 'profile', 'prompt', 'starter', 'hints']);
      assert.equal(e.mode, 'wasm');
      assert.equal(e.language, 'sql');
      assert.equal(a.mode, 'judge');
      const profile = profileMap.get(a.profile);
      assert(profile && !Object.hasOwn(profiles, profile.id));
      assert.equal(e.profile, profile.id);
      assert.equal(profile.lessonId, node.id);
      assert.equal(profile.sourceNodeId, node.sourceNodeId);
      assert.equal(e.source, profile.referenceSource);
      assert.deepEqual(e.caseIndices, [0, 1, 2, 3]);
      assert.equal(a.prompt, profile.goal);
      assert.equal(a.starter, profile.starter);
      assert.deepEqual(a.hints, profile.hints);
      assert.equal(profile.cases.length, 4);
      assert.deepEqual(
        profile.cases.map((row) => row.index),
        [0, 1, 2, 3],
      );
      profiles[profile.id] = { lesson: node.id, title: node.title };
    }
  }
  chunks.push({ group, nodes: unit.nodes.length, ...entry(file, bytes) });
  assets.set(file, bytes);
}
assert.equal(order, 374);
assert.equal(lessonIds.length, 300);
assert.equal(parents.size, 74);
assert.equal(reading, 288);
assert.equal(runnable, 12);
assert(catalog.every((row) => row.leaf === !parents.has(row.id)));
assert.deepEqual(
  [1, 2, 3].map((depth) => catalog.filter((row) => row.depth === depth).length),
  [17, 128, 229],
);
assert.equal(catalog.filter((row) => row.coverage === 'body-present').length, 21);
const manifest = {
  version,
  language: 'mysql',
  dialect: '8.0',
  packageRef: fixed.packageRef,
  engineSha256: engine.wasmSha256,
  source: source.book,
  coverage: source.coverage,
  sourceFile: entry('source-1.0.0.json', sourceBytes),
  registryFile: entry('exercises-1.0.0.json', registryBytes),
  counts,
  catalog,
  chunks,
};
const manifestBytes = encode(manifest),
  release = entry('manifest-1.0.0.json', manifestBytes);
const lock = new URL('content/build/mysql-content-1.0.0.json', root);
if (process.argv.includes('--record')) {
  await writeFile(new URL(release.file, folder), manifestBytes);
  await writeFile(lock, encode(release));
} else {
  assert.deepEqual(JSON.parse(await readFile(lock)), release);
  assert.deepEqual(await readFile(new URL(release.file, folder)), manifestBytes);
}
assets.set(release.file, manifestBytes);
assert.equal(assets.size, 20);
assert.deepEqual((await readdir(folder)).sort(), [...assets.keys()].sort());
await mkdir(output, { recursive: true });
for (const [file, bytes] of assets) await writeFile(new URL(file, output), bytes);
assert.deepEqual((await readdir(output)).sort(), [...assets.keys()].sort());
const generated = new URL('web/src/mysql-course/release.generated.ts', root);
await mkdir(new URL('.', generated), { recursive: true });
await writeFile(
  generated,
  await format(
    `// Generated from the frozen MySQL course package.\nexport const mysqlCourseRelease = ${JSON.stringify(release)} as const;\nexport const mysqlLessonIds = ${JSON.stringify(lessonIds)} as const;\nexport const mysqlProfiles = ${JSON.stringify(profiles)} as const;\n`,
    { ...(await resolveConfig(fileURLToPath(generated))), parser: 'typescript' },
  ),
);
console.log(
  `MySQL CONTENT ${version}: ${order} bodies / 300 leaves / 288 reading / 12 examples / 48 judge cases / 20 assets; ${release.sha256}.`,
);
