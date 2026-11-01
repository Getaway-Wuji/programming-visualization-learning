import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentPackage } from '../../web/src/content/types';
import type { CourseReading } from '../../web/src/content/reading';
import type { CoursePractice } from '../../web/src/content/practice';
import type { LearningCatalog } from '../../web/src/learning/types';
import { createMeta, emptySnapshot, type ContentReceipt } from '../../web/src/storage/model';
import {
  collectNoteEntries,
  createNotesPackage,
  filterNoteEntries,
  noteChapters,
} from '../../web/src/study-notes/model';
import { SnapshotTray } from '../../web/src/study-notes/session';
import { type NoteFilter } from '../../web/src/study-notes/types';
import { SnapshotExporter } from '../../web/src/snapshot-export/controller';
import type {
  CaptureContext,
  SnapshotDocument,
  SnapshotPort,
} from '../../web/src/snapshot-export/types';
import { initSync, execute_memory } from '../../web/src/generated/memory/c_viz_memory';
import { engineBuild } from '../../web/src/generated/memory/engine-build';
import { memoryRequest } from '../../web/src/engine/memory-client';
import { decodeMemoryResult, encodeMemoryRequest } from '../../web/src/engine/memory-protocol';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { memoryExamples } from '../../web/src/memory/examples';

const c = JSON.parse(readFileSync('content/c/p05/course-1.0.0.json', 'utf8')) as ContentPackage;
const ref = (e: { id: string; version: string }) => ({ id: e.id, version: e.version });
const base = (
  e:
    | ContentPackage['lessons'][number]
    | ContentPackage['exercises'][number]
    | ContentPackage['cases'][number],
) => ({
  ref: ref(e),
  learningRevision: e.learningRevision,
  acceptedPriorVersions: e.acceptedPriorVersions,
});
const packageRef = { id: c.packageId, version: c.packageVersion };
const catalog: LearningCatalog = {
  purpose: 'course-practice',
  packageRef,
  lessons: c.lessons.map((e) => ({ ...base(e), requiredExerciseRefs: e.requiredExerciseRefs })),
  exercises: c.exercises.map((e) => ({
    ...base(e),
    lessonRef: e.lessonRef,
    caseKeys: e.tests.map((t) => t.caseKey),
  })),
  cases: c.cases.map(base),
};
const reading: CourseReading = {
  readingVersion: '1.0.0',
  sourceSha256: createHash('sha256')
    .update(readFileSync('content/c/p05/course-1.0.0.json'))
    .digest('hex'),
  packageRef,
  chapters: c.chapters,
  lessons: c.lessons,
  programs: c.programs,
  knowledgePoints: c.knowledgePoints,
  exercises: c.exercises,
  cases: c.cases,
  catalog,
};
const practice: CoursePractice = {
  practiceVersion: '1.0.0',
  sourceSha256: reading.sourceSha256,
  packageRef,
  exercises: c.exercises,
  programs: c.programs,
  inputSpecs: c.inputSpecs,
  judgeProfiles: c.judgeProfiles,
};
const at = '2026-11-01T00:30:00.000Z';
const fresh = () =>
  emptySnapshot(
    createMeta({
      generation: crypto.randomUUID(),
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: packageRef,
    }),
  );
const receipt = (day = '2026-11-01', kind = 'wrong-answer'): ContentReceipt =>
  ({
    eventId: crypto.randomUUID(),
    goalVersion: 1,
    occurredAt: `${day}T00:30:00.000Z`,
    localDate: day,
    committedRevision: 1,
    eventType: kind === 'pass' ? 'exercise.passed' : 'exercise.attempt-evaluated',
    result: kind === 'pass' ? 'passed' : 'failed',
    packageRef,
    subjectRef: ref(c.exercises[0]),
    learningRevision: 1,
    ...(kind === 'pass'
      ? {}
      : { resultCategory: kind, failedCaseKey: c.exercises[0].tests[0].caseKey }),
  }) as ContentReceipt;
const filter: NoteFilter = {
  chapterId: '',
  from: '',
  to: '',
  types: ['learning', 'mistake', 'analysis', 'snapshot'],
};
const collect = (s = fresh(), docs: SnapshotDocument[] = []) =>
  collectNoteEntries(s, reading, practice, catalog, docs);
