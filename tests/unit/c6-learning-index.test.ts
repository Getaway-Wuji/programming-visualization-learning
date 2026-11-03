import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { c6LearningRelease } from '../../web/src/c6-learning/release.generated';
import {
  c6LearningCatalog,
  loadC6LearningIndex,
  validateC6LearningIndex,
} from '../../web/src/c6-learning';
import { parseC6TeachingManifest } from '../../web/src/content/c6-teaching-validator.mjs';
import { c6TeachingRelease } from '../../web/src/content/c6-teaching-release.generated';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import type { LearningCatalog } from '../../web/src/learning/types';
import { createC6StorageActivation, c6ActivationIndex } from '../../web/src/storage/c6-activation';

const bytes = readFileSync(
  new URL('../../content/c/primer6-learning/index-1.0.0.json', import.meta.url),
);
const data = () => JSON.parse(bytes.toString('utf8'));
const manifest = await parseC6TeachingManifest(
  Uint8Array.from(
    readFileSync(new URL('../../content/c/primer6-teaching/manifest-2.0.0.json', import.meta.url)),
  ),
  c6TeachingRelease.manifestSha256,
);
afterEach(() => vi.unstubAllGlobals());

it('projects the real 404 lessons, 44 four-case exercises and 42 reward groups without loading bodies', () => {
  const index = validateC6LearningIndex(data(), manifest);
  const catalog = c6LearningCatalog(index);
  expect(catalog.purpose).toBe('c6-course-practice');
  expect(() => createLearningCatalog(catalog as unknown as LearningCatalog)).toThrow();
  expect(catalog.packageRef).toEqual({ id: 'content.c.primer6', version: '2.0.0' });
  expect(catalog.lessons).toHaveLength(404);
  expect(catalog.exercises).toHaveLength(44);
  expect(catalog.exercises.every((e) => e.caseKeys.length === 4)).toBe(true);
  expect(index.lessons.filter((l) => l[5].length === 0)).toHaveLength(360);
  expect(index.knowledge).toHaveLength(421);
  expect(index.rewardGroups).toHaveLength(42);
  expect(bytes.length).toBe(c6LearningRelease.bytes);
  expect(bytes.length).toBeLessThan(262144);
  expect(Object.isFrozen(index.rewardGroups[0].lessonRefs)).toBe(true);
  expect(() => createC6StorageActivation(index)).toThrow();
});

it.each([
  'wrong-chapter',
  'duplicate-lesson',
  'wrong-knowledge',
  'wrong-judge',
  'wrong-reward-group',
  'forced-pass-transfer',
])('rejects a wrong integration relationship: %s', (fault) => {
  const changed = data();
  if (fault === 'wrong-chapter') changed.lessons[0][2] = 'node.c6.ch17';
  if (fault === 'duplicate-lesson') changed.lessons[1] = changed.lessons[0];
  if (fault === 'wrong-knowledge') changed.knowledge[1][0] = changed.knowledge[0][0];
  if (fault === 'wrong-judge') changed.exercises[0][3] = 'judge.c6.s3.2';
  if (fault === 'wrong-reward-group') changed.lessons[0][4] = 'reward.legacy.first-program';
  if (fault === 'forced-pass-transfer') changed.legacyLinks[0].transferPass = true;
  expect(() => validateC6LearningIndex(changed, manifest)).toThrow();
});

it('loads only the pinned same-origin index and rejects changed HTTP bytes', async () => {
  vi.stubGlobal('location', { href: 'http://localhost:4173/', origin: 'http://localhost:4173' });
  const fetcher = vi.fn<typeof fetch>(async () => new Response(Uint8Array.from(bytes).buffer));
  const loaded = await loadC6LearningIndex(manifest, undefined, fetcher);
  expect(loaded.lessons).toHaveLength(404);
  const activation = createC6StorageActivation(loaded);
  expect(c6ActivationIndex(activation)).toBe(loaded);
  expect(() => c6ActivationIndex(structuredClone(activation))).toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe(
    'http://localhost:4173/content/c/primer6-learning/index-1.0.0.json',
  );
  const changed = Uint8Array.from(bytes);
  changed[20] ^= 1;
  await expect(
    loadC6LearningIndex(manifest, undefined, async () => new Response(changed.buffer)),
  ).rejects.toMatchObject({ code: 'C6_INDEX_HASH' });
});

it('an already-cancelled bootstrap cannot accept a later successful resource', async () => {
  vi.stubGlobal('location', { href: 'http://localhost:4173/', origin: 'http://localhost:4173' });
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadC6LearningIndex(
      manifest,
      controller.signal,
      async () => new Response(Uint8Array.from(bytes).buffer),
    ),
  ).rejects.toMatchObject({ code: 'C6_INDEX_CANCELLED' });
});
