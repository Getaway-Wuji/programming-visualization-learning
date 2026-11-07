import { observedC6Execution } from './c6-execution-observation';
import { installC6Packets } from './c6-observation';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { decodeC6Response, type C6JudgeRequest } from '../../web/src/engine/c6-protocol';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';
import type { LedgerEntry, Progress } from '../../web/src/storage/model';
import {
  assertCompleteC6Replay,
  currentSource,
  expectCurrentSource,
  submitCurrentVerdict,
} from './current-c6-ui';

const source = JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
  chapters: { exercises: C6CourseExercise[] }[];
};
const exercises = source.chapters.flatMap((chapter) => chapter.exercises);
if (exercises.length !== 44) throw new Error('Current reviewed exercise count changed');
const index = JSON.parse(readFileSync('content/c/primer6-learning/index-1.0.0.json', 'utf8')) as {
  rewardGroups: {
    exerciseRefs: { id: string }[];
    exerciseReward: { sourceId: string; subjectId: string; points: number };
  }[];
};

for (const exercise of exercises) {
  test(`current book ${exercise.ref.id}: real four-case UI, complete packet replay and durable save`, async ({
    page,
  }, info) => {
    await page.addInitScript(installC6Packets);
    await page.goto(`/#/practice/${exercise.ref.id}`);
    const editor = currentSource(page);
    await expectCurrentSource(page, exercise.starterSource);
    await editor.fill(exercise.referenceSource);
    await submitCurrentVerdict(page);
    await expect(page.locator('.c6-trace')).toHaveCount(0);
    const captured = await observedC6Execution(page, 'judge');
    expect(captured.request).not.toBeNull();
    expect(captured.response).not.toBeNull();
    const request = JSON.parse(
      Buffer.from(captured.request!, 'base64').toString('utf8'),
    ) as C6JudgeRequest;
    expect(request.source).toBe(exercise.referenceSource);
    expect(request.profileRef).toEqual(exercise.profileRef);
    const bytes = Uint8Array.from(Buffer.from(captured.response!, 'base64'));
    const result = await decodeC6Response(bytes.buffer, request, engineBuild.wasmSha256);
    expect('cases' in result && result.status).toBe('passed');
    if (!('cases' in result)) throw new Error('Expected actual judge packet');
    expect(result.cases).toHaveLength(4);
    expect(result.aggregate.resultBytes).toBe(bytes.length);
    for (const [index, actual] of result.cases.entries()) {
      expect(actual.packet.engine.buildId).toBe(engineBuild.wasmSha256);
      expect(actual.packet.terminal.status).toBe('completed');
      expect(actual.packet.trace?.completeness).toBe('complete');
      assertCompleteC6Replay(actual.packet, exercise.tests[index].expectedStdout);
    }
    await info.attach('real-current-course-worker-packet', {
      body: gzipSync(JSON.stringify(captured)),
      contentType: 'application/gzip',
    });
    const archive = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('c-viz-learning');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction(['meta', 'progress', 'ledger'], 'readonly');
        const values = await Promise.all(
          ['meta', 'progress', 'ledger'].map(
            (name) =>
              new Promise<unknown>((resolve, reject) => {
                const request =
                  name === 'meta'
                    ? tx.objectStore(name).get('current')
                    : tx.objectStore(name).getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              }),
          ),
        );
        return {
          dbVersion: db.version,
          stores: Array.from(db.objectStoreNames),
          meta: values[0] as {
            schemaVersion: string;
            activePackageRef: { id: string; version: string };
          },
          progress: values[1] as Progress[],
          ledger: values[2] as LedgerEntry[],
        };
      } finally {
        db.close();
      }
    });
    expect(archive.dbVersion).toBe(14);
    expect(archive.stores).toHaveLength(27);
    expect(archive.meta).toMatchObject({
      schemaVersion: '14.0.0',
      activePackageRef: { id: 'content.c.primer6', version: '2.0.0' },
    });
    expect(
      archive.progress.filter((p) => p.eventType === 'exercise.passed').map((p) => p.subjectRef),
    ).toEqual([exercise.ref]);
    expect(archive.progress.filter((p) => p.eventType === 'lesson.completed')).toEqual([]);
    const group = index.rewardGroups.find((g) =>
      g.exerciseRefs.some((r) => r.id === exercise.ref.id),
    )!;
    expect(archive.ledger).toHaveLength(1);
    expect(archive.ledger[0]).toMatchObject({ ...group.exerciseReward, status: 'posted' });
    await info.attach('native-current-save-and-group-award', {
      body: JSON.stringify(archive),
      contentType: 'application/json',
    });
    await page.goto('/#/');
    await page.reload();
    await expect(
      page.getByRole('progressbar', { name: 'C 课程完成进度', exact: true }),
    ).toHaveAttribute('value', '0');
  });
}
