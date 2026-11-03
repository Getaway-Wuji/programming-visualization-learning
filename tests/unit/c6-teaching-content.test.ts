import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { c6TeachingRelease } from '../../web/src/content/c6-teaching-release.generated';
import { createC6TeachingRepository } from '../../web/src/content/c6-teaching-repository';
import {
  C6TeachingContentError,
  C6_TEACHING_LIMITS,
  c6TeachingSha256,
  parseC6TeachingManifest,
  parseC6TeachingChunk,
  validateC6TeachingManifest,
  validateC6TeachingChunk,
  validateCompleteC6Teaching,
} from '../../web/src/content/c6-teaching-validator.mjs';
import { parseC6Manifest } from '../../web/src/content/c6-course-validator.mjs';
import { c6CourseRelease } from '../../web/src/content/c6-course-release.generated';
import type {
  C6TeachingChunk,
  C6TeachingChunkId,
  C6TeachingManifest,
} from '../../web/src/content/c6-teaching-types';

type Mutable<T> = T extends readonly []
  ? []
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;
const folder = new URL('../../content/c/primer6-teaching/', import.meta.url);
const bytes = (file: string) => Uint8Array.from(readFileSync(new URL(file, folder)));
const manifestBytes = bytes('manifest-2.0.0.json');
const draftManifest = () =>
  JSON.parse(new TextDecoder().decode(manifestBytes)) as Mutable<C6TeachingManifest>;
const draftChunk = (id: C6TeachingChunkId) =>
  JSON.parse(new TextDecoder().decode(bytes(`${id}-2.0.0.json`))) as Mutable<C6TeachingChunk>;
const encoded = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
async function rebound(chunk: C6TeachingChunk) {
  const manifest = draftManifest();
  const entry = manifest.chunks.find((entry) => entry.id === chunk.chunkId)!;
  const data = encoded(chunk);
  entry.bytes = data.length;
  entry.sha256 = await c6TeachingSha256(data);
  return validateC6TeachingManifest(manifest);
}
const response = (data: Uint8Array) =>
  new Response(Uint8Array.from(data).buffer, {
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(data.length) },
  });
const fetchedFile = (input: RequestInfo | URL) =>
  new URL(String(input)).pathname.split('/').at(-1)!;
const serving = () => vi.fn<typeof fetch>(async (input) => response(bytes(fetchedFile(input))));
beforeEach(() =>
  vi.stubGlobal('location', {
    href: 'http://localhost:4173/',
    origin: 'http://localhost:4173',
  }),
);
afterEach(() => vi.unstubAllGlobals());

