import type { Progress, Receipt, Ref } from '../storage/model';
import { rust2018LessonIds, rust2018Profiles } from './release.generated';

export const rustPackageRef = { id: 'content.rust2018.book', version: '1.0.0' } as const;
export const rustFreeDocument = 'rust.document.free';
const lessons = new Set<string>(rust2018LessonIds);
export const rustExercises: Readonly<Record<string, { lesson: string; title: string }>> =
  rust2018Profiles;
export function rustExercise(id: string) {
  return Object.hasOwn(rustExercises, id) ? rustExercises[id] : undefined;
}
export const isRustLesson = (id: string) => lessons.has(id);
export const isRustDocument = (id: string) => id === rustFreeDocument || Boolean(rustExercise(id));
export const isRustPackage = (ref: Ref) =>
  ref.id === rustPackageRef.id && ref.version === rustPackageRef.version;
export const isRustSubject = (event: string, id: string) =>
  event.startsWith('lesson.')
    ? isRustLesson(id)
    : event.startsWith('exercise.') && Boolean(rustExercise(id));
export const isRustProgress = (row: Progress | Receipt) =>
  row.subjectRef.version === '1.0.0' &&
  row.learningRevision === 1 &&
  row.packageRef !== null &&
  isRustPackage(row.packageRef) &&
  isRustSubject(row.eventType, row.subjectRef.id);
