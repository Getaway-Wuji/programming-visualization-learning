import type { Progress, StorageSnapshot } from '../storage/model';

export const languages = [
  {
    id: 'c',
    label: 'C',
    directory: '/courses',
    workbench: '/custom-code',
    review: '/notebook',
    total: 404,
  },
  {
    id: 'python',
    label: 'Python',
    directory: '/python',
    workbench: '/python/workbench',
    review: '/python/review',
    total: 766,
  },
  {
    id: 'java',
    label: 'Java',
    directory: '/java',
    workbench: '/java/workbench',
    review: '/java/review',
    total: 390,
  },
  {
    id: 'cpp',
    label: 'C++',
    directory: '/cpp',
    workbench: '/cpp/workbench',
    review: '/cpp/review',
    total: 295,
  },
  {
    id: 'rust',
    label: 'Rust',
    directory: '/rust',
    workbench: '/rust/workbench',
    review: '/rust/review',
    total: 299,
  },
  {
    id: 'mysql',
    label: 'MySQL',
    directory: '/mysql',
    workbench: '/mysql/workbench',
    review: '/mysql/review',
    total: 300,
  },
] as const;
export type LearningLanguage = (typeof languages)[number]['id'];
export type TextLanguage = Exclude<LearningLanguage, 'c'>;
export type LearningRoute = readonly [id: string, title: string, path: string, mode: string];
export interface LanguageNavigation {
  readonly language: string;
  readonly lessons: readonly LearningRoute[];
  readonly subjects: readonly (readonly [id: string, title: string, path: string])[];
}
export function subjectLanguage(id: string): LearningLanguage | null {
  if (id.startsWith('py3.')) return 'python';
  if (id.startsWith('java.')) return 'java';
  if (id.startsWith('cpp.book.')) return 'cpp';
  if (id.startsWith('rust.book.')) return 'rust';
  if (id.startsWith('mysql.')) return 'mysql';
  if (/^(lesson|exercise|knowledge|reward-group)\.c6\./u.test(id)) return 'c';
  return null;
}
export function recentLearningLanguage(snapshot: StorageSnapshot | null): LearningLanguage {
  const latest = snapshot?.progress
    .filter((row) => subjectLanguage(row.subjectRef.id))
    .reduce<Progress | undefined>(
      (current, row) => (!current || row.lastAt > current.lastAt ? row : current),
      undefined,
    );
  return latest ? (subjectLanguage(latest.subjectRef.id) ?? 'c') : 'c';
}
export function completedLanguageLessons(
  snapshot: StorageSnapshot | null,
  language: LearningLanguage,
) {
  return new Set(
    snapshot?.progress
      .filter(
        (row) =>
          row.eventType === 'lesson.completed' && subjectLanguage(row.subjectRef.id) === language,
      )
      .map((row) => row.subjectRef.id),
  );
}
export function languageForPath(path: string) {
  return (
    languages.find(
      (language) =>
        language.id !== 'c' &&
        (path === language.directory || path.startsWith(language.directory + '/')),
    ) ?? languages[0]
  );
}
const loaders = {
  python: () => import('../generated/learning-navigation/python'),
  java: () => import('../generated/learning-navigation/java'),
  cpp: () => import('../generated/learning-navigation/cpp'),
  rust: () => import('../generated/learning-navigation/rust'),
  mysql: () => import('../generated/learning-navigation/mysql'),
};
export async function loadLanguageNavigation(language: TextLanguage): Promise<LanguageNavigation> {
  return (await loaders[language]()).default;
}
