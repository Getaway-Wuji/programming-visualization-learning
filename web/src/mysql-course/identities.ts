import type { Progress, Receipt, Ref } from '../storage/model';
import { mysqlLessonIds, mysqlProfiles } from './release.generated';

export const mysqlPackageRef = { id: 'content.mysql.book', version: '1.0.0' } as const;
export const mysqlFreeDocument = 'mysql.document.free';
const lessons = new Set<string>(mysqlLessonIds);
const runnableLessons = new Set<string>(Object.values(mysqlProfiles).map((p) => p.lesson));
export const mysqlExercises: Readonly<Record<string, { lesson: string; title: string }>> =
  mysqlProfiles;
export const mysqlExercise = (id: string) =>
  Object.hasOwn(mysqlExercises, id) ? mysqlExercises[id] : undefined;
export const isMysqlLesson = (id: string) => lessons.has(id);
export const isMysqlDocument = (id: string) =>
  id === mysqlFreeDocument || Boolean(mysqlExercise(id)) || runnableLessons.has(id);
export const isMysqlPackage = (ref: Ref) =>
  ref.id === mysqlPackageRef.id && ref.version === mysqlPackageRef.version;
export const isMysqlSubject = (event: string, id: string) =>
  event.startsWith('lesson.')
    ? isMysqlLesson(id)
    : event.startsWith('exercise.') && Boolean(mysqlExercise(id));
export const isMysqlProgress = (row: Progress | Receipt) =>
  row.subjectRef.version === '1.0.0' &&
  row.learningRevision === 1 &&
  row.packageRef !== null &&
  isMysqlPackage(row.packageRef) &&
  isMysqlSubject(row.eventType, row.subjectRef.id);