describe('independent CONTENT3 material', () => {
  it('loads the complete real package and preserves the approved code and judge ownership', async () => {
    const manifest = await parseC6TeachingManifest(manifestBytes, c6TeachingRelease.manifestSha256);
    const chapters = await Promise.all(
      manifest.chunks.map((entry) => parseC6TeachingChunk(bytes(entry.file), manifest, entry.id)),
    );
    const coverage = await validateCompleteC6Teaching(manifest, chapters);
    expect(coverage.teachingBodies).toBe(505);
    expect(coverage.teachingProgramSlots).toBe(576);
    const references = chapters.filter((chapter) => chapter.kind === 'reference-appendix');
    expect(references.flatMap((chapter) => chapter.nodes)).toHaveLength(111);
    for (const chapter of references) {
      expect(chapter.lessons).toEqual([]);
      expect(chapter.activities).toEqual([]);
      expect(chapter.knowledge).toEqual([]);
      expect(
        chapter.nodes.every((node) => node.lessonRef === null && node.programRefs.length === 0),
      ).toBe(true);
    }
    const activities = chapters.flatMap((chapter) => chapter.activities);
    expect(activities.filter((activity) => activity.mandatory)).toHaveLength(44);
    expect(activities.filter((activity) => activity.kind === 'source-design-guide')).toHaveLength(
      345,
    );
    expect(activities.some((activity) => 'check' in activity)).toBe(false);
    expect(
      chapters
        .flatMap((chapter) => chapter.lessons)
        .filter((lesson) => lesson.requiredActivityRefs.length === 0).length,
    ).toBe(360);
    for (const exercise of chapters.flatMap((chapter) => chapter.exercises)) {
      expect(exercise.ref.version).toBe('2.0.0');
      expect(exercise.profileRef.version).toBe('1.0.0');
      expect(exercise.programRef.version).toBe('1.0.0');
      expect(exercise.tests).toHaveLength(4);
    }
    expect(manifest.judgeOwnerPackageRef).toEqual({ id: 'content.c.primer6', version: '1.0.0' });
    const sample = chapters
      .find((chapter) => chapter.chunkId === 'ch14')!
      .programs.find((program) => program.files[0].source.includes('struct Book book = { //'))!;
    expect(await c6TeachingSha256(new TextEncoder().encode(sample.files[0].source))).toBe(
      '28466cf122e0ac1672c66314273be427b7d5096b07e710628867cf0b20fe2e02',
    );
    expect(Object.isFrozen(chapters[0].nodes[0])).toBe(true);
  });

  it('keeps both contract entry points strict instead of accepting the other version', async () => {
    const previous = Uint8Array.from(
      readFileSync(new URL('../../content/c/primer6/manifest-1.0.0.json', import.meta.url)),
    );
    await expect(parseC6Manifest(previous, c6CourseRelease.manifestSha256)).resolves.toHaveProperty(
      'contractVersion',
      '2.0.0',
    );
    await expect(
      parseC6Manifest(manifestBytes, c6TeachingRelease.manifestSha256),
    ).rejects.toThrow();
    await expect(
      parseC6TeachingManifest(previous, c6CourseRelease.manifestSha256),
    ).rejects.toThrow();
  });

  it.each([
    'reference-course',
    'wrong-judge-owner',
    'unknown-property',
    'wrong-version',
    'duplicate-order',
  ])('rejects manifest damage: %s', (damage) => {
    const manifest = draftManifest();
    if (damage === 'reference-course')
      manifest.nodes.find((node) => node.id === 'c6.sB.2.1')!.category = 'teaching-lesson';
    if (damage === 'wrong-judge-owner')
      Object.assign(manifest.judgeOwnerPackageRef, { version: '2.0.0' });
    if (damage === 'unknown-property') Object.assign(manifest, { fallbackToOldCourse: true });
    if (damage === 'wrong-version') Object.assign(manifest, { contractVersion: '2.0.0' });
    if (damage === 'duplicate-order') manifest.nodes[1].order = manifest.nodes[0].order;
    expect(() => validateC6TeachingManifest(manifest)).toThrow(C6TeachingContentError);
  });

  it.each([
    'missing-code',
    'old-judge-version',
    'dangling-program',
    'forced-quiz',
    'forged-run',
    'reading-execution',
  ])('rejects semantic damage even with rebound asset hashes: %s', async (damage) => {
    const chunk = draftChunk(damage === 'forced-quiz' ? 'ch03' : 'ch17');
    if (damage === 'missing-code')
      chunk.nodes[0].body = chunk.nodes[0].body.replace('```c', '```text');
    if (damage === 'old-judge-version') {
      const other = draftChunk('ch02');
      Object.assign(other.exercises[0].profileRef, { version: '2.0.0' });
      await expect(validateC6TeachingChunk(other, await rebound(other), 'ch02')).rejects.toThrow(
        C6TeachingContentError,
      );
      return;
    }
    if (damage === 'dangling-program') chunk.nodes[0].programRefs[0].id = 'teach.c6.ch17.missing';
    if (damage === 'forced-quiz')
      Object.assign(
        chunk.activities.find((activity) => !activity.mandatory)!,
        {
          check: { prompt: 'required', options: [], answerKey: 'A' },
        },
      );
    if (damage === 'forged-run') {
      const program = chunk.programs.find((program) => program.mode === 'execute')!;
      if (program.mode !== 'execute') throw new Error('fixture');
      program.additionalRuns[0].input = '9\n';
    }
    if (damage === 'reading-execution')
      Object.assign(
        chunk.programs.find((program) => program.mode === 'reading')!,
        { verification: { kind: 'rust-verified' } },
      );
    await expect(
      validateC6TeachingChunk(chunk, await rebound(chunk), chunk.chunkId),
    ).rejects.toThrow(C6TeachingContentError);
  });

  it('rejects accessors without running them and rejects corrupt UTF8 and size excess', async () => {
    const getter = vi.fn(() => true),
      manifest = draftManifest();
    Object.defineProperty(manifest, 'unsafe', { get: getter, enumerable: true });
    expect(() => validateC6TeachingManifest(manifest)).toThrow(C6TeachingContentError);
    expect(getter).not.toHaveBeenCalled();
    const malformed = new Uint8Array([255]);
    await expect(
      parseC6TeachingManifest(malformed, await c6TeachingSha256(malformed)),
    ).rejects.toMatchObject({ code: 'C6_TEACHING_INVALID' });
    await expect(
      parseC6TeachingManifest(new Uint8Array(C6_TEACHING_LIMITS.manifest + 1), '0'.repeat(64)),
    ).rejects.toMatchObject({ code: 'C6_TEACHING_SIZE' });
  });
});

