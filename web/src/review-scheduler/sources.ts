import type { StorageSnapshot } from '../storage/model';
import type { KnowledgeMark } from '../storage/knowledge-marks';
import type { LearningCatalog } from '../learning/types';
import type { CourseReading } from '../content/reading';
import type { ReviewSource } from './model';
import { collectMistakes } from '../review-notebook/model';
import { sameRef } from '../learning/catalog';
export function reviewSources(
  snapshot: StorageSnapshot,
  marks: readonly KnowledgeMark[],
  catalog: LearningCatalog,
  reading: CourseReading,
): ReviewSource[] {
  const out: ReviewSource[] = [];
  for (const m of collectMistakes(snapshot, catalog)) {
    const e = catalog.exercises.find((e) => e.ref.id === m.currentId);
    if (!e || !reading.lessons.some((l) => sameRef(l, e.lessonRef))) continue;
    out.push({
      kind: 'exercise',
      packageRef: { ...catalog.packageRef },
      subjectRef: { ...e.ref },
      lessonRef: { ...e.lessonRef },
      learningRevision: e.learningRevision,
      sourceVersion: m.revision,
      sourceAt: m.lastAt,
      state: m.repaired ? 'repaired' : 'active',
    });
  }
  for (const m of marks) {
    if (
      !sameRef(m.packageRef, reading.packageRef) ||
      !reading.knowledgePoints.some((k) => sameRef(k, m.knowledgeRef)) ||
      !reading.lessons.some(
        (l) => sameRef(l, m.lessonRef) && l.knowledgeRefs.some((k) => sameRef(k, m.knowledgeRef)),
      )
    )
      continue;
    out.push({
      kind: 'knowledge',
      packageRef: { ...m.packageRef },
      subjectRef: { ...m.knowledgeRef },
      lessonRef: { ...m.lessonRef },
      learningRevision: 1,
      sourceVersion: m.revision,
      sourceAt: m.lastAt,
      state: m.marked ? 'active' : 'familiar',
    });
  }
  return out;
}
