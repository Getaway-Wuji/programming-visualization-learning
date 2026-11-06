import type { Progress, Receipt, Ref } from '../storage/model';
import { pythonCourseRelease, pythonExerciseIndex, pythonLessonIds } from './release.generated';

export const pythonPackageRef = pythonCourseRelease.packageRef;
const lessons = new Set<string>(pythonLessonIds);
export const pythonExercises: Readonly<
  Record<string, { lessonId: string; articleOrder: number; title: string }>
> = Object.freeze(pythonExerciseIndex);
export function pythonExercise(id: string) {
  return Object.hasOwn(pythonExercises, id) ? pythonExercises[id] : undefined;
}
export const pythonTopicId = (exerciseId: string) =>
  exerciseId.replace(/^py3\.practice\./u, 'py3.knowledge.');
export function pythonTopic(id: string) {
  if (!id.startsWith('py3.knowledge.')) return undefined;
  return pythonExercise(id.replace(/^py3\.knowledge\./u, 'py3.practice.'));
}
export function isPythonMark(row: { packageRef: Ref; knowledgeRef: Ref; lessonRef: Ref }) {
  return (
    isPythonPackage(row.packageRef) &&
    row.knowledgeRef.version === '1.0.0' &&
    row.lessonRef.version === '1.0.0' &&
    pythonTopic(row.knowledgeRef.id)?.lessonId === row.lessonRef.id
  );
}
export const pythonFreeDocument = 'py3.document.free';
export const isPythonLesson = (id: string) => lessons.has(id);
export const isPythonDocument = (id: string) =>
  id === pythonFreeDocument || Boolean(pythonExercise(id));

export function isPythonSubject(eventType: string, id: string) {
  return eventType.startsWith('lesson.')
    ? isPythonLesson(id)
    : eventType.startsWith('exercise.') && Boolean(pythonExercise(id));
}

export function isPythonPackage(ref: Ref) {
  return ref.id === pythonPackageRef.id && ref.version === pythonPackageRef.version;
}

export function isPythonProgress(value: Progress | Receipt) {
  return (
    value.subjectRef.version === '1.0.0' &&
    value.learningRevision === 1 &&
    value.packageRef !== null &&
    isPythonPackage(value.packageRef) &&
    isPythonSubject(value.eventType, value.subjectRef.id)
  );
}
