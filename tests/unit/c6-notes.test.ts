import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { LearningService } from '../../web/src/learning/service';
import { createC6ResetMeta } from '../../web/src/storage/c6-reset';
import { emptySnapshot } from '../../web/src/storage/model';
import { validateC6LearningIndex } from '../../web/src/c6-learning';
import { parseC6TeachingManifest } from '../../web/src/content/c6-teaching-validator.mjs';
import { c6TeachingRelease } from '../../web/src/content/c6-teaching-release.generated';
import {
  collectC6NoteEntries,
  createC6NotesPackage,
  filterC6Notes,
} from '../../web/src/c6-learning/notes';
import type { C6SnapshotDocument } from '../../web/src/c6-learning/snapshot';
import type { SnapshotDocument } from '../../web/src/snapshot-export/types';
import { C6SnapshotTray, SnapshotTray } from '../../web/src/study-notes/session';
import { C6NotesDownloader } from '../../web/src/c6-learning/notes-download';
import Ajv2020 from 'ajv/dist/2020.js';
import { isLocalDate, isUtcTime, isUuid } from '../../web/src/storage/validation';

const load = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const captured = load('tests/fixtures/c6-learning/snapshot-2.0.0.json') as C6SnapshotDocument;
const cpp = load('tests/fixtures/snapshot/cpp.json') as SnapshotDocument;
const manifest = await parseC6TeachingManifest(
  Uint8Array.from(readFileSync('content/c/primer6-teaching/manifest-2.0.0.json')),
  c6TeachingRelease.manifestSha256,
);
const index = validateC6LearningIndex(
  load('content/c/primer6-learning/index-1.0.0.json'),
  manifest,
);
function state() {
  const service = new LearningService({
    catalog: {
      purpose: 'contract-fixture',
      packageRef: { id: 'content.c.p0', version: '1.0.0' },
      lessons: [],
      exercises: [],
      cases: [],
    },
  });
  return {
    ...service.getState(),
    status: 'ready' as const,
    snapshot: emptySnapshot(
      createC6ResetMeta(crypto.randomUUID(), 'Asia/Shanghai', '2026-11-03T00:00:00.000Z'),
    ),
    c6: {
      status: 'ready' as const,
      index,
      manifest,
      rows: { activities: [], drafts: [] },
      error: null,
    },
  };
}
const filter = { chapterId: '', from: '', to: '', types: ['snapshot' as const] };
function pack() {
  const entries = collectC6NoteEntries(state(), [], [], [captured]);
  return createC6NotesPackage(
    entries,
    entries.map((e) => e.id),
    filter,
    'Asia/Shanghai',
  );
}
it('Notes2 and download2 validate both actual C6 and current C++ snapshots in separate typed branches', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  ajv.addFormat('uuid', isUuid);
  ajv.addFormat('date-time', isUtcTime);
  ajv.addFormat('date', isLocalDate);
  ajv.addSchema(load('shared/contracts/21.5-C6当前快照2.0.0.schema.json'));
  const validate = ajv.compile(load('shared/contracts/21.5-笔记选择2.0.0.schema.json'));
  const download = ajv.compile(load('shared/contracts/21.5-笔记下载2.0.0.schema.json'));
  const entries = collectC6NoteEntries(state(), [], [], [captured, cpp]);
  const mixed = createC6NotesPackage(
    entries,
    entries.map((e) => e.id),
    filter,
    'Asia/Shanghai',
  );
  expect(validate(mixed), JSON.stringify(validate.errors)).toBe(true);
  expect(validate({ ...mixed, formatVersion: '1.0.0' })).toBe(false);
  const createdAt = mixed.createdAt;
  const metadata = {
    formatVersion: mixed.formatVersion,
    timeZone: mixed.timeZone,
    filter: mixed.filter,
    entries: mixed.entries,
    formatId: 'urn:c-viz:study-notes-download:2.0.0',
    title: '学习笔记',
    exportedAt: createdAt,
    previewedAt: createdAt,
    assets: [],
  };
  expect(download(metadata), JSON.stringify(download.errors)).toBe(true);
  expect(download({ ...metadata, lease: crypto.randomUUID() })).toBe(false);
  const bad = structuredClone(mixed);
  bad.entries[0].snapshot!.formatVersion = '3.0.0' as '2.0.0';
  expect(validate(bad)).toBe(false);
});
it('keeps actual C6 and C++ observation formats/languages separate in the new note package', () => {
  const entries = collectC6NoteEntries(state(), [], [], [captured, cpp]);
  expect(entries).toHaveLength(2);
  expect(entries.find((e) => e.snapshot?.formatVersion === '2.0.0')).toMatchObject({
    language: 'c',
    reference: { nodeRef: { id: 'node.c6.s2.1', version: '2.0.0' } },
  });
  expect(entries.find((e) => e.snapshot?.formatVersion === '1.0.0')?.language).toBe('cpp');
  const selected = createC6NotesPackage(entries, [entries[0].id], filter, 'Asia/Shanghai');
  expect(selected.formatVersion).toBe('2.0.0');
  expect(selected.entries).toHaveLength(1);
  expect(() =>
    createC6NotesPackage(entries, [entries[0].id, entries[0].id], filter, 'Asia/Shanghai'),
  ).toThrow();
  expect(filterC6Notes(entries, { ...filter, types: [] })).toEqual([]);
  expect(() =>
    filterC6Notes(entries, { ...filter, from: '2026-12-01', to: '2026-01-01' }),
  ).toThrow();
});
it('both snapshot trays share the same eight-item quota and clear their current observations', () => {
  const legacy: SnapshotTray = new SnapshotTray(() => ({
    count: current.getSnapshot().length,
    bytes: 0,
  }));
  const current: C6SnapshotTray = new C6SnapshotTray(legacy.getSnapshot);
  for (let i = 0; i < 4; ++i) {
    legacy.add({ ...cpp, snapshotId: crypto.randomUUID() });
    current.add({ ...captured, snapshotId: crypto.randomUUID() });
  }
  expect(() => current.add({ ...captured, snapshotId: crypto.randomUUID() })).toThrow();
  expect(() => legacy.add({ ...cpp, snapshotId: crypto.randomUUID() })).toThrow();
  current.clear();
  expect(current.getSnapshot()).toHaveLength(0);
  expect(legacy.getSnapshot()).toHaveLength(4);
});
it('a changed selection during asynchronous image work cannot produce a download', async () => {
  let finish!: (blob: Blob) => void;
  const waiting = new Promise<Blob>((resolve) => {
    finish = resolve;
  });
  const download = vi.fn(),
    render = vi.fn(() => waiting);
  const downloader = new C6NotesDownloader({ renderC6: render, download });
  let current = true;
  const task = downloader.start(
    pack(),
    '当前笔记',
    () => current,
    async (action) => action(),
  );
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  current = false;
  finish(new Blob(['lifecycle-only renderer stub']));
  await task;
  expect(download).not.toHaveBeenCalled();
  expect(downloader.getSnapshot().phase).toBe('cancelled');
});
it('explicit cancellation prevents a late renderer response from reviving export', async () => {
  let finish!: (blob: Blob) => void;
  const download = vi.fn(),
    render = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
  const downloader = new C6NotesDownloader({ renderC6: render, download });
  const task = downloader.start(
    pack(),
    '当前笔记',
    () => true,
    async (action) => action(),
  );
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  downloader.cancel();
  finish(new Blob(['lifecycle-only renderer stub']));
  await task;
  expect(download).not.toHaveBeenCalled();
  expect(downloader.getSnapshot().phase).toBe('cancelled');
});
it('a final saved-revision conflict prevents download even after all files are built', async () => {
  const download = vi.fn();
  const downloader = new C6NotesDownloader({
    download,
    renderC6: async () => new Blob(['lifecycle-only renderer stub']),
  });
  await downloader.start(
    pack(),
    '当前笔记',
    () => true,
    async () => {
      throw Error('S_REVISION_CONFLICT');
    },
  );
  expect(download).not.toHaveBeenCalled();
  expect(downloader.getSnapshot().phase).toBe('failed');
});
