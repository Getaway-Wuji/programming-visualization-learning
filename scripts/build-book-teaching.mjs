import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { Marked } from 'marked';
import { format, resolveConfig } from 'prettier';
import {
  parseBookTeaching,
  validateBookTeachingEntry,
} from '../shared/contracts/book-teaching.mjs';
import { isTeachingEditorial } from '../shared/contracts/teaching-editorial.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const markdown = new Marked();
const mediaManifest = JSON.parse(readFileSync('content/build/book-teaching-media-1.0.0.json'));
assert.deepEqual(Object.keys(mediaManifest).sort(), ['files', 'formatVersion']);
assert.equal(mediaManifest.formatVersion, 1);
assert(Array.isArray(mediaManifest.files) && mediaManifest.files.length <= 32);
const media = new Map();
for (const item of mediaManifest.files) {
  assert.deepEqual(Object.keys(item).sort(), ['bytes', 'file', 'sha256']);
  assert(/^content\/(?:c|cpp|rust2018|mysql)\/media\/[a-z0-9-]+\.svg$/u.test(item.file));
  assert(Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= 262144);
  assert(/^[a-f0-9]{64}$/u.test(item.sha256));
  assert(!media.has(item.file));
  const bytes = readFileSync(item.file);
  assert.equal(bytes.length, item.bytes);
  assert.equal(sha(bytes), item.sha256, `Teaching figure changed: ${item.file}`);
  const svg = bytes.toString('utf8');
  assert(svg.includes('<title') && svg.includes('<desc'));
  assert(!/<(?:script|foreignObject|image)\b|<!DOCTYPE|<!ENTITY|\bon\w+\s*=/iu.test(svg));
  media.set(item.file, bytes);
}
const folder = 'content/teaching/';
const pointer = 'content/build/book-teaching-current.json';
const releaseFile = existsSync(pointer) ? JSON.parse(readFileSync(pointer)).releaseFile : null;
if (releaseFile)
  assert(/^book-teaching-editorial-\d{1,3}\.\d{1,3}\.\d{1,3}\.json$/u.test(releaseFile));
const release = releaseFile
  ? JSON.parse(readFileSync('content/build/' + releaseFile))
  : {
      formatVersion: 1,
      editorialRef: { id: 'editorial.book-courses', version: '1.0.0' },
      chunks: [],
    };
assert.equal(release.formatVersion, 1);
assert(isTeachingEditorial(release.editorialRef, 'editorial.book-courses'));
assert(Array.isArray(release.chunks) && release.chunks.length <= 80);
const seen = new Set();
for (const entry of release.chunks) {
  validateBookTeachingEntry(entry);
  assert(!seen.has(entry.language + ':' + entry.group));
  seen.add(entry.language + ':' + entry.group);
}
const declared = new Map();
for (const file of readdirSync('content/build').filter((name) =>
  /^book-teaching-editorial-\d+\.\d+\.\d+\.json$/u.test(name),
)) {
  const history = JSON.parse(readFileSync('content/build/' + file));
  assert.equal(history.formatVersion, 1);
  assert(isTeachingEditorial(history.editorialRef, 'editorial.book-courses'));
  assert.equal(file, `book-teaching-editorial-${history.editorialRef.version}.json`);
  assert(Array.isArray(history.chunks) && history.chunks.length <= 80);
  const groups = new Set();
  for (const entry of history.chunks) {
    validateBookTeachingEntry(entry);
    const key = entry.language + ':' + entry.group;
    assert(!groups.has(key));
    groups.add(key);
    if (declared.has(entry.file)) assert.deepEqual(declared.get(entry.file).entry, entry);
    else declared.set(entry.file, { entry, editorialRef: history.editorialRef });
  }
}
const sourceNames = existsSync(folder)
  ? readdirSync(folder)
      .filter((file) => file.endsWith('.json'))
      .sort()
  : [];
assert.deepEqual(
  sourceNames,
  [...declared.keys()].sort(),
  'Only declared immutable teaching assets may be published.',
);
mkdirSync('web/public/content/teaching', { recursive: true });
for (const file of sourceNames) {
  const bytes = readFileSync(folder + file);
  const data = JSON.parse(bytes);
  const { entry, editorialRef } = declared.get(file);
  assert.equal(bytes.length, entry.bytes);
  assert.equal(sha(bytes), entry.sha256);
  const chunk = parseBookTeaching(data, entry, editorialRef);
  const original = readFileSync(entry.baselineFile);
  assert.equal(sha(original), entry.baselineSha256);
  assert.deepEqual(
    original,
    execFileSync('git', ['show', 'HEAD:' + entry.baselineFile], { maxBuffer: 8 * 1024 * 1024 }),
  );
  const baseline = JSON.parse(original);
  assert.equal(chunk.nodes.length, baseline.nodes.length);
  const nodes = new Map(chunk.nodes.map((n) => [n.id, n]));
  for (const node of chunk.nodes) {
    markdown.walkTokens(markdown.lexer(node.body.join('\n\n')), (token) => {
      if (token.type === 'image') {
        assert(token.href.startsWith(`content/${entry.language}/media/`));
        assert(media.has(token.href), `Unregistered teaching figure: ${token.href}`);
      }
    });
  }
  for (const old of baseline.nodes) {
    const node = nodes.get(old.sourceNodeId && entry.language === 'c' ? old.sourceNodeId : old.id);
    const body = typeof old.body === 'string' ? old.body : old.body.join('\n\n');
    assert(node && node.title === (old.titleDisplay ?? old.title));
    assert.equal(node.originalBodySha256, sha(body));
    assert(
      node.body.join('\n\n').length > body.length,
      `Teaching must deepen each node: ${node.id}`,
    );
  }
  const destination = 'web/public/content/teaching/' + file;
  if (existsSync(destination)) assert.deepEqual(readFileSync(destination), bytes);
  else writeFileSync(destination, bytes, { flag: 'wx' });
}
for (const [file, bytes] of media) {
  const destination = 'web/public/' + file;
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination)) assert.deepEqual(readFileSync(destination), bytes);
  else writeFileSync(destination, bytes, { flag: 'wx' });
}
for (const entry of release.chunks) assert(existsSync(folder + entry.file));
const generated = 'web/src/content/book-teaching-release.generated.ts';
const text =
  "// Generated by build-book-teaching.mjs. Learning and execution identities remain unchanged.\nimport type { BookTeachingEntry } from '../../../shared/contracts/book-teaching.mjs';\n" +
  `export const bookTeachingRelease: { editorialRef: { id: 'editorial.book-courses'; version: string }; chunks: BookTeachingEntry[] } = ${JSON.stringify({ editorialRef: release.editorialRef, chunks: release.chunks })};\n`;
writeFileSync(
  generated,
  await format(text, { ...(await resolveConfig(generated)), parser: 'typescript' }),
);
console.log(
  `Detailed book teaching: ${release.chunks.length} independently bound chapters; original learning and execution assets preserved.`,
);
