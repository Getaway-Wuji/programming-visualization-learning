import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { pythonLessonIds } from '../../web/src/python3/release.generated';
import { javaLessonIds } from '../../web/src/java/release.generated';
import { cppLessonIds } from '../../web/src/cpp-course/release.generated';
import { rust2018LessonIds } from '../../web/src/rust2018-course/release.generated';
import { mysqlLessonIds } from '../../web/src/mysql-course/release.generated';

const cases = [
  [
    'Python',
    '../../web/src/python3/session',
    'PythonLearningSession',
    'recordPythonLesson',
    pythonLessonIds[0],
  ],
  [
    'Java',
    '../../web/src/java/session',
    'JavaLearningSession',
    'recordJavaLesson',
    javaLessonIds[0],
  ],
  ['C++', '../../web/src/java/session', 'JavaLearningSession', 'recordCppLesson', cppLessonIds[0]],
  [
    'Rust',
    '../../web/src/learning/rust2018-session',
    'RustLearningSession',
    'recordRustLesson',
    rust2018LessonIds[0],
  ],
  [
    'MySQL',
    '../../web/src/learning/mysql-session',
    'MysqlLearningSession',
    'recordMysqlLesson',
    mysqlLessonIds[0],
  ],
] as const;
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const catalog = () =>
  createLearningCatalog({
    purpose: 'contract-fixture',
    packageRef: { id: 'content.synthetic.lazy-time', version: '1.0.0' },
    lessons: [],
    exercises: [],
    cases: [],
  });
afterEach(() => {
  for (const path of new Set(cases.map((entry) => entry[1]))) vi.doUnmock(path);
  vi.resetModules();
});

describe('language session loading keeps the original reading occurrence and epoch', () => {
  for (const [language, path, constructor, method, lesson] of cases) {
    it(`${language}: captures the reading time before a delayed module finishes across midnight`, async () => {
      vi.resetModules();
      const gate = deferred();
      const entered = deferred();
      const record = vi.fn(async (...args: unknown[]) => args);
      vi.doMock(path, async () => {
        entered.release();
        await gate.promise;
        // Only the service delegation boundary is mocked here. Existing real
        // session suites validate receipt dates and storage transactions.
        return {
          [constructor]: class {
            recordLesson = record;
          },
        };
      });
      const { LearningService } = await import('../../web/src/learning/service');
      let now = '2026-11-09T15:59:59.990Z'; // 23:59:59.990 in Asia/Shanghai
      const service = new LearningService({ catalog: catalog(), clock: () => now });
      try {
        const pending = service[method](lesson, service.getState().sessionEpoch);
        await entered.promise;
        expect(record).not.toHaveBeenCalled();
        now = '2026-11-09T16:00:01.000Z';
        gate.release();
        await pending;
        expect(record).toHaveBeenCalledExactlyOnceWith(lesson, 0, '2026-11-09T15:59:59.990Z');
      } finally {
        service.dispose();
      }
    });

    it(`${language}: a session loaded after clear still rejects the old reading epoch`, async () => {
      vi.resetModules();
      const gate = deferred();
      const entered = deferred();
      vi.doMock(path, async (original) => {
        entered.release();
        await gate.promise;
        return original();
      });
      const { LearningService } = await import('../../web/src/learning/service');
      const service = new LearningService({
        catalog: catalog(),
        clock: () => '2026-11-09T15:59:59.990Z',
      });
      try {
        const epoch = service.getState().sessionEpoch;
        const pending = service[method](lesson, epoch);
        await entered.promise;
        // No real storage is opened. The public clear operation must advance
        // its invalidation barrier synchronously, even before the queue runs.
        const clear = service.clearLocalData();
        expect(service.getState().sessionEpoch).toBeGreaterThan(epoch);
        const rejected = expect(pending).rejects.toThrow('S_GENERATION_STALE');
        gate.release();
        await Promise.all([rejected, clear]);
      } finally {
        service.dispose();
      }
    });
  }
});