describe('CONTENT3 lazy repository', () => {
  it('loads only the requested reference block and retains verified cache', async () => {
    const fetcher = serving(),
      repository = createC6TeachingRepository({ fetcher });
    const reference = await repository.loadNode('c6.sB.2.1');
    expect(reference.area).toBe('reference');
    expect(reference.lessonRef).toBeNull();
    expect(fetcher.mock.calls.map(([url]) => fetchedFile(url))).toEqual([
      'manifest-2.0.0.json',
      'chB-2.0.0.json',
    ]);
    await repository.loadNode('c6.sB.2.1');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const init = fetcher.mock.calls[0][1]!;
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    await expect(
      repository.loadEntity({ id: 'lesson.c6.sB.2.1', version: '2.0.0' }, 'lessons'),
    ).rejects.toMatchObject({ code: 'C6_TEACHING_REFERENCE' });
  });

  it('does not route version-1 judge ownership into version-2 content entities', async () => {
    const repository = createC6TeachingRepository({ fetcher: serving() });
    await expect(
      repository.loadEntity({ id: 'exercise.c6.s2.1', version: '1.0.0' }, 'exercises'),
    ).rejects.toMatchObject({ code: 'C6_TEACHING_REFERENCE' });
    const exercise = await repository.loadEntity(
      { id: 'exercise.c6.s2.1', version: '2.0.0' },
      'exercises',
    );
    expect('profileRef' in exercise && exercise.profileRef.version).toBe('1.0.0');
  });

  it('reset rejects an in-flight load and cannot restore it after a late response', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const repository = createC6TeachingRepository({ fetcher });
    const pending = repository.loadManifest();
    repository.reset();
    await expect(pending).rejects.toMatchObject({ code: 'C6_TEACHING_CANCELLED' });
    finish(response(manifestBytes));
    await Promise.resolve();
    expect(repository.getSnapshot().manifest).toBeNull();
    expect(repository.getSnapshot().loadedChunkIds).toEqual([]);
    expect(repository.getSnapshot().error).toBeNull();
  });

  it('rejects timeout and foreign locations with no legacy-course fallback', async () => {
    const stalled = createC6TeachingRepository({
      timeoutMs: 10,
      fetcher: vi.fn<typeof fetch>(() => new Promise(() => undefined)),
    });
    await expect(stalled.loadManifest()).rejects.toMatchObject({ code: 'C6_TEACHING_TIMEOUT' });
    const fetcher = serving();
    const foreign = createC6TeachingRepository({
      fetcher,
      manifestUrl: 'https://unrelated.test/content/c/primer6-teaching/manifest-2.0.0.json',
    });
    await expect(foreign.loadManifest()).rejects.toMatchObject({ code: 'C6_TEACHING_FORBIDDEN' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
