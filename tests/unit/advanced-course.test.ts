import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  advancedCourse,
  advancedChapterProgress,
  availableAdvancedLesson,
} from '../../web/src/advanced-course/model';
import type { CourseReading } from '../../web/src/content/reading';
import { createMeta, emptySnapshot, type Progress } from '../../web/src/storage/model';

const reading = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.1.0.json', 'utf8'),
) as CourseReading;
function setup() {
  return {
    reading,
    practiceCatalog: reading.catalog,
    snapshot: emptySnapshot(
      createMeta({
        generation: '00000000-0000-4000-8000-000000001801',
        timeZone: 'Asia/Shanghai',
        createdAt: '2026-11-01T01:00:00.000Z',
        activePackageRef: reading.packageRef,
      }),
    ),
  };
}
function completeFacts(index: number): Progress[] {
  const ref = advancedCourse.lessons[index].lessonRef;
  const lesson = reading.catalog.lessons.find((item) => item.ref.id === ref.id)!;
  return [
    lesson,
    ...lesson.requiredExerciseRefs.map((ref) =>
      reading.catalog.exercises.find((item) => item.ref.id === ref.id)!,
    ),
  ].map(
    (item, i) =>
      ({
        eventType: i === 0 ? 'lesson.study-confirmed' : 'exercise.passed',
        result: i === 0 ? 'confirmed' : 'passed',
        subjectRef: item.ref,
        learningRevision: item.learningRevision,
        packageRef: reading.packageRef,
        firstAt: '2026-11-01T01:00:00.000Z',
        lastAt: '2026-11-01T01:00:00.000Z',
      }) as Progress,
  );
}
describe('advanced course reuses durable learning identities', () => {
  it('validates the closed format, exact references and rejects mutations at build time', () => {
    const script = `import {validateAdvancedCourse} from './scripts/advanced-course-content.mjs'; import {readFileSync} from 'node:fs'; const source=JSON.parse(readFileSync('content/advanced/course-1.0.0.json')); validateAdvancedCourse(); let count=0; for(const edit of [c=>c.extra=true,c=>c.schemaVersion='99.0.0',c=>c.lessons[0].lessonRef.version='99.0.0',c=>c.lessons[0].caseRef.id='case.cpp.fake',c=>c.lessons[0].knowledgeRefs=[],c=>c.chapters[0].lessonRefs.push(c.chapters[0].lessonRefs[0])]) {const c=structuredClone(source); edit(c);try{validateAdvancedCourse(c);}catch{count++;}} if(count!==6)throw Error('mutation accepted');`;
    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script]),
    ).not.toThrow();
  });
  it('all four entries resolve real source, input, knowledge and required exercises', () => {
    for (const entry of advancedCourse.lessons) {
      const resolved = availableAdvancedLesson(entry, reading)!;
      expect(resolved).not.toBeNull();
      expect(resolved.prepared.source).toContain('std::cout');
      expect(resolved.prepared.source).not.toContain('{{n}}');
      expect(resolved.prepared.input).toEqual(resolved.spec.defaultInput);
    }
  });
  it('does not infer completion from an optimistic projection or mutate any saved row', () => {
    const state = {
      ...setup(),
      projection: {
        lessons: advancedCourse.lessons.map((entry) => ({
          id: entry.lessonRef.id,
          completed: true,
        })),
      },
      temporary: true,
    };
    const before = structuredClone(state.snapshot);
    expect(advancedChapterProgress(advancedCourse.chapters[0].lessonRefs, state)).toMatchObject({
      known: true,
      completed: 0,
      complete: false,
    });
    expect(state.snapshot).toEqual(before);
  });
  it('requires confirmation and all required passes for every chapter member', () => {
    const state = setup(),
      refs = advancedCourse.chapters[0].lessonRefs;
    state.snapshot.progress.push(...completeFacts(0).slice(1));
    expect(advancedChapterProgress(refs, state).completed).toBe(0);
    state.snapshot.progress.push(completeFacts(0)[0]);
    expect(advancedChapterProgress(refs, state)).toMatchObject({ completed: 1, complete: false });
    state.snapshot.progress.push(...completeFacts(1));
    expect(advancedChapterProgress(refs, state)).toMatchObject({ completed: 2, complete: true });
    expect(state.snapshot.ledger).toEqual([]);
  });
  it('foreign versions and revisions do not satisfy the chapter', () => {
    const state = setup(),
      facts = completeFacts(0);
    state.snapshot.progress.push(facts[0], {
      ...facts[1],
      learningRevision: facts[1].learningRevision + 1,
    });
    expect(advancedChapterProgress(advancedCourse.chapters[0].lessonRefs, state).completed).toBe(0);
    state.snapshot.progress[1] = {
      ...facts[1],
      subjectRef: { ...facts[1].subjectRef, version: '99.0.0' },
    };
    expect(advancedChapterProgress(advancedCourse.chapters[0].lessonRefs, state).completed).toBe(0);
  });
  it('missing data and the old six-lesson fallback stay unknown', () => {
    const state = setup(),
      refs = advancedCourse.chapters[0].lessonRefs;
    expect(advancedChapterProgress(refs, { ...state, snapshot: null }).known).toBe(false);
    const old = JSON.parse(
      readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
    ) as CourseReading;
    expect(advancedChapterProgress(refs, { ...state, reading: old }).known).toBe(false);
    expect(
      availableAdvancedLesson(
        { ...advancedCourse.lessons[0], caseRef: { id: 'case.cpp.fake', version: '1.0.0' } },
        reading,
      ),
    ).toBeNull();
  });
});
