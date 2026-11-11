import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseBookTeaching,
  validateBookTeachingEntry,
} from '../../shared/contracts/book-teaching.mjs';
import type { BookTeachingEntry } from '../../shared/contracts/book-teaching.mjs';
import { createBookTeachingReader } from '../../web/src/content/book-teaching';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const original = ['原先的一段正文。'];
const ref = { id: 'editorial.book-courses' as const, version: '1.0.0' };
const body = ['详细正文。\n\n~~~cpp\nint main() { return 0; }\n~~~\n\n结论与边界。'];
const chunk = {
  formatVersion: 1,
  editorialRef: ref,
  language: 'cpp',
  group: 'unit-01',
  baselineSha256: 'a'.repeat(64),
  nodes: [
    { id: 'cpp.book.1-1', title: '起步', originalBodySha256: sha(original.join('\n\n')), body },
  ],
};
const encoded = JSON.stringify(chunk);
const entry: BookTeachingEntry = {
  language: 'cpp',
  group: 'unit-01',
  file: 'cpp-unit-01-1.0.0.json',
  bytes: Buffer.byteLength(encoded),
  sha256: sha(encoded),
  baselineFile: 'content/cpp/course/unit-01-1.0.0.json',
  baselineSha256: 'a'.repeat(64),
  nodes: 1,
};
const controller = () => new AbortController();
const resource = (text = encoded) => new Response(text, { status: 200 });
afterEach(() => vi.unstubAllGlobals());

describe('independent book teaching revisions', () => {
  it('binds revision, language, source and node schema without accepting exercise metadata', () => {
    expect(parseBookTeaching(chunk, entry, ref)).toEqual(chunk);
    expect(parseBookTeaching(chunk, entry, { version: '1.1.0' })).toEqual(chunk);
    expect(() => parseBookTeaching(chunk, entry, { version: '0.9.0' })).toThrow();
    expect(() =>
      parseBookTeaching({ ...chunk, nodes: [{ ...chunk.nodes[0], activity: {} }] }, entry, ref),
    ).toThrow();
    expect(() => parseBookTeaching({ ...chunk, language: 'mysql' }, entry, ref)).toThrow();
    expect(() =>
      parseBookTeaching({ ...chunk, baselineSha256: 'b'.repeat(64) }, entry, ref),
    ).toThrow();
    expect(() =>
      parseBookTeaching(
        { ...chunk, nodes: [chunk.nodes[0], chunk.nodes[0]] },
        { ...entry, nodes: 2 },
        ref,
      ),
    ).toThrow();
  });
  it('preserves the existing capitalized C appendix identities while rejecting other capitalized identities', () => {
    const appendixEntry: BookTeachingEntry = {
      ...entry,
      language: 'c',
      group: 'chA',
      file: 'c-chA-1.0.0.json',
      baselineFile: 'content/c/primer6-teaching/chA-2.0.0.json',
    };
    const appendix = { ...chunk, language: 'c', group: 'chA' };
    for (const id of ['c6.appA', 'c6.sA.4', 'c6.sB.10.3']) {
      expect(
        parseBookTeaching({ ...appendix, nodes: [{ ...chunk.nodes[0], id }] }, appendixEntry, ref),
      ).toBeTruthy();
    }
    for (const id of ['cpp.Book.1', 'c6.sC.1', 'c6.sA.', 'c6.appA/1']) {
      expect(() =>
        parseBookTeaching({ ...appendix, nodes: [{ ...chunk.nodes[0], id }] }, appendixEntry, ref),
      ).toThrow();
    }
  });
  it.each(['../secret.json', 'https://outside.invalid/x.json', 'cpp-unit-01-1.0.0.json?q=1'])(
    'rejects unsafe resource paths: %s',
    (file) => {
      expect(() => validateBookTeachingEntry({ ...entry, file })).toThrow();
    },
  );
  it('returns a defensive body after exact bytes, SHA and original text have been checked', async () => {
    vi.stubGlobal('location', new URL('https://course.example/'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(resource());
    const read = createBookTeachingReader({ editorialRef: ref, chunks: [entry] }, fetcher);
    const result = await read(
      'cpp',
      'unit-01',
      'cpp.book.1-1',
      '起步',
      original,
      controller().signal,
    );
    expect(result).toEqual(body);
    result[0] = '外部改动';
    expect(
      await read('cpp', 'unit-01', 'cpp.book.1-1', '起步', original, controller().signal),
    ).toEqual(body);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://course.example/content/teaching/cpp-unit-01-1.0.0.json');
    expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' });
    await expect(
      read('cpp', 'unit-01', 'cpp.book.1-1', '起步', ['不同版本正文'], controller().signal),
    ).rejects.toThrow('E_BOOK_TEACHING_BINDING');
    await expect(
      read('cpp', 'unit-01', 'cpp.book.1-1', '另一个标题', original, controller().signal),
    ).rejects.toThrow('E_BOOK_TEACHING_BINDING');
  });
  it('rejects corrupt and truncated content, then permits a fresh retry instead of falling back', async () => {
    vi.stubGlobal('location', new URL('https://course.example/'));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(resource(encoded.slice(1)))
      .mockResolvedValueOnce(resource(encoded.replace('详细', '篡改')))
      .mockResolvedValueOnce(resource());
    const read = createBookTeachingReader({ editorialRef: ref, chunks: [entry] }, fetcher);
    for (let i = 0; i < 2; i++)
      await expect(
        read('cpp', 'unit-01', 'cpp.book.1-1', '起步', original, controller().signal),
      ).rejects.toThrow();
    expect(
      await read('cpp', 'unit-01', 'cpp.book.1-1', '起步', original, controller().signal),
    ).toEqual(body);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('cancels before reading and preserves lessons outside the published revision', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const read = createBookTeachingReader({ editorialRef: ref, chunks: [] }, fetcher);
    expect(
      await read('cpp', 'unit-02', 'cpp.book.2-1', '下一节', original, controller().signal),
    ).toEqual(original);
    const abort = controller();
    abort.abort();
    await expect(
      read('cpp', 'unit-02', 'cpp.book.2-1', '下一节', original, abort.signal),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
