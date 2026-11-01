import type { CourseReading } from '../content/reading';
import type { CoursePractice } from '../content/practice';
import type { LearningCatalog } from '../learning/types';
import type { ContentReceipt, Progress, StorageSnapshot } from '../storage/model';
import { reviewedDurableSnapshot } from '../learning/reviewed-release';
import { isCompatibleLearningHistory } from '../learning/domain';
import { sameRef } from '../learning/catalog';
import { localDateAt } from '../storage/validation';
import { bugQuestions, bugRegistryRef } from '../bugs/content';
import { memoryBugQuestions, memoryBugRegistry } from '../memory-bugs/content';
import { advancedCourse } from '../advanced-course/model';
import type { SnapshotDocument } from '../snapshot-export/types';
import { NOTE_LIMITS, type NoteEntry, type NoteFilter, type NotesPackage } from './types';
import { p05CourseRelease } from '../content/p05-course-release.generated';

const labels = {
  'lesson.started': '开始学习',
  'lesson.study-confirmed': '确认学习',
  'lesson.completed': '小节完成',
  'exercise.passed': '练习通过',
  'exercise.attempt-evaluated': '练习结果',
  'case.view-confirmed': '确认观看',
} as const;
const failures: Record<string, string> = {
  'wrong-answer': '答案不符',
  'teaching-goal-unmet': '教学目标未满足',
  'program-error': '程序错误',
};
export function noteChapters(reading: CourseReading) {
  return [
    ...reading.chapters.map((c) => ({ id: c.id, title: c.title, lessons: c.lessonRefs })),
    ...advancedCourse.chapters.map((c) => ({
      id: c.id,
      title: `进阶 · ${c.title}`,
      lessons: c.lessonRefs,
    })),
  ];
}
function chaptersFor(reading: CourseReading, lessonIds: string[]) {
  return noteChapters(reading)
    .filter((c) => c.lessons.some((l) => lessonIds.includes(l.id)))
    .map((c) => c.id);
}
export function collectNoteEntries(
  snapshot: StorageSnapshot,
  reading: CourseReading,
  practice: CoursePractice | null,
  catalog: LearningCatalog,
  captures: readonly SnapshotDocument[],
): NoteEntry[] {
  const rows: { id: string; row: Progress; date: string; at: string; legacy: boolean }[] = [];
  const receipts = snapshot.receipts.filter((r): r is ContentReceipt =>
    Object.hasOwn(labels, r.eventType),
  );
  const signature = (r: Progress | ContentReceipt) =>
    JSON.stringify([
      r.packageRef,
      r.subjectRef,
      r.learningRevision,
      r.eventType,
      r.result,
      r.eventType === 'exercise.attempt-evaluated' ? [r.resultCategory, r.failedCaseKey] : null,
    ]);
  const seen = new Set(receipts.map(signature));
  for (const r of receipts)
    rows.push({
      id: `receipt:${r.eventId}`,
      row: { ...r, firstAt: r.occurredAt, lastAt: r.occurredAt } as Progress,
      date: r.localDate,
      at: r.occurredAt,
      legacy: false,
    });
  for (const r of snapshot.progress)
    if (!seen.has(signature(r)))
      rows.push({
        id: `legacy:${signature(r)}`,
        row: r,
        date: localDateAt(r.lastAt, snapshot.meta.timeZone),
        at: r.lastAt,
        legacy: true,
      });
  const approved = new Set(
    reviewedDurableSnapshot({ ...snapshot, progress: rows.map((r) => r.row) }, catalog).progress,
  );
  const output: NoteEntry[] = [];
  for (const value of rows) {
    const { row, id } = value;
    const kind = row.eventType.startsWith('lesson.')
      ? 'lesson'
      : row.eventType.startsWith('case.')
        ? 'case'
        : 'exercise';
    const entity = approved.has(row)
      ? catalog[kind === 'lesson' ? 'lessons' : kind === 'case' ? 'cases' : 'exercises'].find((e) =>
          isCompatibleLearningHistory(row, e, kind, snapshot.aliases),
        )
      : null;
    const subject = entity
      ? (kind === 'lesson'
          ? reading.lessons
          : kind === 'case'
            ? reading.cases
            : reading.exercises
        ).find((e) => sameRef(e, entity.ref))
      : null;
    const memory = entity
      ? memoryBugQuestions.find((q) => sameRef(q.exerciseRef, entity.ref))
      : null;
    const bug = entity ? bugQuestions.find((q) => sameRef(q.exerciseRef, entity.ref)) : null;
    const exercise =
      entity && practice && sameRef(practice.packageRef, reading.packageRef)
        ? practice.exercises.find((e) => sameRef(e, entity.ref))
        : null;
    const lessonRef =
      memory?.lessonRef ??
      exercise?.lessonRef ??
      reading.exercises.find((e) => entity && sameRef(e, entity.ref))?.lessonRef ??
      (bug ? catalog.exercises.find((e) => sameRef(e.ref, bug.baseExerciseRef))?.lessonRef : null);
    const lesson =
      kind === 'lesson' && subject
        ? reading.lessons.find((l) => sameRef(l, subject))
        : reading.lessons.find((l) => sameRef(l, lessonRef ?? { id: '', version: '' }));
    const matched = !!entity && !!(subject || memory || bug);
    const language = matched ? (memory ? 'cpp' : 'c') : null;
    const failed =
      row.eventType === 'exercise.attempt-evaluated' ? failures[row.resultCategory] : null;
    if (row.eventType === 'exercise.attempt-evaluated' && !failed) continue;
    const warnings: string[] = [];
    if (!matched)
      warnings.push('旧内容或版本关联不能确认，保留原摘要；没有挂接当前解析、语言或课程入口。');
    if (value.legacy) warnings.push('旧聚合摘要：按最近记录日期筛选，不能还原逐次学习时间。');
    if (kind === 'exercise') warnings.push('本地记录未保存当时的作答源码、输入和完整运行轨迹。');
    const item: NoteEntry = {
      id,
      kind: failed ? 'mistake' : 'learning',
      title: subject?.title ?? memory?.title ?? bug?.title ?? row.subjectRef.id,
      date: value.date,
      occurredAt: value.at,
      timeMeaning: value.legacy ? 'legacy-summary' : 'event',
      chapterIds: matched
        ? chaptersFor(
            reading,
            lesson
              ? [lesson.id]
              : kind === 'case'
                ? reading.lessons
                    .filter((l) => l.caseRefs.some((r) => sameRef(r, entity!.ref)))
                    .map((l) => l.id)
                : [],
          )
        : [],
      language,
      origin: {
        packageRef: { ...row.packageRef },
        subjectRef: { ...row.subjectRef },
        learningRevision: row.learningRevision,
      },
      currentRef: matched ? { ...entity!.ref } : null,
      href: !matched
        ? null
        : kind === 'lesson'
          ? `/lessons/${entity!.ref.id}`
          : kind === 'case'
            ? `/visualize/${entity!.ref.id}`
            : memory
              ? `/bugs/memory/${entity!.ref.id}`
              : bug
                ? '/bugs'
                : `/practice/${entity!.ref.id}`,
      text: `${labels[row.eventType]}：${failed ?? row.result}${row.eventType === 'exercise.attempt-evaluated' && row.failedCaseKey ? ` · 测试 ${row.failedCaseKey}` : ''}`,
      warnings,
      reference: null,
      snapshot: null,
    };
    output.push(item);
    if (matched && lesson) {
      const program = reading.programs.find((p) =>
        sameRef(
          p,
          exercise?.programRef ?? lesson.teaching.exampleProgramRefs[0] ?? { id: '', version: '' },
        ),
      );
      const explanation = memory?.explanation ?? bug?.explanation ?? lesson.teaching.explanation;
      output.push({
        ...item,
        id: `analysis:${id}`,
        kind: 'analysis',
        title: `解析 · ${item.title}`,
        timeMeaning: 'related-record',
        text: `${explanation}\n${memory?.prompt ?? bug?.prompt ?? exercise?.prompt ?? ''}`,
        warnings: [
          ...warnings,
          '当前教材解析，按关联记录日期筛选；示例源码不是历史作答，也不是本次执行快照。',
        ],
        reference: {
          packageRef: { ...reading.packageRef },
          contentSha256: memory
            ? p05CourseRelease.memoryBugSupplement.sourceSha256
            : bug
              ? p05CourseRelease.bugSupplement.sourceSha256
              : reading.sourceSha256,
          registryRef: memory ? memoryBugRegistry.registryRef : bug ? bugRegistryRef : null,
          subjectRef: {
            id: memory?.exerciseRef.id ?? bug?.exerciseRef.id ?? lesson.id,
            version: memory?.exerciseRef.version ?? bug?.exerciseRef.version ?? lesson.version,
          },
          document: memory
            ? 'content/cpp/bugs/questions-1.0.0.json'
            : bug
              ? 'content/c/bugs/questions-1.0.0.json'
              : lesson.teaching.source.document,
          locator: memory?.exerciseRef.id ?? bug?.exerciseRef.id ?? lesson.teaching.source.locator,
          programRef:
            memory?.programRef ?? (program ? { id: program.id, version: program.version } : null),
          source: memory?.solutionSource ?? (bug ? null : (program?.sourceExample ?? null)),
        },
      });
    }
  }
  for (const doc of captures) {
    const known =
      doc.origin.kind === 'case' &&
      doc.origin.packageRef &&
      sameRef(doc.origin.packageRef, reading.packageRef) &&
      reading.cases.find((c) => doc.origin.caseRef && sameRef(c, doc.origin.caseRef));
    const language =
      doc.runtime.domain === 'p1-memory'
        ? doc.runtime.language
        : doc.runtime.language?.id === 'lang.c'
          ? 'c'
          : null;
    output.push({
      id: `snapshot:${doc.snapshotId}`,
      kind: 'snapshot',
      title: doc.origin.title,
      date: localDateAt(doc.capturedAt, snapshot.meta.timeZone),
      occurredAt: doc.capturedAt,
      timeMeaning: 'capture',
      chapterIds: known
        ? chaptersFor(
            reading,
            reading.lessons
              .filter((l) => l.caseRefs.some((c) => sameRef(c, known)))
              .map((l) => l.id),
          )
        : [],
      language: language === 'c' || language === 'cpp' ? language : null,
      origin: {
        packageRef: doc.origin.packageRef,
        subjectRef: doc.origin.caseRef,
        learningRevision: null,
      },
      currentRef: known ? { id: known.id, version: known.version } : null,
      href: known ? `/visualize/${known.id}` : null,
      text: `捕获时刻 · 步骤 ${doc.position.cursor}/${doc.position.length} · ${doc.position.executed.description}`,
      warnings: [
        '捕获时刻的独立副本，后续运行不会更新此快照；教学虚拟地址不是宿主真实地址。',
        ...(!known ? ['没有可确认的当前课程章节，归入未关联内容。'] : []),
      ],
      reference: null,
      snapshot: doc,
    });
  }
  return output.sort(
    (a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
  );
}
export function filterNoteEntries(entries: readonly NoteEntry[], filter: NoteFilter) {
  const validDate = (s: string) =>
    !s ||
    (/^\d{4}-\d\d-\d\d$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s);
  if (
    !validDate(filter.from) ||
    !validDate(filter.to) ||
    (filter.from && filter.to && filter.from > filter.to)
  )
    throw Error('日期范围无效，请检查起止日期。');
  return entries.filter(
    (e) =>
      filter.types.includes(e.kind) &&
      (!filter.chapterId || filter.chapterId === 'unlinked'
        ? !filter.chapterId || e.chapterIds.length === 0
        : e.chapterIds.includes(filter.chapterId)) &&
      (!filter.from || e.date >= filter.from) &&
      (!filter.to || e.date <= filter.to),
  );
}
export function createNotesPackage(
  entries: readonly NoteEntry[],
  ids: readonly string[],
  filter: NoteFilter,
  lease: string,
  timeZone: string,
  now: string,
): NotesPackage {
  const eligible = filterNoteEntries(entries, filter),
    selected = new Set(ids);
  if (!ids.length) throw Error('请先勾选要整理的内容。');
  if (selected.size !== ids.length || ids.some((id) => !eligible.some((e) => e.id === id)))
    throw Error('选择已失效，请重新选择。');
  if (ids.length > NOTE_LIMITS.entries) throw Error('每次最多200条，请缩小选择范围。');
  const pack: NotesPackage = structuredClone({
    formatId: 'urn:c-viz:study-notes:1.0.0',
    formatVersion: '1.0.0',
    createdAt: now,
    lease,
    timeZone,
    filter,
    entries: eligible.filter((e) => selected.has(e.id)),
  });
  if (new TextEncoder().encode(JSON.stringify(pack)).length > NOTE_LIMITS.packageBytes)
    throw Error('笔记超过12MiB，请减少快照或记录；未截断内容。');
  return pack;
}
