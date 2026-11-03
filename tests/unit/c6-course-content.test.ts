import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createC6CourseRepository } from '../../web/src/content/c6-course-repository';
import { c6CourseRelease } from '../../web/src/content/c6-course-release.generated';
import {
  C6ContentError,
  C6_CONTENT_LIMITS,
  c6ContentSha256,
  parseC6Chunk,
  parseC6Manifest,
  validateC6Chunk,
  validateC6Manifest,
  validateCompleteC6Course,
} from '../../web/src/content/c6-course-validator.mjs';
import type {
  C6ChunkId,
  C6CourseChunk,
  C6CourseManifest,
} from '../../web/src/content/c6-course-types';

type Mutable<T> = T extends readonly (infer U)[]
  ? Mutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Mutable<T[K]> }
    : T;
const folder = new URL('../../content/c/primer6/', import.meta.url);
const bytes = (file: string) => Uint8Array.from(readFileSync(new URL(file, folder)));
const manifestBytes = bytes('manifest-1.0.0.json');
const draftManifest = () =>
  JSON.parse(new TextDecoder().decode(manifestBytes)) as Mutable<C6CourseManifest>;
const draftChunk = (id: C6ChunkId) =>
  JSON.parse(new TextDecoder().decode(bytes(`${id}-1.0.0.json`))) as Mutable<C6CourseChunk>;
const response = (data: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(Uint8Array.from(data).buffer, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(data.byteLength),
      ...headers,
    },
  });
const fetchedFile = (input: RequestInfo | URL) =>
  new URL(String(input)).pathname.split('/').at(-1)!;
