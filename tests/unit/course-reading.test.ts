import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeReading, continueLesson, type CourseReading } from '../../web/src/content/reading';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { createLearningAuthority } from '../../web/src/learning/authority';
import { projectLearning, applyLearningEvent } from '../../web/src/learning/domain';
import { createMeta, emptySnapshot } from '../../web/src/storage/model';
import type { Progress } from '../../web/src/storage/model';
import type { LearningCommand } from '../../web/src/learning/types';
import { lessonProgress } from '../../web/src/content/reading';
import type { LearningServiceState } from '../../web/src/learning/service';

const bytes = readFileSync('web/public/content/reading/course-reading-1.0.0.json');
let reading: CourseReading;
const at = '2026-10-19T02:00:00.000Z';
const generation = '00000000-0000-4000-8000-000000000092';
function snapshot() {
  return emptySnapshot(
    createMeta({
      generation,
      timeZone: 'Asia/Shanghai',
      createdAt: at,
      activePackageRef: reading.packageRef,
    }),
  );
}
function history(type: 'lesson.study-confirmed' | 'exercise.passed', version = '1.0.1'): Progress {
  const id = type === 'exercise.passed' ? reading.exercises[0].id : reading.lessons[0].id;
  return {
    eventType: type,
    result: type === 'exercise.passed' ? 'passed' : 'confirmed',
    subjectRef: { id, version },
    packageRef: reading.packageRef,
    learningRevision: 1,
    firstAt: at,
    lastAt: at,
  } as Progress;
}
describe('09.2 reviewed reading resource and restricted learning permissions', () => {
  beforeAll(async () => {
    reading = await decodeReading(bytes);
  });
  it('loads the exact immutable release with the original course identities and readonly examples', () => {
    expect(reading.chapters).toHaveLength(3);
    expect(reading.lessons).toHaveLength(6);
    expect(reading.catalog.purpose).toBe('lesson-reading');
    expect(reading.packageRef.version).toBe('1.0.1');
    expect(Object.isFrozen(reading.lessons[0].teaching)).toBe(true);
    expect(createLearningCatalog(reading.catalog)).toEqual(reading.catalog);
  });
  it.each(['changed bytes', 'truncated', 'duplicate-key replacement'])(
    'rejects %s before JSON parsing can accept it',
    async (kind) => {
      const altered =
        kind === 'truncated'
          ? bytes.subarray(1)
          : kind === 'changed bytes'
            ? Buffer.from(bytes)
            : Buffer.from('{"readingVersion":"1.0.0","readingVersion":"1.0.0"}');
      if (kind === 'changed bytes') altered[0] = 32;
      await expect(decodeReading(altered)).rejects.toThrow('READING_INTEGRITY');
    },
  );
  it('only grants entry/confirmation facts and rejects exercise/case permissions', () => {
    const authority = createLearningAuthority(reading.catalog, () => true);
    const base = {
      eventContractVersion: '1.0.0' as const,
      packageRef: reading.packageRef,
      learningRevision: 1,
    };
    expect(
      authority.issue({
        ...base,
        eventType: 'lesson.started',
        result: 'started',
        subjectRef: reading.catalog.lessons[0].ref,
      }),
    ).toBeDefined();
    expect(
      authority.issue({
        ...base,
        eventType: 'lesson.study-confirmed',
        result: 'confirmed',
        subjectRef: reading.catalog.lessons[0].ref,
      }),
    ).toBeDefined();
    expect(() =>
      authority.issue({
        ...base,
        eventType: 'exercise.passed',
        result: 'passed',
        subjectRef: reading.catalog.exercises[0].ref,
      }),
    ).toThrow('S_CONTENT_INCOMPATIBLE');
    expect(() =>
      authority.issue({
        ...base,
        eventType: 'case.view-confirmed',
        result: 'confirmed',
        subjectRef: reading.catalog.cases[0].ref,
      }),
    ).toThrow('S_CONTENT_INCOMPATIBLE');
  });
  it('also rejects a raw non-reading command inside the domain boundary', () => {
    const value = snapshot();
    value.goals.push({ localDate: '2026-10-19', goalVersion: 1, targets: null, achievedAt: null });
    const command: LearningCommand = {
      generation,
      receipt: {
        eventType: 'exercise.passed',
        result: 'passed',
        subjectRef: reading.catalog.exercises[0].ref,
        packageRef: reading.packageRef,
        learningRevision: 1,
        eventId: generation,
        goalVersion: 1,
        occurredAt: at,
        localDate: '2026-10-19',
      },
    };
    expect(() => applyLearningEvent(value, command, reading.catalog)).toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
  });
  it('requires both compatible confirmation and all required history; opening/confirmation alone cannot complete', () => {
    const value = snapshot();
    expect(projectLearning(value, reading.catalog).lessons[0].completed).toBe(false);
    value.progress.push(history('lesson.study-confirmed'));
    expect(projectLearning(value, reading.catalog).lessons[0].completed).toBe(false);
    value.progress.push(history('exercise.passed', '1.0.0'));
    expect(projectLearning(value, reading.catalog).lessons[0].completed).toBe(false);
    value.progress.push(history('exercise.passed'));
    const before = JSON.stringify(value);
    const projection = projectLearning(value, reading.catalog);
    expect(projection.lessons[0].completed).toBe(true);
    expect(projection.lessons[1].completed).toBe(false);
    expect(JSON.stringify(value)).toBe(before);
    expect(value.receipts).toEqual([]); // Deliberately synthetic history, never a production pass.
  });
  it('offers a stable continuation from compatible explicit activity and skips completed lessons', () => {
    const value = snapshot();
    expect(continueLesson(reading, projectLearning(value, reading.catalog))).toBe(
      reading.lessons[0].id,
    );
    value.progress.push(history('lesson.study-confirmed'));
    expect(continueLesson(reading, projectLearning(value, reading.catalog))).toBe(
      reading.lessons[0].id,
    );
    value.progress.push(history('exercise.passed'));
    expect(continueLesson(reading, projectLearning(value, reading.catalog))).toBe(
      reading.lessons[1].id,
    );
  });
  it('distinguishes unknown records, missing content, unfinished, completed and unsaved presentation', () => {
    const value = snapshot();
    const state = { projection: null } as LearningServiceState;
    expect(lessonProgress(state, reading.lessons[0].id)).toContain('尚未读取');
    state.projection = projectLearning(value, reading.catalog);
    expect(lessonProgress(state, 'lesson.c.missing')).toBe('课程内容缺失');
    expect(lessonProgress(state, reading.lessons[0].id)).toBe('未开始');
    value.progress.push(history('lesson.study-confirmed'), history('exercise.passed'));
    state.projection = projectLearning(value, reading.catalog);
    expect(lessonProgress(state, reading.lessons[0].id)).toBe('小节已完成');
    state.temporary = true;
    expect(lessonProgress(state, reading.lessons[0].id)).toContain('尚未保存');
  });
});
