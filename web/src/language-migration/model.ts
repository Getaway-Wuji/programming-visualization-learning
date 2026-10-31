import content from '../../../content/advanced/language-migration-1.0.0.json';
import type { CourseReading } from '../content/reading';
import { sameRef } from '../learning/catalog';

export const languageIds = ['c', 'cpp', 'python', 'java'] as const;
export type Language = (typeof languageIds)[number];
export const migrationContent = content;
export type MigrationTopic = (typeof content.topics)[number];
export const languageInfo = (id: Language) => content.languages.find((l) => l.id === id)!;
export const isLanguage = (id: unknown): id is Language =>
  typeof id === 'string' && languageIds.some((item) => item === id);
export interface TeachingState {
  known: Language;
  target: Language;
  topic: string;
  cursor: number;
  playing: boolean;
  generation: number;
}
export const initialTeachingState: TeachingState = {
  known: 'c',
  target: 'cpp',
  topic: 'integers',
  cursor: 0,
  playing: false,
  generation: 0,
};
type Action =
  | { type: 'known' | 'target' | 'topic'; value: unknown }
  | { type: 'step'; delta: -1 | 1 }
  | { type: 'play' | 'pause' | 'reset' }
  | { type: 'tick'; generation: number };
/** A finite reading annotation cursor, never an execution trace or evaluator. */
export function teachingReducer(state: TeachingState, action: Action): TeachingState {
  if (action.type === 'tick') {
    if (!state.playing || action.generation !== state.generation) return state;
    const cursor = Math.min(3, state.cursor + 1);
    return { ...state, cursor, playing: cursor < 3 };
  }
  const next = { ...state, playing: false, generation: state.generation + 1 };
  if (action.type === 'known') {
    if (!isLanguage(action.value)) return state;
    return {
      ...next,
      known: action.value,
      target: languageInfo(action.value).defaultTarget as Language,
      cursor: 0,
    };
  }
  if (action.type === 'target') {
    if (!isLanguage(action.value) || action.value === state.known) return state;
    return { ...next, target: action.value, cursor: 0 };
  }
  if (action.type === 'topic') {
    if (typeof action.value !== 'string' || !content.topics.some((t) => t.id === action.value))
      return state;
    return { ...next, topic: action.value, cursor: 0 };
  }
  if (action.type === 'reset') return { ...next, cursor: 0 };
  if (action.type === 'step')
    return { ...next, cursor: Math.max(0, Math.min(3, state.cursor + action.delta)) };
  if (action.type === 'play')
    return { ...next, playing: true, cursor: state.cursor === 3 ? 0 : state.cursor };
  return next;
}
export function availableMigrationLesson(
  topic: MigrationTopic,
  reading: CourseReading | null | undefined,
) {
  if (!reading || !sameRef(reading.packageRef, content.packageRef)) return null;
  const lesson = reading.lessons.find((l) => sameRef(l, topic.lessonRef));
  if (
    !lesson ||
    lesson.knowledgeRefs.length !== topic.knowledgeRefs.length ||
    !topic.knowledgeRefs.every(
      (ref, i) =>
        sameRef(ref, lesson.knowledgeRefs[i]) &&
        reading.knowledgePoints.some((k) => sameRef(k, ref)),
    ) ||
    !lesson.requiredExerciseRefs.length ||
    !lesson.requiredExerciseRefs.every((ref) => reading.exercises.some((e) => sameRef(e, ref)))
  )
    return null;
  return lesson;
}
