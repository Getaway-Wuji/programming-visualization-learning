// Public navigation labels/relationships from the frozen P0 plan. This is not
// a publishable CONTENT-01 package, a progress record, or an execution template.
import type { CourseReading } from './content/reading';
const legacyChapters = [
  {
    id: 'chapter.c.values',
    title: '变量与表达式',
    description: '从变量和输出开始，认识表达式。',
    number: '01',
  },
  {
    id: 'chapter.c.control',
    title: '条件与循环',
    description: '理解判断与重复，让程序有自己的路径。',
    number: '02',
  },
  {
    id: 'chapter.c.arrays',
    title: '数组与综合',
    description: '组织一组数据，把学过的知识连起来。',
    number: '03',
  },
] as const;

const legacyLessons = [
  {
    id: 'lesson.c.variables-output',
    title: '变量和输出',
    chapterId: 'chapter.c.values',
    exerciseId: 'exercise.c.echo',
    exerciseTitle: '输出输入变量',
    caseIds: ['case.c.assignment'],
  },
  {
    id: 'lesson.c.expressions',
    title: '表达式',
    chapterId: 'chapter.c.values',
    exerciseId: 'exercise.c.two-x-plus-three',
    exerciseTitle: '两倍加三',
    caseIds: [],
  },
  {
    id: 'lesson.c.conditions',
    title: '条件',
    chapterId: 'chapter.c.control',
    exerciseId: 'exercise.c.nonnegative',
    exerciseTitle: '非负判定',
    caseIds: ['case.c.branch'],
  },
  {
    id: 'lesson.c.loops',
    title: 'while 与 for',
    chapterId: 'chapter.c.control',
    exerciseId: 'exercise.c.two-loop-sums',
    exerciseTitle: '两种循环求和',
    caseIds: ['case.c.loops'],
  },
  {
    id: 'lesson.c.array-update',
    title: '一维数组',
    chapterId: 'chapter.c.arrays',
    exerciseId: 'exercise.c.increment-at-index',
    exerciseTitle: '指定元素加一',
    caseIds: [],
  },
  {
    id: 'lesson.c.array-sum',
    title: '综合练习',
    chapterId: 'chapter.c.arrays',
    exerciseId: 'exercise.c.array-sum',
    exerciseTitle: '数组求和',
    caseIds: [
      'case.c.array-traversal',
      'case.c.bubble-sort',
      'case.c.selection-sort',
      'case.c.binary-search-first',
    ],
  },
] as const;

export interface ChapterNavigation {
  id: string;
  title: string;
  description: string;
  number: string;
}
export interface LessonNavigation {
  id: string;
  title: string;
  chapterId: string;
  exerciseId: string;
  exerciseTitle: string;
  caseIds: readonly string[];
}
export let chapters: readonly ChapterNavigation[] = legacyChapters;
export let lessons: readonly LessonNavigation[] = legacyLessons;
/** Updated together only after the entire reading/practice/case bundle passes its fixed hash. */
export function activateCourseNavigation(reading: CourseReading | null) {
  chapters = reading
    ? reading.chapters.map((entry) => ({
        id: entry.id,
        title: entry.title,
        description: `按推荐顺序学习本章的 ${entry.lessonRefs.length} 个小节。`,
        number: String(entry.order).padStart(2, '0'),
      }))
    : legacyChapters;
  lessons = reading
    ? reading.lessons.map((entry) => ({
        id: entry.id,
        title: entry.title,
        chapterId: entry.chapterRef.id,
        exerciseId: entry.requiredExerciseRefs[0]!.id,
        exerciseTitle:
          reading.exercises.find((exercise) => exercise.id === entry.requiredExerciseRefs[0]!.id)
            ?.title ?? '必修练习',
        caseIds: entry.caseRefs.map((ref) => ref.id),
      }))
    : legacyLessons;
}

export const cases = [
  {
    id: 'case.c.assignment',
    title: '变量赋值',
    kind: 'demo',
    description: '观察变量的值怎样改变。',
    lessonId: 'lesson.c.variables-output',
  },
  {
    id: 'case.c.branch',
    title: '分支判断',
    kind: 'demo',
    description: '看清条件选择了哪条执行路径。',
    lessonId: 'lesson.c.conditions',
  },
  {
    id: 'case.c.loops',
    title: '循环',
    kind: 'demo',
    description: '认识 while 和 for 的重复过程。',
    lessonId: 'lesson.c.loops',
  },
  {
    id: 'case.c.array-traversal',
    title: '数组遍历',
    kind: 'demo',
    description: '逐个访问数组中的元素。',
    lessonId: 'lesson.c.array-sum',
  },
  {
    id: 'case.c.bubble-sort',
    title: '冒泡排序',
    kind: 'algorithm',
    description: '比较相邻元素，理解交换的作用。',
    lessonId: 'lesson.c.array-sum',
  },
  {
    id: 'case.c.selection-sort',
    title: '选择排序',
    kind: 'algorithm',
    description: '寻找最小值，逐步整理数组。',
    lessonId: 'lesson.c.array-sum',
  },
  {
    id: 'case.c.binary-search-first',
    title: '二分搜索首次匹配',
    kind: 'algorithm',
    description: '在有序数组中缩小查找范围。',
    lessonId: 'lesson.c.array-sum',
  },
] as const;

export const paths = {
  home: '/',
  courses: '/courses',
  cases: '/cases',
  settings: '/settings',
  chapter: (id: string) => `/courses/${encodeURIComponent(id)}`,
  lesson: (id: string) => `/lessons/${encodeURIComponent(id)}`,
  practice: (id: string) => `/practice/${encodeURIComponent(id)}`,
  review: (id: string) => `/practice/${encodeURIComponent(id)}/review`,
  visualize: (id: string) => `/visualize/${encodeURIComponent(id)}`,
};