const serving = () => vi.fn<typeof fetch>(async (input) => response(bytes(fetchedFile(input))));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() =>
  vi.stubGlobal('location', { href: 'http://localhost:4173/', origin: 'http://localhost:4173' }),
);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CONTENT2 actual published material', () => {
  it('accepts the pinned manifest and all nineteen blocks with complete global closure', async () => {
    const manifest = await parseC6Manifest(manifestBytes, c6CourseRelease.manifestSha256);
    const chunks = await Promise.all(
      manifest.chunks.map((c) => parseC6Chunk(bytes(c.file), manifest, c.id)),
    );
    expect(await validateCompleteC6Course(manifest, chunks)).toEqual({
      nodes: 650,
      lessons: 404,
      activities: 793,
      examples: 232,
      exercises: 44,
      knowledge: 421,
      referenceOnlyB: true,
    });
    const reference = chunks.find((c) => c.chunkId === 'chB')!;
    expect(reference.nodes).toHaveLength(93);
    expect(reference.lessons).toHaveLength(0);
    expect(reference.activities).toHaveLength(0);
    expect(reference.knowledge).toHaveLength(0);
    expect(Object.isFrozen(reference.nodes[0])).toBe(true);
    expect(
      chunks
        .flatMap((c) => c.exercises)
        .every(
          (e) =>
            e.verification.referenceStatus === 'passed' &&
            e.verification.starterStatus === 'failed' &&
            e.verification.caseCount === 4,
        ),
    ).toBe(true);
  });

  it.each([
    'unknown-property',
    'duplicate-order',
    'extra-root',
    'wrong-chunk-owner',
    'b-teaching',
    'duplicate-entity',
  ])('rejects manifest damage: %s', (kind) => {
    const m = draftManifest();
    if (kind === 'unknown-property') Object.assign(m, { accountRequired: true });
    if (kind === 'duplicate-order') m.nodes[1].order = m.nodes[0].order;
    if (kind === 'extra-root') m.nodes[1].parentId = null;
    if (kind === 'wrong-chunk-owner') m.nodes[1].chunkId = 'ch02';
    if (kind === 'b-teaching')
      m.nodes.find((n) => n.id === 'c6.sB.2.1')!.category = 'teaching-lesson';
    if (kind === 'duplicate-entity')
      m.chunks[0].entityIds.lessons[1] = m.chunks[0].entityIds.lessons[0];
    expect(() => validateC6Manifest(m)).toThrow(C6ContentError);
  });

  it('rejects accessor data without evaluating it and rejects prototype keys', () => {
    const getter = vi.fn(() => 'bad');
    const m = draftManifest();
    Object.defineProperty(m, 'unsafe', { enumerable: true, get: getter });
    expect(() => validateC6Manifest(m)).toThrow(C6ContentError);
    expect(getter).not.toHaveBeenCalled();
    const poison = draftManifest();
    Object.defineProperty(poison, '__proto__', { value: {}, enumerable: true });
    expect(() => validateC6Manifest(poison)).toThrow(C6ContentError);
  });

  it.each([
    'duplicate-choice',
    'dangling-reference',
    'wrong-version',
    'coding-pass-claim',
    'missing-assessment',
  ])('rejects chunk semantic damage: %s', async (kind) => {
    const m = validateC6Manifest(draftManifest()),
      c = draftChunk('ch03');
    if (kind === 'duplicate-choice') {
      const a = c.activities.find((a) => a.kind === 'concept-check')!;
      a.check.options[1].text = a.check.options[0].text;
    }
    if (kind === 'dangling-reference')
      c.lessons[0].requiredActivityRefs[0].id = 'activity.c6.missing.concept';
    if (kind === 'wrong-version') c.nodes[0].ref.version = '9.0.0';
    if (kind === 'coding-pass-claim')
      Object.assign(c.activities[0], { originalExercisePassClaim: true });
    if (kind === 'missing-assessment') {
      const activity = c.activities.find(
        (a) => a.kind === 'source-design-check' && a.sourceQuestion.kind === 'programming',
      )!;
      if (activity.kind !== 'source-design-check') throw new Error('fixture kind');
      activity.codingAssessment = null;
    }
    await expect(validateC6Chunk(c, m, 'ch03')).rejects.toBeInstanceOf(C6ContentError);
  });

  it('rejects B lesson injection rather than converting references into a course', async () => {
    const c = draftChunk('chB');
    c.lessons.push(draftChunk('ch01').lessons[0]);
    await expect(
      validateC6Chunk(c, validateC6Manifest(draftManifest()), 'chB'),
    ).rejects.toMatchObject({ code: 'C6_CONTENT_REFERENCE' });
  });

  it('binds real verification to the exact executable source', async () => {
    const c = draftChunk('ch02');
    c.examples.find((e) => e.mode === 'c6-independent-executable')!.source += '\n/* changed */';
    await expect(
      validateC6Chunk(c, validateC6Manifest(draftManifest()), 'ch02'),
    ).rejects.toMatchObject({ code: 'C6_CONTENT_HASH' });
  });

  it.each([
    'missing-file',
    'duplicate-file',
    'reading-execution-proof',
    'missing-boundary',
    'utf8-source-overflow',
  ])('rejects incomplete or misleading reading package: %s', async (kind) => {
    const c = draftChunk('ch17');
    const e = c.examples.find((e) => e.mode === 'reading-only' && e.companionFiles)!;
    if (e.mode !== 'reading-only') throw new Error('fixture mode');
    if (kind === 'missing-file') e.companionFiles!.pop();
    if (kind === 'duplicate-file') e.companionFiles![1].path = e.companionFiles![0].path;
    if (kind === 'reading-execution-proof')
      Object.assign(e, { verification: { kind: 'rust-verified' } });
    if (kind === 'missing-boundary') Object.assign(e, { readingBoundary: '' });
    if (kind === 'utf8-source-overflow') e.source += `\n/*${'学'.repeat(12000)}*/`;
    await expect(
      validateC6Chunk(c, validateC6Manifest(draftManifest()), 'ch17'),
    ).rejects.toBeInstanceOf(C6ContentError);
  });

  it('rejects changed bytes, an unknown manifest pin, bad UTF8 and excess manifest bytes', async () => {
    await expect(parseC6Manifest(manifestBytes, '0'.repeat(64))).rejects.toMatchObject({
      code: 'C6_CONTENT_HASH',
    });
    const malformed = new Uint8Array([255]);
    await expect(
      parseC6Manifest(malformed, await c6ContentSha256(malformed)),
    ).rejects.toMatchObject({ code: 'C6_CONTENT_INVALID' });
    await expect(
      parseC6Manifest(
        new Uint8Array(C6_CONTENT_LIMITS.manifest + 1),
        c6CourseRelease.manifestSha256,
      ),
    ).rejects.toMatchObject({ code: 'C6_CONTENT_SIZE' });
    const m = validateC6Manifest(draftManifest()),
      changed = bytes(m.chunks[0].file);
    changed[20] ^= 1;
    await expect(parseC6Chunk(changed, m, 'ch01')).rejects.toMatchObject({
      code: 'C6_CONTENT_HASH',
    });
  });
});

