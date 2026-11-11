import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import {
  isTeachingEditorial,
  compareTeachingVersions,
} from '../shared/contracts/teaching-editorial.mjs';

const root = new URL('../', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const shaPattern = /^[a-f0-9]{64}$/u;
const mediaName = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:svg|png|jpg|jpeg|webp)$/u;

async function directoryFiles(folder) {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    assert(
      entries.every((entry) => entry.isFile()),
      `Only regular assets are allowed: ${folder}`,
    );
    return entries.map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function addAsset(assets, file, bytes) {
  if (assets.has(file)) assert.deepEqual(assets.get(file), bytes, `Conflicting asset: ${file}`);
  else assets.set(file, bytes);
}

function manifestIdentity(manifest) {
  const identity = { ...manifest };
  delete identity.editorialRef;
  delete identity.media;
  delete identity.teachingSources;
  identity.chunks = manifest.chunks.map((entry) => {
    const row = { ...entry };
    for (const field of ['file', 'bytes', 'sha256', 'editorialRef']) delete row[field];
    return row;
  });
  return identity;
}

function chunkIdentity(chunk) {
  const identity = { ...chunk };
  delete identity.editorialRef;
  identity.nodes = chunk.nodes.map((node) => {
    const row = { ...node };
    delete row.body;
    return row;
  });
  return identity;
}

/** Read both immutable releases and prove the new edition changes teaching bodies only. */
export async function loadEditorialCourseAssets({
  language,
  editorialId,
  parseManifest,
  parseChunk,
  budgets,
}) {
  assert(language === 'java' || language === 'python3');
  const folder = new URL(`content/${language}/course/`, root);
  const mediaFolder = new URL(`content/${language}/media/`, root);
  const readRelease = async (suffix) =>
    JSON.parse(
      await readFile(new URL(`content/build/${language}-course-${suffix}.json`, root), 'utf8'),
    );
  const legacyRelease = await readRelease('1.0.0');
  const current = JSON.parse(
    await readFile(new URL(`content/build/${language}-course-current.json`, root), 'utf8'),
  );
  assert.deepEqual(Object.keys(current), ['releaseFile'], 'Explicit current teaching release');
  const prefix = `${language}-course-editorial-`;
  const releaseFiles = (await readdir(new URL('content/build/', root))).filter((file) =>
    file.startsWith(prefix),
  );
  const revisions = [];
  for (const file of releaseFiles) {
    const revision = JSON.parse(await readFile(new URL(`content/build/${file}`, root), 'utf8'));
    assert(isTeachingEditorial(revision.editorialRef, editorialId), 'Teaching revision identity');
    assert.equal(file, `${prefix}${revision.editorialRef.version}.json`, 'Canonical release file');
    assert.deepEqual(revision.packageRef, legacyRelease.packageRef);
    revisions.push({ file, release: revision });
  }
  revisions.sort((a, b) =>
    compareTeachingVersions(a.release.editorialRef.version, b.release.editorialRef.version),
  );
  const selected = revisions.find((revision) => revision.file === current.releaseFile);
  assert(selected, 'Current teaching release must name a validated immutable descriptor');
  const release = selected.release;
  assert.equal(legacyRelease.manifestFile, 'manifest-1.0.0.json');
  const assets = new Map();
  const mediaAssets = new Map();

  async function readEdition(pin, revised) {
    const editorialRef = pin.editorialRef;
    assert.deepEqual(
      Object.keys(pin).sort(),
      [
        'packageRef',
        'manifestFile',
        'manifestBytes',
        'manifestSha256',
        ...(revised ? ['editorialRef'] : []),
      ].sort(),
      'Release descriptor fields',
    );
    assert.equal(
      pin.manifestFile,
      revised ? `manifest-1.0.0-editorial-${editorialRef.version}.json` : 'manifest-1.0.0.json',
      'Canonical manifest filename',
    );
    const manifestBytes = await readFile(new URL(pin.manifestFile, folder));
    const manifest = await parseManifest(manifestBytes, pin);
    if (revised) assert.deepEqual(manifest.editorialRef, editorialRef);
    else {
      assert.equal(manifest.editorialRef, undefined);
      assert(!('teachingSources' in manifest), 'Legacy teaching metadata is immutable');
    }
    addAsset(assets, pin.manifestFile, manifestBytes);
    const chunks = new Map();
    let totalBytes = manifestBytes.length;
    for (const entry of manifest.chunks) {
      const originalFile = `article-${String(entry.articleSourceOrder).padStart(2, '0')}-1.0.0.json`;
      const changed = entry.editorialRef !== undefined;
      const revisedFile = changed
        ? originalFile.replace(/\.json$/u, `-editorial-${entry.editorialRef.version}.json`)
        : undefined;
      assert(
        entry.file === (changed ? revisedFile : originalFile) && (!changed || revised),
        `Unexpected article asset: ${entry.file}`,
      );
      if (changed) {
        assert(isTeachingEditorial(entry.editorialRef, editorialId));
        assert(compareTeachingVersions(entry.editorialRef.version, editorialRef.version) <= 0);
      }
      const bytes = await readFile(new URL(entry.file, folder));
      const chunk = await parseChunk(bytes, manifest, entry.articleSourceOrder);
      assert.deepEqual(chunk.editorialRef, changed ? entry.editorialRef : undefined);
      assert(!chunks.has(entry.articleSourceOrder), 'Duplicate article order');
      chunks.set(entry.articleSourceOrder, chunk);
      addAsset(assets, entry.file, bytes);
      totalBytes += bytes.length;
    }
    const media = manifest.media ?? [];
    assert(Array.isArray(media), 'Invalid course media');
    const names = new Set();
    for (const entry of media) {
      assert.deepEqual(Object.keys(entry).sort(), ['bytes', 'file', 'sha256']);
      assert(typeof entry.file === 'string' && mediaName.test(entry.file), 'Invalid media name');
      assert(!names.has(entry.file), 'Duplicate course media');
      names.add(entry.file);
      assert(Number.isInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= budgets.chunk);
      assert(typeof entry.sha256 === 'string' && shaPattern.test(entry.sha256));
      const bytes = await readFile(new URL(entry.file, mediaFolder));
      assert.equal(bytes.length, entry.bytes, `Media byte count: ${entry.file}`);
      assert.equal(hash(bytes), entry.sha256, `Media hash: ${entry.file}`);
      addAsset(mediaAssets, entry.file, bytes);
      totalBytes += bytes.length;
    }
    assert(totalBytes <= budgets.total, 'Course byte budget including media');
    return { manifest, chunks };
  }

  const legacy = await readEdition(legacyRelease, false);
  let active;
  for (const revision of revisions) {
    const edition = await readEdition(revision.release, true);
    if (revision.file === current.releaseFile) active = edition;
    assert.deepEqual(
      manifestIdentity(edition.manifest),
      manifestIdentity(legacy.manifest),
      'Editorial release must preserve the complete course identity',
    );
    for (const entry of edition.manifest.chunks) {
      const chunk = edition.chunks.get(entry.articleSourceOrder);
      const original = legacy.chunks.get(entry.articleSourceOrder);
      assert.deepEqual(
        chunkIdentity(chunk),
        chunkIdentity(original),
        `Editorial release may change only body fields: article ${entry.articleSourceOrder}`,
      );
      if (entry.editorialRef)
        assert.notDeepEqual(
          chunk.nodes.map((node) => node.body),
          original.nodes.map((node) => node.body),
          `Revised article must contain a teaching change: ${entry.articleSourceOrder}`,
        );
    }
  }
  assert(active);
  assert.deepEqual(await directoryFiles(folder), [...assets.keys()].sort(), 'Course asset union');
  assert.deepEqual(
    await directoryFiles(mediaFolder),
    [...mediaAssets.keys()].sort(),
    'Course media asset union',
  );
  return { release, ...active, legacy, assets, mediaAssets, language };
}

async function publishImmutable(folder, assets) {
  await mkdir(folder, { recursive: true });
  const existing = await directoryFiles(folder);
  for (const file of existing) {
    assert(assets.has(file), `Unknown published asset: ${file}`);
    assert.deepEqual(
      await readFile(new URL(file, folder)),
      assets.get(file),
      `Published asset is immutable: ${file}`,
    );
  }
  for (const [file, bytes] of assets) {
    try {
      await writeFile(new URL(file, folder), bytes, { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assert.deepEqual(await readFile(new URL(file, folder)), bytes, `Immutable asset: ${file}`);
    }
  }
  assert.deepEqual(await directoryFiles(folder), [...assets.keys()].sort());
}

export async function publishEditorialCourseAssets(bundle) {
  await publishImmutable(
    new URL(`web/public/content/${bundle.language}/course/`, root),
    bundle.assets,
  );
  await publishImmutable(
    new URL(`web/public/content/${bundle.language}/media/`, root),
    bundle.mediaAssets,
  );
}
