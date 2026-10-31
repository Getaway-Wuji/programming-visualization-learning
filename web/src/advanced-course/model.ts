import course from '../../../content/advanced/course-1.0.0.json';
import type { EntityRef } from '../content/types';
import type { CourseReading } from '../content/reading';
import { allSortCases, prepareSort } from '../algorithms/content';
import { sameRef } from '../learning/catalog';
import { lessonCompletionDetails } from '../learning/completion';
import type { LearningServiceState } from '../learning/service';

export const advancedCourse = course;
export type AdvancedLesson = (typeof course.lessons)[number];

/** A reading arrangement has no authority to create learning entities or facts. */
export function availableAdvancedLesson(
  entry: AdvancedLesson,
  reading: CourseReading | null | undefined,
) {
  if (!reading || !sameRef(reading.packageRef, course.packageRef)) return null;
  const lesson = reading.lessons.find((item) => sameRef(item, entry.lessonRef));
  const spec = allSortCases.find((item) => sameRef(item, entry.caseRef));
  if (
    !lesson ||
    !spec ||
    entry.knowledgeRefs.some((ref) => !lesson.knowledgeRefs.some((item) => sameRef(item, ref))) ||
    lesson.requiredExerciseRefs.length === 0 ||
    !lesson.requiredExerciseRefs.every((ref) =>
      reading.exercises.some((item) => sameRef(item, ref)),
    )
  )
    return null;
  return { lesson, spec, prepared: prepareSort(spec, spec.defaultInput) };
}

export function advancedChapterProgress(
  refs: readonly EntityRef[],
  state: Pick<LearningServiceState, 'snapshot' | 'reading' | 'practiceCatalog'>,
) {
  const details = refs.map((ref) => {
    const entry = course.lessons.find((item) => sameRef(item.lessonRef, ref));
    return entry && availableAdvancedLesson(entry, state.reading)
      ? lessonCompletionDetails(state, ref.id)
      : null;
  });
  const known = details.length > 0 && details.every((detail) => detail !== null);
  const completed = details.filter((detail) => detail?.completed).length;
  return { known, completed, total: refs.length, complete: known && completed === refs.length };
}