describe('independent CONTENT2 lazy repository', () => {
  it('fetches only the manifest and requested reference block, then serves verified cache', async () => {
    const fetcher = serving(),
      repo = createC6CourseRepository({ fetcher });
    const node = await repo.loadNode('c6.sB.2.1');
    expect(node.area).toBe('reference');
    expect(node.lessonRef).toBeNull();
    expect(node.activityRefs).toEqual([]);
    expect(fetcher.mock.calls.map(([url]) => fetchedFile(url))).toEqual([
      'manifest-1.0.0.json',
      'chB-1.0.0.json',
    ]);
    expect(await repo.loadNode('c6.sB.2.1')).toBe(node);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(repo.getSnapshot().loadedChunkIds).toEqual(['chB']);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  });

  it.each([
    'https://other.test/content/c/primer6/m.json',
    'data:application/json,{}',
    'http://u:p@localhost:4173/content/c/primer6/m.json',
    '/content/c/primer6/m.json?x=1',
    '/content/c/primer6/m.json#part',
    '/content/c/primer6/%2foutside.json',
    '/content/c/primer6/../../outside.json',
  ])('rejects forbidden resource %s before fetching', async (manifestUrl) => {
    const fetcher = serving(),
      repo = createC6CourseRepository({ fetcher, manifestUrl });
    await expect(repo.loadManifest()).rejects.toMatchObject({ code: 'C6_CONTENT_FORBIDDEN' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not cache a failed response and succeeds on explicit retry', async () => {
    const fetcher = serving();
    fetcher.mockImplementationOnce(async () => new Response('failed', { status: 503 }));
    const repo = createC6CourseRepository({ fetcher });
    await expect(repo.loadManifest()).rejects.toMatchObject({ code: 'C6_CONTENT_LOAD_FAILED' });
    expect(repo.getSnapshot().manifest).toBeNull();
    expect((await repo.loadManifest()).counts.lessons).toBe(404);
    expect(repo.getSnapshot().error).toBeNull();
  });

  it('handles a synchronously throwing injected fetcher and can retry', async () => {
    const fetcher = serving();
    fetcher.mockImplementationOnce(() => {
      throw new Error('sync failure');
    });
    const repo = createC6CourseRepository({ fetcher });
    await expect(repo.loadManifest()).rejects.toMatchObject({ code: 'C6_CONTENT_LOAD_FAILED' });
    await repo.loadManifest();
  });

  it('aborts one independent consumer without cancelling another and ignores the late result', async () => {
    const late = deferred<Response>(),
      fetcher = serving();
    fetcher.mockImplementationOnce(() => late.promise);
    const repo = createC6CourseRepository({ fetcher }),
      controller = new AbortController();
    const first = repo.loadManifest(controller.signal),
      rejectFirst = expect(first).rejects.toMatchObject({ code: 'C6_CONTENT_CANCELLED' });
    const second = repo.loadManifest();
    controller.abort();
    const accepted = await second;
    await rejectFirst;
    late.resolve(response(manifestBytes));
    await Promise.resolve();
    expect(repo.getSnapshot().manifest).toBe(accepted);
    expect(fetcher.mock.calls[0][1]!.signal).not.toBe(fetcher.mock.calls[1][1]!.signal);
  });

  it('reset cancels a late body install and a new generation can load afresh', async () => {
    const late = deferred<Response>(),
      fetcher = serving(),
      repo = createC6CourseRepository({ fetcher });
    await repo.loadManifest();
    fetcher.mockImplementationOnce(() => late.promise);
    const pending = repo.loadChunk('chB'),
      rejected = expect(pending).rejects.toMatchObject({ code: 'C6_CONTENT_CANCELLED' });
    await Promise.resolve();
    repo.reset();
    await rejected;
    late.resolve(response(bytes('chB-1.0.0.json')));
    await repo.loadNode('c6.s2.1');
    expect(repo.getSnapshot().generation).toBe(1);
    expect(repo.getSnapshot().loadedChunkIds).toEqual(['ch02']);
  });

  it('rejects a pre-aborted cache read and unknown node without fetching another block', async () => {
    const fetcher = serving(),
      repo = createC6CourseRepository({ fetcher });
    await repo.loadChunk('ch01');
    const abort = new AbortController();
    abort.abort();
    await expect(repo.loadChunk('ch01', abort.signal)).rejects.toMatchObject({
      code: 'C6_CONTENT_CANCELLED',
    });
    await expect(repo.loadNode('c6.sB.unknown')).rejects.toMatchObject({
      code: 'C6_CONTENT_REFERENCE',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('checks streamed bytes even when Content-Length lies', async () => {
    const fetcher = serving(),
      repo = createC6CourseRepository({ fetcher });
    const manifest = await repo.loadManifest();
    fetcher.mockImplementationOnce(async () =>
      response(new Uint8Array(manifest.chunks[0].bytes + 1), { 'Content-Length': '1' }),
    );
    await expect(repo.loadChunk('ch01')).rejects.toMatchObject({ code: 'C6_CONTENT_SIZE' });
    expect(repo.getSnapshot().loadedChunkIds).toEqual([]);
    await repo.loadChunk('ch01');
  });

  it('rejects a changed block, preserves the accepted block and retries cleanly', async () => {
    const fetcher = serving(),
      repo = createC6CourseRepository({ fetcher });
    await repo.loadChunk('ch01');
    const changed = bytes('ch02-1.0.0.json');
    changed[100] ^= 1;
    fetcher.mockImplementationOnce(async () => response(changed));
    await expect(repo.loadChunk('ch02')).rejects.toMatchObject({ code: 'C6_CONTENT_HASH' });
    expect(repo.getSnapshot().loadedChunkIds).toEqual(['ch01']);
    await repo.loadChunk('ch02');
    expect(repo.getSnapshot().error).toBeNull();
  });

  it.each(['redirect', 'final-url', 'oversize-header', 'changed-manifest'])(
    'rejects untrusted fetch result: %s',
    async (kind) => {
      const fetcher = serving();
      fetcher.mockImplementationOnce(async () => {
        const r = response(
          manifestBytes,
          kind === 'oversize-header' ? { 'Content-Length': '99999999' } : {},
        );
        if (kind === 'redirect') Object.defineProperty(r, 'redirected', { value: true });
        if (kind === 'final-url')
          Object.defineProperty(r, 'url', { value: 'https://elsewhere.test/m.json' });
        if (kind === 'changed-manifest') {
          const b = Uint8Array.from(manifestBytes);
          b[20] ^= 1;
          return response(b);
        }
        return r;
      });
      const repo = createC6CourseRepository({ fetcher });
      await expect(repo.loadManifest()).rejects.toBeInstanceOf(C6ContentError);
      expect(repo.getSnapshot().manifest).toBeNull();
    },
  );

  it('times out a fetcher that ignores AbortSignal', async () => {
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    await expect(
      createC6CourseRepository({ fetcher, timeoutMs: 5 }).loadManifest(),
    ).rejects.toMatchObject({ code: 'C6_CONTENT_TIMEOUT' });
  });

  it('times out a stalled reader without awaiting its hostile cancel promise', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(new ReadableStream({ cancel: () => new Promise(() => undefined) })),
    );
    await expect(
      createC6CourseRepository({ fetcher, timeoutMs: 5 }).loadManifest(),
    ).rejects.toMatchObject({ code: 'C6_CONTENT_TIMEOUT' });
  });

  it('stops an endless empty-chunk stream even when microtasks starve the timer', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array());
            },
          }),
        ),
    );
    await expect(
      createC6CourseRepository({ fetcher, timeoutMs: 5 }).loadManifest(),
    ).rejects.toMatchObject({ code: 'C6_CONTENT_TIMEOUT' });
  });
});
