import type { Progress, Receipt, Ref } from '../storage/model';
import { cppLessonIds, cppProfiles } from './release.generated';

export const cppPackageRef = { id: 'content.cpp.book', version: '1.0.0' } as const;
export const cppFreeDocument = 'cpp.document.free';
const lessons = new Set<string>(cppLessonIds);
export const cppExercises: Readonly<Record<string, { lesson: string; title: string }>> =
  cppProfiles;
export function cppExercise(id: string) {
  return Object.hasOwn(cppExercises, id) ? cppExercises[id] : undefined;
}
export const isCppLesson = (id: string) => lessons.has(id);
export const isCppDocument = (id: string) => id === cppFreeDocument || Boolean(cppExercise(id));
export const isCppPackage = (ref: Ref) =>
  ref.id === cppPackageRef.id && ref.version === cppPackageRef.version;
export const isCppSubject = (event: string, id: string) =>
  event.startsWith('lesson.')
    ? isCppLesson(id)
    : event.startsWith('exercise.') && Boolean(cppExercise(id));
export const isCppProgress = (row: Progress | Receipt) =>
  row.subjectRef.version === '1.0.0' &&
  row.learningRevision === 1 &&
  row.packageRef !== null &&
  isCppPackage(row.packageRef) &&
  isCppSubject(row.eventType, row.subjectRef.id);
