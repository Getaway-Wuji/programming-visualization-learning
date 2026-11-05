// Deterministic CONTENT3 publication from self-contained product content only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  c6TeachingCounts,
  c6TeachingEntityKinds,
} from '../../web/src/content/c6-teaching-schema.mjs';
import {
  C6_TEACHING_LIMITS,
  parseC6TeachingSource,
  parseC6TeachingManifest,
  parseC6TeachingChunk,
  validateCompleteC6Teaching,
} from '../../web/src/content/c6-teaching-validator.mjs';

const sourcePath = 'content/c/primer6-teaching/source-2.0.0.json';
const folder = 'content/c/primer6-teaching';
const publicFolder = 'web/public/content/c/primer6-teaching';
const pinPath = 'web/src/content/c6-teaching-release.generated.ts';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => Buffer.from(`${JSON.stringify(value)}\n`);

export async function produceC6Teaching(bytes) {
  const source = await parseC6TeachingSource(bytes);
  const { chapters, ...metadata } = source;
  const assets = new Map();
  const chunks = [];
  for (const chapter of chapters) {
    const bytes = encode(chapter);
    assert(bytes.length <= C6_TEACHING_LIMITS.chunk);
    const file = `${chapter.chunkId}-2.0.0.json`;
    assets.set(file, bytes);
    chunks.push({
      id: chapter.chunkId,
      kind: chapter.kind,
      rootNodeId: chapter.rootNodeId,
      file,
      bytes: bytes.length,
      sha256: hash(bytes),
      counts: Object.fromEntries(
        ['nodes', ...c6TeachingEntityKinds].map((kind) => [kind, chapter[kind].length]),
      ),
      entityIds: Object.fromEntries(
        c6TeachingEntityKinds.map((kind) => [kind, chapter[kind].map((row) => row.ref.id)]),
      ),
    });
  }
  const manifestValue = {
    ...metadata,
    sourceSha256: hash(bytes),
    counts: c6TeachingCounts,
    budgets: {
      packageBytes: 20971520,
      manifestBytes: 262144,
      chunkBytes: 1048576,
      sourceBytes: 32768,
    },
    compatibilityChunkId: 'chA',
    chunks,
    nodes: chapters.flatMap((chapter) =>
      chapter.nodes.map((node) => ({
        id: node.sourceNodeId,
        parentId: node.parentRef?.id.slice(5) ?? null,
        order: node.order,
        titleOriginal: node.titleOriginal,
        titleDisplay: node.titleDisplay,
        category: node.category,
        physicalPage: node.locator.physicalPage,
        chunkId: chapter.chunkId,
      })),
    ),
  };
  const manifestBytes = encode(manifestValue);
  const manifestSha256 = hash(manifestBytes);
  const manifest = await parseC6TeachingManifest(manifestBytes, manifestSha256);
  const parsed = [];
  for (const entry of manifest.chunks)
    parsed.push(await parseC6TeachingChunk(assets.get(entry.file), manifest, entry.id));
  const coverage = await validateCompleteC6Teaching(manifest, parsed);
  const manifestFile = 'manifest-2.0.0.json';
  assets.set(manifestFile, manifestBytes);
  const release = {
    contractVersion: '3.0.0',
    packageId: 'content.c.primer6',
    packageVersion: '2.0.0',
    manifestFile,
    manifestSha256,
    sourceSha256: manifest.sourceSha256,
    engineBuildSha256: manifest.engineBuildSha256,
    scopeRevision: manifest.scopeRevision,
  };
  return { assets, manifest, release, coverage };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await produceC6Teaching(readFileSync(sourcePath));
  const summary = {
    ...result.coverage,
    assets: result.assets.size,
    manifestBytes: result.assets.get(result.release.manifestFile).length,
    largestChunkBytes: Math.max(...result.manifest.chunks.map((entry) => entry.bytes)),
    packageBytes: [...result.assets.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    manifestSha256: result.release.manifestSha256,
  };
  if (process.argv.includes('--inspect')) {
    console.log(JSON.stringify({ ...summary, written: false, semanticAcceptanceInferred: false }));
  } else {
    const wasm = readFileSync('web/src/generated/c6-teaching/c_viz_c6_bg.wasm');
    assert.equal(hash(wasm), result.release.engineBuildSha256);
    const pin = await format(
      `// Generated from the reviewed independent CONTENT3 product source.\nexport const c6TeachingRelease = ${JSON.stringify(result.release)} as const;\n`,
      { ...(await resolveConfig('.prettierrc.json')), parser: 'typescript' },
    );
    if (process.argv.includes('--write')) {
      mkdirSync(folder, { recursive: true });
      for (const [file, bytes] of result.assets) writeFileSync(`${folder}/${file}`, bytes);
      writeFileSync(pinPath, pin);
    } else {
      assert(existsSync(pinPath));
      assert.equal(readFileSync(pinPath, 'utf8'), pin);
      for (const [file, bytes] of result.assets)
        assert.deepEqual(readFileSync(`${folder}/${file}`), bytes, file);
    }
    mkdirSync(publicFolder, { recursive: true });
    for (const [file, bytes] of result.assets) writeFileSync(`${publicFolder}/${file}`, bytes);
    console.log(JSON.stringify(summary));
  }
}
