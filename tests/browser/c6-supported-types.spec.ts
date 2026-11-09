import { observedC6Execution } from './c6-execution-observation';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { decodeC6Response, type C6Request } from '../../web/src/engine/c6-protocol';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';
import { installC6Packets } from './c6-observation';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import { assertCompleteC6Replay, currentSource, submitCurrentVerdict } from './current-c6-ui';

const programs = JSON.parse(
  readFileSync('tests/fixtures/c6-current-browser-programs.json', 'utf8'),
) as {
  id: string;
  code: string;
  stdout?: string;
  judge?: boolean;
}[];
const source = JSON.parse(readFileSync('content/c/primer6-teaching/source-2.0.0.json', 'utf8')) as {
  chapters: { exercises: C6CourseExercise[] }[];
};
const exercise = source.chapters
  .flatMap((c) => c.exercises)
  .find((e) => e.ref.id === 'exercise.c6.s10.1.1')!;

for (const program of programs) {
  test(`current supported C6 ${program.id}: real typed output, complete reverse and actual learning boundary`, async ({
    page,
  }, info) => {
    await page.addInitScript(installC6Packets);
    await page.goto(
      program.judge
        ? '/#/practice/' + exercise.ref.id
        : '/#/c6/program/teach.c6.ch01.welcome?node=c6.ch01',
    );
    const editor = currentSource(page);
    await editor.fill(program.code);
    if (program.judge) await submitCurrentVerdict(page);
    else {
      await page.locator('#c6-stdin').fill('');
      await page.getByRole('button', { name: '运行当前代码', exact: true }).click();
    }
    const trace = page.locator('.c6-trace');
    if (!program.judge) await expect(trace).toBeVisible();
    if (program.judge) {
      await expect(page.getByTestId('oj-verdict')).toHaveText('通过');
    }
    const captured = await observedC6Execution(page, program.judge ? 'judge' : 'run');
    expect(captured.request).not.toBeNull();
    expect(captured.response).not.toBeNull();
    const request = JSON.parse(
      Buffer.from(captured.request!, 'base64').toString('utf8'),
    ) as C6Request;
    expect(request.source).toBe(program.code);
    const raw = Uint8Array.from(Buffer.from(captured.response!, 'base64'));
    const response = await decodeC6Response(raw.buffer, request, engineBuild.wasmSha256);
    if ('editVersion' in response)
      throw Error('A real execution, not an EDIT response, is required');
    const packets = 'cases' in response ? response.cases.map((c) => c.packet) : [response];
    if (program.judge) {
      expect('cases' in response && response.status === 'passed').toBe(true);
      expect(packets).toHaveLength(4);
    }
    for (const [i, packet] of packets.entries()) {
      expect(packet.engine.buildId).toBe(engineBuild.wasmSha256);
      expect(packet.terminal.status).toBe('completed');
      const output =
        packet.trace!.initialState.output +
        packet
          .trace!.steps.flatMap((s) =>
            s.changes.flatMap((c) => (c.op === 'output' ? [c.append] : [])),
          )
          .join('');
      expect(output).toBe(program.judge ? exercise.tests[i].expectedStdout : program.stdout);
      assertCompleteC6Replay(packet, output);
    }
    if (!program.judge) {
      const initial = await trace.textContent();
      await trace.getByRole('button', { name: '到本次末尾', exact: true }).click();
      await expect(trace).toHaveAttribute('data-cursor', String(packets[0].trace!.steps.length));
      await expect(trace.getByLabel('当前游标标准输出', { exact: true })).toHaveText(
        program.judge ? exercise.tests[0].expectedStdout : program.stdout!,
      );
      await trace.getByRole('button', { name: '回到开始', exact: true }).click();
      await expect(trace).toHaveAttribute('data-cursor', '0');
      expect(await trace.textContent()).toBe(initial);
    }
    const archive = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open('c-viz-learning');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        const names = ['progress', 'ledger', 'receipts', 'dailyFacts'];
        const tx = db.transaction(names, 'readonly');
        const done = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
        const rows = Object.fromEntries(
          await Promise.all(
            names.map(
              (name) =>
                new Promise<[string, unknown[]]>((resolve, reject) => {
                  const r = tx.objectStore(name).getAll();
                  r.onsuccess = () => resolve([name, r.result]);
                  r.onerror = () => reject(r.error);
                }),
            ),
          ),
        );
        await done;
        return { dbVersion: db.version, stores: [...db.objectStoreNames], rows };
      } finally {
        db.close();
      }
    });
    expect(archive.dbVersion).toBe(15);
    expect(archive.stores).toHaveLength(29);
    if (!program.judge) for (const rows of Object.values(archive.rows)) expect(rows).toEqual([]);
    else {
      expect(archive.rows.progress).toHaveLength(1);
      expect(archive.rows.progress[0]).toMatchObject({
        eventType: 'exercise.passed',
        subjectRef: exercise.ref,
      });
      expect(archive.rows.ledger).toHaveLength(1);
      expect(archive.rows.ledger[0]).toMatchObject({ status: 'posted', points: 10 });
    }
    await info.attach('actual-ipc-and-native-archive', {
      body: gzipSync(JSON.stringify({ program, captured, archive })),
      contentType: 'application/gzip',
    });
  });
}
