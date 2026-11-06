import type { Progress, Receipt, Ref } from '../storage/model';
import { javaCourseRelease, javaExerciseIndex, javaLessonIds } from './release.generated';

export const javaPackageRef = javaCourseRelease.packageRef;
const lessons = new Set<string>(javaLessonIds);
export const javaExercises: Readonly<
  Record<string, { lessonId: string; articleOrder: number; title: string }>
> = Object.freeze(javaExerciseIndex);
export function javaExercise(id: string) {
  return Object.hasOwn(javaExercises, id) ? javaExercises[id] : undefined;
}
export const javaTopicId = (exerciseId: string) =>
  exerciseId.replace(/^java\.practice\./u, 'java.knowledge.');
export function javaTopic(id: string) {
  if (!id.startsWith('java.knowledge.')) return undefined;
  return javaExercise(id.replace(/^java\.knowledge\./u, 'java.practice.'));
}
export function isJavaMark(row: { packageRef: Ref; knowledgeRef: Ref; lessonRef: Ref }) {
  return (
    isJavaPackage(row.packageRef) &&
    row.knowledgeRef.version === '1.0.0' &&
    row.lessonRef.version === '1.0.0' &&
    javaTopic(row.knowledgeRef.id)?.lessonId === row.lessonRef.id
  );
}
export const javaFreeDocument = 'java.document.free';
export const isJavaLesson = (id: string) => lessons.has(id);
export const isJavaDocument = (id: string) => id === javaFreeDocument || Boolean(javaExercise(id));

export function isJavaSubject(eventType: string, id: string) {
  return eventType.startsWith('lesson.')
    ? isJavaLesson(id)
    : eventType.startsWith('exercise.') && Boolean(javaExercise(id));
}

export function isJavaPackage(ref: Ref) {
  return ref.id === javaPackageRef.id && ref.version === javaPackageRef.version;
}

export function isJavaProgress(value: Progress | Receipt) {
  return (
    value.subjectRef.version === '1.0.0' &&
    value.learningRevision === 1 &&
    value.packageRef !== null &&
    isJavaPackage(value.packageRef) &&
    isJavaSubject(value.eventType, value.subjectRef.id)
  );
}
