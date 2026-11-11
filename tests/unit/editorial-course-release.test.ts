import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseJava3CourseManifest,
  parseJava3CourseChunk,
} from '../../shared/contracts/java-content.mjs';
import {
  parsePython3CourseManifest,
  parsePython3CourseChunk,
} from '../../shared/contracts/python3-content.mjs';
import type { JavaRef } from '../../web/src/engine/java-types';

interface Release {
  packageRef: JavaRef;
  editorialRef?: { id: string; version: string };
  manifestFile: string;
  manifestBytes: number;
  manifestSha256: string;
}
const bytes = (path: string) => new Uint8Array(readFileSync(path));
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) + '\n');

for (const language of ['java', 'python3']) {
  const parseManifest = language === 'java' ? parseJava3CourseManifest : parsePython3CourseManifest;
  const parseChunk = language === 'java' ? parseJava3CourseChunk : parsePython3CourseChunk;
  const folder = `content/${language}/course/`;
  const active = JSON.parse(
    readFileSync(
      'content/build/' +
        JSON.parse(readFileSync(`content/build/${language}-course-current.json`, 'utf8'))
          .releaseFile,
      'utf8',
    ),
  ) as Release;
  const old = JSON.parse(
    readFileSync(`content/build/${language}-course-1.0.0.json`, 'utf8'),
  ) as Release;
  const rebound = (manifest: unknown) => {
    const data = encoded(manifest);
    return { data, release: { ...active, manifestBytes: data.length, manifestSha256: hash(data) } };
  };
  describe(`${language} independent teaching revision`, () => {
    it('retains every original published byte and changes no learning, judging or execution identity', async () => {
      const legacy = await parseManifest(bytes(folder + old.manifestFile), old);
      const manifest = await parseManifest(bytes(folder + active.manifestFile), active);
      expect(manifest.packageRef).toEqual(legacy.packageRef);
      expect(manifest.engine).toEqual(legacy.engine);
      expect(manifest.editorialRef).toEqual(active.editorialRef);
      for (const entry of manifest.chunks) {
        const previous = legacy.chunks.find(
          (row) => row.articleSourceOrder === entry.articleSourceOrder,
        )!;
        const originalBytes = bytes(folder + previous.file);
        expect(originalBytes.length).toBe(previous.bytes);
        expect(hash(originalBytes)).toBe(previous.sha256);
        const before = await parseChunk(originalBytes, legacy, entry.articleSourceOrder);
        const after = await parseChunk(
          bytes(folder + entry.file),
          manifest,
          entry.articleSourceOrder,
        );
        expect(after.examples).toEqual(before.examples);
        expect(after.activities).toEqual(before.activities);
        const identities = (nodes: typeof before.nodes) =>
          nodes.map((node) => {
            const identity = { ...node };
            delete identity.body;
            return identity;
          });
        expect(identities(after.nodes)).toEqual(identities(before.nodes));
      }
      for (const asset of manifest.media ?? []) {
        const media = bytes(`content/${language}/media/` + asset.file);
        expect(media.length).toBe(asset.bytes);
        expect(hash(media)).toBe(asset.sha256);
        expect(bytes(`web/public/content/${language}/media/` + asset.file)).toEqual(media);
      }
    });

    it('rejects altered text before it is displayed', async () => {
      const manifest = await parseManifest(bytes(folder + active.manifestFile), active);
      const entry = manifest.chunks.find((row) => row.editorialRef)!;
      const changed = bytes(folder + entry.file).slice();
      changed[changed.length - 2] ^= 1;
      await expect(parseChunk(changed, manifest, entry.articleSourceOrder)).rejects.toThrow(
        'asset hash',
      );
    });

    it('rejects a separately repinned article that belongs to a different teaching revision', async () => {
      const manifest = await parseManifest(bytes(folder + active.manifestFile), active);
      const entry = manifest.chunks.find((row) => row.editorialRef)!;
      const article = JSON.parse(readFileSync(folder + entry.file, 'utf8'));
      article.editorialRef.version = '99.0.0';
      const changed = encoded(article);
      entry.bytes = changed.length;
      entry.sha256 = hash(changed);
      await expect(parseChunk(changed, manifest, entry.articleSourceOrder)).rejects.toThrow(
        'editorial identity',
      );
    });

    it('rejects local paths and duplicate article claims in teaching source metadata', async () => {
      const manifest = await parseManifest(bytes(folder + active.manifestFile), active);
      const source = manifest.teachingSources![0];
      source.articleOrders.push(source.articleOrders[0]);
      const duplicate = rebound(manifest);
      await expect(parseManifest(duplicate.data, duplicate.release)).rejects.toThrow(
        'teaching sources',
      );
      source.articleOrders.pop();
      Object.assign(source, { localPath: 'C:/private/textbook.pdf' });
      const extra = rebound(manifest);
      await expect(parseManifest(extra.data, extra.release)).rejects.toThrow('teaching sources');
    });
  });
}
