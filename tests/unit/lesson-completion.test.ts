import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lessonCompletionDetails } from '../../web/src/learning/completion';
import type { CourseReading } from '../../web/src/content/reading';
import type { Progress } from '../../web/src/storage/model';
import { createMeta, emptySnapshot } from '../../web/src/storage/model';

const reading = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
) as CourseReading;
function setup() {
  return {
    reading,
    practiceCatalog: reading.catalog,
    snapshot: emptySnapshot(
      createMeta({
        generation: '00000000-0000-4000-8000-000000000507',
        timeZone: 'Asia/Shanghai',
        createdAt: '2026-10-26T01:00:00.000Z',
        activePackageRef: reading.packageRef,
      }),
    ),
  };
}
function fact(eventType: 'lesson.study-confirmed' | 'exercise.passed', index = 0): Progress {
  const entity =
    eventType === 'lesson.study-confirmed'
      ? reading.catalog.lessons[index]
      : reading.catalog.exercises[index];
  return {
    eventType,
    result: eventType === 'lesson.study-confirmed' ? 'confirmed' : 'passed',
    subjectRef: entity.ref,
    learningRevision: entity.learningRevision,
    packageRef: reading.packageRef,
    firstAt: '2026-10-26T01:00:00.000Z',
    lastAt: '2026-10-26T01:00:00.000Z',
  } as Progress;
}

describe('durable lesson completion checklist', () => {
  const lessonId = reading.catalog.lessons[0].ref.id;
  it('never turns a temporary successful projection into saved completion', () => {
    const state = {
      ...setup(),
      temporary: true,
      pendingCount: 1,
      projection: { lessons: [{ id: lessonId, completed: true }], exercises: [{ passed: true }] },
    };
    const before = structuredClone(state.snapshot);
    expect(lessonCompletionDetails(state, lessonId)).toMatchObject({
      confirmed: false,
      completed: false,
      exercises: [{ passed: false }],
    });
    expect(state.snapshot).toEqual(before);
    state.snapshot.progress.push(fact('lesson.study-confirmed'), fact('exercise.passed'));
    expect(lessonCompletionDetails(state, lessonId)?.completed).toBe(true);
  });
  it('requires active confirmation and every required exercise, and leaves historical passes intact', () => {
    const state = setup();
    state.snapshot.progress.push(fact('exercise.passed'));
    expect(lessonCompletionDetails(state, lessonId)).toMatchObject({
      confirmed: false,
      completed: false,
      exercises: [{ passed: true }],
    });
    state.snapshot.progress.push(fact('lesson.study-confirmed'));
    expect(lessonCompletionDetails(state, lessonId)).toMatchObject({
      confirmed: true,
      completed: true,
      nextLesson: { id: reading.catalog.lessons[1].ref.id },
    });
  });
  it('rejects an unsupported historical version or changed learning objective', () => {
    const state = setup();
    const pass = fact('exercise.passed');
    state.snapshot.progress.push(fact('lesson.study-confirmed'), {
      ...pass,
      subjectRef: { ...pass.subjectRef, version: '99.0.0' },
    });
    expect(lessonCompletionDetails(state, lessonId)?.completed).toBe(false);
    state.snapshot.progress[1] = { ...pass, learningRevision: pass.learningRevision + 1 };
    expect(lessonCompletionDetails(state, lessonId)?.completed).toBe(false);
  });
  it('honors an explicit accepted prior version and verified alias path', () => {
    const state = setup();
    const pass = fact('exercise.passed');
    const target = state.practiceCatalog.exercises[0];
    state.practiceCatalog = {
      ...state.practiceCatalog,
      exercises: [
        { ...target, acceptedPriorVersions: ['0.9.0'] },
        ...state.practiceCatalog.exercises.slice(1),
      ],
    };
    state.snapshot.progress.push(fact('lesson.study-confirmed'), {
      ...pass,
      subjectRef: { id: 'exercise.c.old-echo', version: '0.8.0' },
    });
    state.snapshot.aliases.push({
      kind: 'exercise',
      fromRef: { id: 'exercise.c.old-echo', version: '0.8.0' },
      fromAcceptedPriorVersions: [],
      toRef: { id: target.ref.id, version: '0.9.0' },
      learningRevision: target.learningRevision,
      manifestRef: { id: 'migration.test', version: '1.0.0' },
    });
    expect(lessonCompletionDetails(state, lessonId)?.completed).toBe(true);
  });
  it('keeps unavailable data unknown and has no next lesson beyond the final published lesson', () => {
    const state = setup();
    expect(lessonCompletionDetails({ ...state, snapshot: null }, lessonId)).toBeNull();
    expect(lessonCompletionDetails({ ...state, reading: null }, lessonId)).toBeNull();
    expect(lessonCompletionDetails(state, 'lesson.c.unknown')).toBeNull();
    const finalLesson = reading.catalog.lessons.at(-1)!;
    expect(lessonCompletionDetails(state, finalLesson.ref.id)?.nextLesson).toBeUndefined();
  });
});
