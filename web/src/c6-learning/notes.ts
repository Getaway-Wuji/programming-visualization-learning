import type { Ref, StorageSnapshot } from '../storage/model';
import type { KnowledgeMark } from '../storage/knowledge-marks';
import type { SnapshotDocument } from '../snapshot-export/types';
import type { C6CourseDraft } from './model';
import type { C6SnapshotDocument } from './snapshot';
import { encodeC6Snapshot } from './snapshot';
import { c6IndependentReference, c6IndependentHref } from './independent';
import { encodeSnapshot } from '../snapshot-export/document';
import { NOTE_LIMITS, noteKinds, type NoteKind, type NoteFilter } from '../study-notes/types';
import { isLocalDate, isTimeZone, isUtcTime, isUuid, localDateAt } from '../storage/validation';
import type { LearningServiceState } from '../learning/service';
import { c6DisplayReference, c6ChapterForNode } from './display';
import { c6IndependentCases } from './cases';
import { challengeQuestions } from '../challenges/content';
import { isC6Mark } from './review';
import { mistakeLabels } from '../review-notebook/model';

export interface C6NoteEntry {
  id: string;
  kind: NoteKind;
  title: string;
  occurredAt: string;
  date: string;
  chapterIds: string[];
  language: 'c' | 'cpp' | null;
  origin: { packageRef: Ref | null; subjectRef: Ref | null; learningRevision: number | null };
  reference: {
    nodeRef: Ref;
    sourceSha256: string;
    document: 'C Primer Plus 第6版';
    physicalPage: number;
  } | null;
  href: string | null;
  text: string;
  source: { kind: 'saved-draft'; text: string; sourceRevision: string; input: string } | null;
  snapshot: SnapshotDocument | C6SnapshotDocument | null;
}
export interface C6NotesPackage {
  formatId: 'urn:c-viz:study-notes:2.0.0';
  formatVersion: '2.0.0';
  createdAt: string;
  lease: string;
  timeZone: string;
  filter: NoteFilter;
  entries: C6NoteEntry[];
}
const labels: Record<string, string> = {
  'lesson.started': '开始学习',
  'lesson.study-confirmed': '确认阅读',
  'lesson.completed': '小节完成',
  'exercise.passed': '执行练习通过',
  'exercise.attempt-evaluated': '真实判题结果',
  'case.view-confirmed': '确认观看案例',
};
export function collectC6NoteEntries(
  state: LearningServiceState,
  marks: readonly KnowledgeMark[],
  drafts: readonly C6CourseDraft[],
  snapshots: readonly (SnapshotDocument | C6SnapshotDocument)[],
): C6NoteEntry[] {
  const index = state.c6?.index,
    snapshot = state.snapshot;
  if (!index || !snapshot) return [];
  const entries: C6NoteEntry[] = [];
  const base = (
    id: string,
    kind: NoteKind,
    title: string,
    at: string,
    subjectRef: Ref | null,
    packageRef: Ref | null,
  ): C6NoteEntry => {
    const display = subjectRef ? c6DisplayReference(state, subjectRef) : null;
    const lesson = display?.lessonId ? index.lessons.find((l) => l[0] === display.lessonId) : null;
    return {
      id,
      kind,
      title,
      occurredAt: at,
      date: localDateAt(at, snapshot.meta.timeZone),
      chapterIds: lesson ? [lesson[2]] : [],
      language: 'c',
      origin: { packageRef, subjectRef, learningRevision: 1 },
      reference: display
        ? {
            nodeRef: { id: `node.${display.node.id}`, version: '2.0.0' },
            sourceSha256: index.sourceSha256,
            document: 'C Primer Plus 第6版',
            physicalPage: display.node.physicalPage,
          }
        : null,
      href: display?.lessonId
        ? `/lessons/${display.lessonId}`
        : display
          ? `/courses/${display.node.id}`
          : null,
      text: '',
      source: null,
      snapshot: null,
    };
  };
  for (const receipt of snapshot.receipts) {
    if (!('packageRef' in receipt) || !receipt.packageRef || !('learningRevision' in receipt))
      continue;
    const display = c6DisplayReference(state, receipt.subjectRef);
    // Independent case/challenge histories retain their own references and never become C6 passes.
    const independent = c6IndependentReference(receipt.subjectRef.id);
    if (
      !display &&
      !independent &&
      !['case.view-confirmed', 'challenge.answered'].includes(receipt.eventType)
    )
      continue;
    const mistake =
      receipt.eventType === 'exercise.attempt-evaluated' &&
      Object.hasOwn(mistakeLabels, receipt.resultCategory);
    if (receipt.eventType === 'exercise.attempt-evaluated' && !mistake) continue;
    const entry = base(
      `event:${receipt.eventId}`,
      mistake ? 'mistake' : 'learning',
      display?.title ??
        independent?.question.title ??
        c6IndependentCases()?.catalogs.find((c) => c.subject.id === receipt.subjectRef.id)?.subject
          .title ??
        challengeQuestions.find((q) => q.ref.id === receipt.subjectRef.id)?.title ??
        receipt.subjectRef.id,
      receipt.occurredAt,
      receipt.subjectRef,
      receipt.packageRef,
    );
    entry.origin.learningRevision = receipt.learningRevision;
    entry.language = independent
      ? independent.question.exerciseRef.id.startsWith('exercise.cpp.')
        ? 'cpp'
        : 'c'
      : display || ['case.view-confirmed', 'challenge.answered'].includes(receipt.eventType)
        ? 'c'
        : null;
    entry.text =
      mistake && receipt.eventType === 'exercise.attempt-evaluated'
        ? `${mistakeLabels[receipt.resultCategory as keyof typeof mistakeLabels]}${receipt.failedCaseKey ? ` · ${receipt.failedCaseKey}` : ''}。这是已保存的真实判题结果；记录不包含当时未保存的作答源码。`
        : `${labels[receipt.eventType] ?? '独立挑战作答'}：${receipt.result}。`;
    if (
      receipt.eventType === 'exercise.passed' ||
      receipt.eventType === 'exercise.attempt-evaluated'
    )
      entry.href = c6IndependentHref(receipt.subjectRef.id);
    else if (receipt.eventType === 'case.view-confirmed')
      entry.href = `/visualize/${receipt.subjectRef.id}`;
    entries.push(entry);
  }
  for (const mark of marks.filter((m) => isC6Mark(m, index))) {
    const display = c6DisplayReference(state, mark.knowledgeRef)!;
    const entry = base(
      `mark:${mark.commandId}`,
      'analysis',
      display.title,
      mark.lastAt,
      mark.knowledgeRef,
      mark.packageRef,
    );
    entry.text = mark.marked ? '手动自评：仍感到陌生，需要复习。' : '手动自评：已改为熟悉。';
    entries.push(entry);
  }
  for (const draft of drafts) {
    const lesson = index.lessons.find((l) => l[1] === draft.nodeRef.id);
    const node = state.c6!.manifest!.nodes.find((n) => `node.${n.id}` === draft.nodeRef.id)!;
    const entry = base(
      `draft:${draft.documentId}:${draft.revision}`,
      'analysis',
      `${node.titleDisplay} · 已保存草稿`,
      draft.updatedAt,
      lesson ? { id: lesson[0], version: '2.0.0' } : null,
      { ...index.packageRef },
    );
    entry.reference = {
      nodeRef: draft.nodeRef,
      sourceSha256: index.sourceSha256,
      document: 'C Primer Plus 第6版',
      physicalPage: node.physicalPage,
    };
    entry.text = '当前已保存的完整草稿，可能尚有语法错误；不冒充历史判题时的作答或已通过程序。';
    const chapterId = c6ChapterForNode(state, draft.nodeRef);
    entry.chapterIds = chapterId ? [chapterId] : [];
    entry.origin = {
      packageRef: { ...index.packageRef },
      subjectRef: { id: draft.documentId, version: '2.0.0' },
      learningRevision: null,
    };
    entry.source = {
      kind: 'saved-draft',
      text: draft.source,
      sourceRevision: draft.sourceRevision,
      input: draft.input,
    };
    entries.push(entry);
  }
  for (const captured of snapshots) {
    const c6 = captured.formatVersion === '2.0.0';
    const ref = c6 ? captured.origin.documentRef : captured.origin.caseRef;
    const entry = base(
      `snapshot:${captured.snapshotId}`,
      'snapshot',
      captured.origin.title,
      captured.capturedAt,
      ref,
      captured.origin.packageRef,
    );
    if (c6) {
      const lesson = index.lessons.find((l) => l[1] === captured.origin.nodeRef.id);
      const chapterId = c6ChapterForNode(state, captured.origin.nodeRef);
      entry.chapterIds = chapterId ? [chapterId] : [];
      const node = state.c6!.manifest!.nodes.find(
        (n) => `node.${n.id}` === captured.origin.nodeRef.id,
      )!;
      entry.reference = {
        nodeRef: captured.origin.nodeRef,
        sourceSha256: index.sourceSha256,
        document: 'C Primer Plus 第6版',
        physicalPage: node.physicalPage,
      };
      entry.href = captured.origin.exerciseRef
        ? `/practice/${captured.origin.exerciseRef.id}`
        : lesson
          ? `/lessons/${lesson[0]}`
          : `/courses/${node.id}`;
    } else {
      entry.language =
        captured.runtime.domain === 'p1-memory'
          ? captured.runtime.language
          : captured.runtime.language.id === 'lang.cpp'
            ? 'cpp'
            : 'c';
      entry.origin.learningRevision = null;
    }
    entry.text = `捕获当前步骤 ${captured.position.cursor} / ${captured.position.length}，保留完整源码、输入及当时的完整状态。`;
    entry.snapshot = captured;
    entries.push(entry);
  }
  return entries.sort(
    (a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
  );
}
export function filterC6Notes(entries: readonly C6NoteEntry[], filter: NoteFilter): C6NoteEntry[] {
  if (
    (filter.from && !isLocalDate(filter.from)) ||
    (filter.to && !isLocalDate(filter.to)) ||
    (filter.from && filter.to && filter.from > filter.to) ||
    new Set(filter.types).size !== filter.types.length ||
    filter.types.some((kind) => !Object.hasOwn(noteKinds, kind))
  )
    throw Error('NOTE_FILTER');
  return entries.filter(
    (e) =>
      filter.types.includes(e.kind) &&
      (!filter.from || e.date >= filter.from) &&
      (!filter.to || e.date <= filter.to) &&
      (!filter.chapterId ||
        (filter.chapterId === 'unlinked'
          ? !e.chapterIds.length
          : e.chapterIds.includes(filter.chapterId))),
  );
}
export function createC6NotesPackage(
  entries: readonly C6NoteEntry[],
  selected: readonly string[],
  filter: NoteFilter,
  timeZone: string,
): C6NotesPackage {
  if (
    !isTimeZone(timeZone) ||
    !selected.length ||
    selected.length > NOTE_LIMITS.entries ||
    new Set(selected).size !== selected.length
  )
    throw Error('NOTE_SELECTION');
  const allowed = filterC6Notes(entries, filter);
  const chosen = selected.map((id) => {
    const entry = allowed.find((e) => e.id === id);
    if (!entry) throw Error('NOTE_CHANGED');
    return entry;
  });
  const snapshots = chosen.flatMap((e) => (e.snapshot ? [e.snapshot] : []));
  if (
    snapshots.length > NOTE_LIMITS.snapshots ||
    snapshots.reduce(
      (n, d) => n + (d.formatVersion === '2.0.0' ? encodeC6Snapshot(d) : encodeSnapshot(d)).length,
      0,
    ) > NOTE_LIMITS.snapshotBytes
  )
    throw Error('NOTE_SNAPSHOT_SIZE');
  const pack: C6NotesPackage = {
    formatId: 'urn:c-viz:study-notes:2.0.0',
    formatVersion: '2.0.0',
    createdAt: new Date().toISOString(),
    lease: crypto.randomUUID(),
    timeZone,
    filter: structuredClone(filter),
    entries: structuredClone(chosen),
  };
  if (
    !isUtcTime(pack.createdAt) ||
    !isUuid(pack.lease) ||
    new TextEncoder().encode(JSON.stringify(pack)).length > NOTE_LIMITS.packageBytes
  )
    throw Error('NOTE_SIZE');
  return pack;
}
export function savedC6NotesSnapshot(state: LearningServiceState): StorageSnapshot | null {
  return state.c6?.index && state.status === 'ready' && !state.temporary && !state.pendingCount
    ? state.snapshot
    : null;
}
