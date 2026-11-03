import { applyC6LearningEvent } from '../learning/domain';
import type { C6LearningCommand } from './model';
import type { StorageMutation } from '../storage/client';
import type { C6CourseRecipe, C6CourseState } from '../storage/c6-course';
import type { Progress } from '../storage/model';
import { StorageError } from '../storage/errors';
import type { C6LearningIndex } from './index';
import { assertC6Attempt, type C6Attempt, type C6CourseActivity } from './model';

export function prepareC6Event(
  state: C6CourseState,
  command: C6LearningCommand,
  index: C6LearningIndex,
  attempt: C6Attempt | null,
  rewards: (operations: StorageMutation[]) => StorageMutation[] = (ops) => ops,
): C6CourseRecipe {
  const { snapshot, rows } = state;
  const receipt = command.receipt;
  const exercise = index.exercises.find((e) => e[0] === receipt.subjectRef.id);
  if (exercise) {
    if (
      !attempt ||
      attempt.eventId !== receipt.eventId ||
      attempt.at !== receipt.occurredAt ||
      (attempt.status === 'passed') !== (receipt.eventType === 'exercise.passed')
    )
      throw new StorageError('S_RECORD_INVALID');
    assertC6Attempt(attempt, exercise[3]);
  } else if (attempt || !['lesson.started', 'lesson.study-confirmed'].includes(receipt.eventType))
    throw new StorageError('S_RECORD_INVALID');
  const operations = rewards(applyC6LearningEvent(snapshot, command, index));
  const progress = snapshot.progress.map((p) => ({ ...p }));
  for (const op of operations)
    if (op.store === 'progress') {
      const at = progress.findIndex(
        (p) => p.eventType === op.value.eventType && p.subjectRef.id === op.value.subjectRef.id,
      );
      if (at >= 0) progress[at] = op.value;
      else progress.push(op.value);
    }
  const changed: C6CourseActivity[] = [];
  const previous = rows.activities.find((r) => r.subjectRef.id === receipt.subjectRef.id);
  const base = {
    activityVersion: '2.0.0' as const,
    generation: command.generation,
    subjectRef: { ...receipt.subjectRef },
    revision: snapshot.meta.revision + 1,
    lastEventId: receipt.eventId,
    firstAt: previous?.firstAt ?? receipt.occurredAt,
    lastAt: receipt.occurredAt,
  };
  if (attempt)
    changed.push({
      ...base,
      kind: 'exercise',
      firstPass:
        previous?.kind === 'exercise' && previous.firstPass
          ? previous.firstPass
          : attempt.status === 'passed'
            ? attempt
            : null,
      latestAttempt: attempt,
    });
  const lessonId = exercise?.[2] ?? receipt.subjectRef.id;
  const lesson = index.lessons.find((l) => l[0] === lessonId);
  if (!lesson) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  const lessonProgress = progress.filter((p) => p.subjectRef.id === lessonId);
  const previousLesson = rows.activities.find(
    (r) => r.kind === 'lesson' && r.subjectRef.id === lessonId,
  );
  if (!exercise || lessonProgress.some((p) => p.eventType === 'lesson.completed')) {
    const first = (event: Progress['eventType']) =>
      lessonProgress.find((p) => p.eventType === event)?.firstAt ?? null;
    changed.push({
      ...base,
      kind: 'lesson',
      subjectRef: { id: lessonId, version: '2.0.0' },
      firstAt: previousLesson?.firstAt ?? receipt.occurredAt,
      startedAt: previousLesson?.kind === 'lesson' ? previousLesson.startedAt : receipt.occurredAt,
      readAt: first('lesson.study-confirmed'),
      completedAt: first('lesson.completed'),
    });
  }
  return { operations, receipt, activities: changed };
}