describe('20.1 selection and content provenance', () => {
  it('starts empty and never includes settings, rewards, avatar, or unrelated records', () => {
    expect(collect()).toEqual([]);
    const s = fresh();
    s.receipts.push(receipt());
    const before = JSON.stringify(s),
      entries = collect(s);
    expect(filterNoteEntries(entries, { ...filter, types: [] })).toEqual([]);
    expect(() => createNotesPackage(entries, [], filter, 'lease', s.meta.timeZone, at)).toThrow(
      '勾选',
    );
    const p = createNotesPackage(entries, [entries[0].id], filter, 'lease', s.meta.timeZone, at);
    expect(p.entries).toHaveLength(1);
    expect(Object.keys(p)).toEqual([
      'formatId',
      'formatVersion',
      'createdAt',
      'lease',
      'timeZone',
      'filter',
      'entries',
    ]);
    expect(JSON.stringify(p)).not.toContain('avatar.basic');
    expect(JSON.stringify(s)).toBe(before);
  });
  it('intersects chapter, date, type and explicit IDs; rejects stale/duplicate IDs', () => {
    const s = fresh();
    s.receipts.push(receipt('2026-10-31'), receipt(), receipt('2026-11-02', 'pass'));
    const entries = collect(s),
      f = {
        ...filter,
        chapterId: c.lessons[0].chapterRef.id,
        from: '2026-11-01',
        to: '2026-11-01',
        types: ['mistake'] as NoteFilter['types'],
      };
    const eligible = filterNoteEntries(entries, f);
    expect(eligible).toHaveLength(1);
    expect(
      createNotesPackage(entries, [eligible[0].id], f, 'l', 'Asia/Shanghai', at).entries,
    ).toEqual(eligible);
    expect(filterNoteEntries(entries, { ...f, chapterId: c.chapters[1].id })).toEqual([]);
    expect(() => createNotesPackage(entries, [entries[0].id], f, 'l', 'Asia/Shanghai', at)).toThrow(
      '失效',
    );
    expect(() =>
      createNotesPackage(entries, [eligible[0].id, eligible[0].id], f, 'l', 'Asia/Shanghai', at),
    ).toThrow('失效');
  });
  it.each(['cancelled', 'resource-limit', 'infrastructure-failure'])(
    'does not collect %s as a wrong answer',
    (kind) => {
      const s = fresh();
      s.receipts.push(receipt('2026-11-01', kind));
      expect(collect(s)).toEqual([]);
    },
  );
  it.each([
    { from: '2026-11-02', to: '2026-11-01' },
    { from: '2026-02-30', to: '' },
    { from: 'invalid', to: '' },
  ])('rejects invalid date ranges %j', (dates) =>
    expect(() => filterNoteEntries([], { ...filter, ...dates })).toThrow(),
  );
  it('preserves unknown package/version/revision summaries without current code, language, or source links', () => {
    for (const change of ['package', 'version', 'revision']) {
      const s = fresh(),
        r = receipt();
      if (change === 'package') r.packageRef = { id: 'foreign', version: '1.0.0' };
      else if (change === 'version') r.subjectRef.version = '9.0.0';
      else r.learningRevision = 9;
      s.receipts.push(r);
      const e = collect(s);
      expect(e).toHaveLength(1);
      expect(e[0]).toMatchObject({
        currentRef: null,
        language: null,
        href: null,
        reference: null,
        chapterIds: [],
      });
      expect(e[0].origin).toEqual({
        packageRef: r.packageRef,
        subjectRef: r.subjectRef,
        learningRevision: r.learningRevision,
      });
    }
  });
  it('keeps reviewed old C identity and marks current reference code as teaching rather than a historical answer', () => {
    const s = fresh(),
      r = receipt();
    r.packageRef = { id: 'content.c.p0', version: '1.0.1' };
    r.subjectRef = { id: 'exercise.c.echo', version: '1.0.1' };
    r.subjectRef.version = '1.0.1';
    s.receipts.push(r);
    const rows = collect(s);
    expect(rows[0].origin.packageRef).toEqual(r.packageRef);
    expect(rows.every((e) => e.language === 'c')).toBe(true);
    const a = rows.find((e) => e.kind === 'analysis')!;
    expect(a.reference?.contentSha256).toBe(reading.sourceSha256);
    expect(a.reference?.source).toBe(
      c.programs.find(
        (p) => p.id === c.exercises.find((e) => e.id === 'exercise.c.echo')!.programRef.id,
      )!.sourceExample,
    );
    expect(a.warnings.join('')).toContain('不是历史作答');
  });
  it('supports missing exercise resources and legacy aggregate summaries, with no duplicate progress fallback', () => {
    const s = fresh(),
      r = receipt();
    s.receipts.push(r);
    s.progress.push({
      ...r,
      firstAt: r.occurredAt,
      lastAt: r.occurredAt,
    } as (typeof s.progress)[number]);
    expect(collect(s).filter((e) => e.kind === 'mistake')).toHaveLength(1);
    s.receipts = [];
    const entries = collectNoteEntries(s, reading, null, catalog, []);
    expect(entries.find((e) => e.kind === 'mistake')!.timeMeaning).toBe('legacy-summary');
    expect(entries[0].date).toBe('2026-11-01');
    expect(entries[0].warnings.join('')).toContain('旧聚合摘要');
    expect(entries.find((e) => e.kind === 'analysis')?.reference?.source).toBeTruthy();
  });
  it('includes advanced chapter membership for the original lesson without minting new learning records', () => {
    const s = fresh(),
      lesson = c.lessons.find((l) => l.id === 'lesson.c.logical-length-guards')!;
    s.progress.push({
      eventType: 'lesson.study-confirmed',
      result: 'confirmed',
      packageRef,
      subjectRef: ref(lesson),
      learningRevision: 1,
      firstAt: at,
      lastAt: at,
    });
    const entries = collect(s);
    expect(noteChapters(reading)).toHaveLength(10);
    expect(
      filterNoteEntries(entries, { ...filter, chapterId: 'chapter.advanced.bounds-order' }),
    ).toHaveLength(2);
  });
  it('refuses excessive entry and byte budgets without truncation', () => {
    const s = fresh();
    s.receipts.push(receipt());
    const seed = collect(s)[0];
    const many = Array.from({ length: 201 }, (_, i) => ({ ...seed, id: `id${i}` }));
    expect(() =>
      createNotesPackage(
        many,
        many.map((e) => e.id),
        filter,
        'l',
        'Asia/Shanghai',
        at,
      ),
    ).toThrow('200');
    const huge = { ...seed, text: 'x'.repeat(13 * 1024 * 1024) };
    expect(() => createNotesPackage([huge], [huge.id], filter, 'l', 'Asia/Shanghai', at)).toThrow(
      '12MiB',
    );
  });
});
describe('20.1 real C++ snapshot delivery', () => {
  beforeAll(() =>
    initSync({ module: readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm') }),
  );
  async function live() {
    const example = memoryExamples.find((e) => e.id === 'nodes')!,
      request = memoryRequest(example.source, 'cpp', []);
    const bytes = execute_memory(
      encodeMemoryRequest(request),
      engineBuild.wasmSha256,
      1000,
    ).slice();
    const result = await decodeMemoryResult(bytes.buffer, request, engineBuild.wasmSha256);
    const player = new MemoryPlayer();
    player.accept(result);
    player.seek(4);
    const context = (): CaptureContext => ({
      kind: 'memory-observation',
      mode: 'memory',
      observationId: example.id,
      title: example.title,
      request,
      result,
      view: player.snapshot(),
      highlightedRange: player.snapshot().byteRange,
      highlightReason: 'executed-step',
    });
    const port: SnapshotPort = {
      read: context,
      pause: () => player.pause(),
      subscribe: () => () => {},
    };
    return { port, player, request, result };
  }
  it('delivers the same cursor/state/source/language to a deep-frozen tray, without a download', async () => {
    const { port, player, request, result } = await live(),
      download = vi.fn(),
      tray = new SnapshotTray(),
      exporter = new SnapshotExporter(port, { download });
    await exporter.export('json', tray.add);
    expect(exporter.getSnapshot().phase).toBe('collected');
    expect(download).not.toHaveBeenCalled();
    const d = tray.getSnapshot()[0];
    expect(d.currentState).toEqual(player.snapshot().state);
    expect(d.source.text).toBe(request.source);
    expect(d.runtime.identity).toEqual(result.identity);
    expect(d.runtime.language).toBe('cpp');
    expect(d.position.cursor).toBe(4);
    expect(Object.isFrozen(d.currentState)).toBe(true);
    player.seek(0);
    expect(d.position.cursor).toBe(4);
    expect(d.currentState).not.toEqual(player.snapshot().state);
    const entries = collect(fresh(), [d]);
    expect(entries[0].language).toBe('cpp');
    expect(entries[0].snapshot).toEqual(d);
    const pack = createNotesPackage(entries, [entries[0].id], filter, 'l', 'Asia/Shanghai', at);
    tray.clear();
    expect(pack.entries[0].snapshot).toEqual(d);
    expect(tray.getSnapshot()).toEqual([]);
  });
  it('cancels delayed capture after an observed cursor ABA and allows retry', async () => {
    const { port, player } = await live(),
      tray = new SnapshotTray();
    let finish!: (s: string) => void;
    const hash = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });
    const exporter = new SnapshotExporter(port, { hash });
    const pending = exporter.export('json', tray.add);
    player.seek(0);
    exporter.observe();
    player.seek(4);
    exporter.observe();
    finish('a'.repeat(64));
    await pending;
    expect(tray.getSnapshot()).toEqual([]);
    expect(exporter.getSnapshot().phase).toBe('cancelled');
    const retry = new SnapshotExporter(port);
    await retry.export('json', tray.add);
    expect(tray.getSnapshot()).toHaveLength(1);
  });
  it('refuses full trays without losing previous snapshots', async () => {
    const { port } = await live(),
      tray = new SnapshotTray();
    for (let i = 0; i < 9; i++) {
      const exporter = new SnapshotExporter(port);
      await exporter.export('json', tray.add);
      if (i === 8)
        expect(exporter.getSnapshot()).toMatchObject({
          phase: 'failed',
          message: expect.stringContaining('8份'),
        });
    }
    expect(tray.getSnapshot()).toHaveLength(8);
    const first = tray.getSnapshot()[0];
    tray.remove(first.snapshotId);
    expect(tray.getSnapshot()).toHaveLength(7);
  });
});
