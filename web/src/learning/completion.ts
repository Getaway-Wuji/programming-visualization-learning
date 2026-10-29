import { isCompatibleLearningHistory } from './domain';
import type { LearningServiceState } from './service';
import { sameRef } from './catalog';
import { reviewedDurableSnapshot } from './reviewed-release';

/** Completion comes from the durable snapshot, never the optimistic temporary projection. */
export function lessonCompletionDetails(
  state: Pick<LearningServiceState, 'snapshot' | 'reading' | 'practiceCatalog'>,
  lessonId: string,
) {
  const { snapshot, reading } = state;
  const catalog = state.practiceCatalog ?? reading?.catalog;
  const lesson = catalog?.lessons.find((item) => item.ref.id === lessonId);
  if (!snapshot || !reading || !catalog || !lesson) return null;
  const history = reviewedDurableSnapshot(snapshot, catalog).progress;
  const confirmed = history.some(
    (row) =>
      row.eventType === 'lesson.study-confirmed' &&
      isCompatibleLearningHistory(row, lesson, 'lesson', snapshot.aliases),
  );
  const started =
    confirmed ||
    history.some(
      (row) =>
        row.eventType === 'lesson.started' &&
        isCompatibleLearningHistory(row, lesson, 'lesson', snapshot.aliases),
    );
  const exercises = lesson.requiredExerciseRefs.map((ref) => {
    const exercise = catalog.exercises.find((item) => sameRef(item.ref, ref));
    return {
      id: ref.id,
      title: reading.exercises.find((item) => sameRef(item, ref))?.title ?? '本节必修练习',
      passed:
        !!exercise &&
        history.some(
          (row) =>
            row.eventType === 'exercise.passed' &&
            isCompatibleLearningHistory(row, exercise, 'exercise', snapshot.aliases),
        ),
    };
  });
  const completed = confirmed && exercises.length > 0 && exercises.every((item) => item.passed);
  const ordered = [...reading.chapters]
    .sort((a, b) => a.order - b.order)
    .flatMap((chapter) => chapter.lessonRefs);
  const position = ordered.findIndex((ref) => sameRef(ref, lesson.ref));
  const next = position >= 0 ? ordered[position + 1] : undefined;
  const nextLesson = next ? reading.lessons.find((item) => sameRef(item, next)) : undefined;
  return { started, confirmed, exercises, completed, nextLesson };
}
