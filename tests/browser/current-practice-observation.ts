import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { C6CourseExercise } from '../../web/src/content/c6-course-types';
import type { StorageSnapshot, Receipt } from '../../web/src/storage/model';
import type { C6CourseActivity, C6CourseDraft } from '../../web/src/c6-learning/model';
import type { EditorSnapshot } from '../../web/src/storage/editor-history';
import {
  decodeC6Response,
  type C6JudgeRequest,
  type C6RunRequest,
} from '../../web/src/engine/c6-protocol';
import { observedC6Packet } from './c6-observation';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';

export type CurrentSnapshot = StorageSnapshot & {
  editHistory: EditorSnapshot[];
  courseActivities: C6CourseActivity[];
  courseDrafts: C6CourseDraft[];
};
/** Read all native stores without creating any execution or learning evidence. */
export async function currentSnapshot(page: Page): Promise<CurrentSnapshot> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('c-viz-learning');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      const names = Array.from(db.objectStoreNames),
        tx = db.transaction(names, 'readonly');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      const rows = await Promise.all(
        names.map(async (name) => [
          name,
          await new Promise<unknown>((resolve, reject) => {
            const store = tx.objectStore(name),
              r = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
                ? store.get('current')
                : store.getAll();
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
        ]),
      );
      await done;
      return Object.fromEntries(rows) as unknown as CurrentSnapshot;
    } finally {
      db.close();
    }
  });
}
export const currentLocalReady = (page: Page) =>
  expect(page.locator('.app-shell')).toHaveAttribute('data-learning-storage-status', 'ready');
export async function assertCurrentRun(page: Page, source: string, input: string) {
  const raw = await observedC6Packet(page);
  expect(raw).toMatchObject({ moduleSeen: true, terminated: true });
  const req = Buffer.from(raw.request!, 'base64'),
    res = Buffer.from(raw.response!, 'base64');
  const request = JSON.parse(req.toString('utf8')) as C6RunRequest;
  expect(request.source).toBe(source);
  expect(request.input).toEqual({ kind: 'stdin-ascii', text: input });
  const result = await decodeC6Response(
    Uint8Array.from(res).buffer,
    request,
    engineBuild.wasmSha256,
  );
  if ('cases' in result || 'editVersion' in result) throw Error('Actual single run required');
  expect(result.terminal.status).toBe('completed');
  await test
    .info()
    .attach(`${request.runId}-request`, { body: req, contentType: 'application/json' });
  await test
    .info()
    .attach(`${request.runId}-response`, { body: res, contentType: 'application/json' });
  return { request, result };
}
export async function currentJudgeCount(page: Page) {
  return page.evaluate(
    () =>
      window.c6CurrentPackets.filter(
        (p) => p.request && 'judgeVersion' in JSON.parse(new TextDecoder().decode(p.request)),
      ).length,
  );
}
/** Deferred passive IPC extraction; the production decoder also checks full reversal. */
export async function assertCurrentJudge(
  page: Page,
  exercise: C6CourseExercise,
  status: 'passed' | 'failed',
  source = exercise.referenceSource,
  index = -1,
) {
  const raw = await page.evaluate((index) => {
    const packets = window.c6CurrentPackets.filter(
      (p) => p.request && 'judgeVersion' in JSON.parse(new TextDecoder().decode(p.request)),
    );
    const p = packets.at(index);
    if (!p?.request || !p.response) throw Error('Actual C6 judge IPC required');
    const encode = (b: ArrayBuffer) => {
      let s = '';
      const bytes = new Uint8Array(b);
      for (let i = 0; i < bytes.length; i += 16384)
        s += String.fromCharCode(...bytes.subarray(i, i + 16384));
      return btoa(s);
    };
    return {
      moduleSeen: p.moduleSeen,
      terminated: p.terminated,
      request: encode(p.request),
      response: encode(p.response),
    };
  }, index);
  expect(raw).toMatchObject({ moduleSeen: true, terminated: true });
  const requestBytes = Buffer.from(raw.request, 'base64'),
    responseBytes = Buffer.from(raw.response, 'base64');
  const request = JSON.parse(requestBytes.toString('utf8')) as C6JudgeRequest;
  expect(request.source).toBe(source);
  expect(request.sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
  expect(request.profileRef).toEqual(exercise.profileRef);
  const result = await decodeC6Response(
    Uint8Array.from(responseBytes).buffer,
    request,
    engineBuild.wasmSha256,
  );
  if (!('cases' in result)) throw Error('Actual four-case judge response required');
  expect(result.status).toBe(status);
  if (status === 'passed') {
    expect(result.cases).toHaveLength(4);
    expect(result.cases.map((c) => c.caseKey)).toEqual(exercise.tests.map((t) => t.caseKey));
    for (const [i, c] of result.cases.entries()) {
      expect(c.stdoutMatches && c.returnMatches && c.observationMatches).toBe(true);
      expect(c.packet.terminal.status).toBe('completed');
      const output =
        c.packet.trace!.initialState.output +
        c.packet
          .trace!.steps.flatMap((s) =>
            s.changes.flatMap((v) => (v.op === 'output' ? [v.append] : [])),
          )
          .join('');
      expect(output).toBe(exercise.tests[i].expectedStdout);
    }
  } else
    expect(
      result.cases.some((c) => !c.stdoutMatches || !c.returnMatches || !c.observationMatches),
    ).toBe(true);
  await test
    .info()
    .attach(`${request.runId}-request`, { body: requestBytes, contentType: 'application/json' });
  await test
    .info()
    .attach(`${request.runId}-response`, { body: responseBytes, contentType: 'application/json' });
  return { request, result };
}
export function assertNoExecutionPersistence(
  data: CurrentSnapshot,
  sources: string[],
  exercises: C6CourseExercise[],
) {
  const hashes = sources.map((s) => createHash('sha256').update(s).digest('hex'));
  const activities = data.courseActivities.map((row) => {
    if (row.kind !== 'exercise') return row;
    const metadata = (a: typeof row.firstPass) => {
      if (!a) return null;
      expect(hashes).toContain(a.sourceSha256);
      expect(a.sourceRevision).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/);
      expect(a.engineBuildSha256).toBe(engineBuild.wasmSha256);
      expect(a.profileRef).toEqual(
        exercises.find((e) => e.ref.id === row.subjectRef.id)!.profileRef,
      );
      const { sourceRevision, sourceSha256, ...rest } = a;
      void sourceRevision;
      void sourceSha256;
      return rest;
    };
    return {
      ...row,
      firstPass: metadata(row.firstPass),
      latestAttempt: metadata(row.latestAttempt),
    };
  });
  expect(data.courseDrafts).toEqual([]);
  const keys = (v: unknown): string[] =>
    v && typeof v === 'object' ? Object.entries(v).flatMap(([k, c]) => [k, ...keys(c)]) : [];
  const forbidden = [
    'source',
    'sourceSha256',
    'input',
    'seed',
    'stdout',
    'trace',
    'ast',
    'nodeMap',
    'checks',
    'coverage',
    'submissionId',
    'runId',
    'contextId',
    'sourceRevision',
    'workspace',
  ];
  expect(
    keys({ ...data, courseActivities: activities }).filter((k) => forbidden.includes(k)),
  ).toEqual([]);
  for (const row of data.ledger) {
    expect(row.status).toBe('posted');
    expect(row.points).toBe(
      row.sourceId === 'reward.exercise.first-pass'
        ? 10
        : row.sourceId === 'reward.lesson.first-completion'
          ? 20
          : row.sourceId === 'reward.daily-goal.once' || row.sourceId === 'reward.case.first-view'
            ? 5
            : Number.NaN,
    );
    expect(row.policyRef).toEqual({
      id:
        row.sourceId === 'reward.daily-goal.once'
          ? 'reward.policy.daily-goal.p0'
          : 'reward.policy.p0',
      version: '1.0.0',
    });
  }
}
export function assertLearningEqual(before: CurrentSnapshot, after: CurrentSnapshot) {
  for (const store of [
    'progress',
    'receipts',
    'ledger',
    'dailyFacts',
    'courseActivities',
    'courseDrafts',
  ] as const)
    expect(after[store]).toEqual(before[store]);
}
export interface CurrentReceiptFault {
  armed: boolean;
  attempted: Receipt[];
}
export async function installCurrentReceiptFault(page: Page) {
  await page.addInitScript(() => {
    const state: CurrentReceiptFault = { armed: false, attempted: [] };
    Object.assign(window, { __currentReceiptFault: state });
    for (const method of ['add', 'put'] as const) {
      const native = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (value, key) {
        if (this.name === 'receipts' && (value as Receipt)?.eventType === 'exercise.passed') {
          state.attempted.push(structuredClone(value as Receipt));
          if (state.armed) {
            state.armed = false;
            throw new DOMException('Native current receipt quota injection', 'QuotaExceededError');
          }
        }
        return key === undefined ? native.call(this, value) : native.call(this, value, key);
      };
    }
  });
}
export const currentReceiptFault = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __currentReceiptFault: CurrentReceiptFault }).__currentReceiptFault,
  );
export const armCurrentReceiptFault = (page: Page) =>
  page.evaluate(() => {
    (
      window as unknown as { __currentReceiptFault: CurrentReceiptFault }
    ).__currentReceiptFault.armed = true;
  });

interface CurrentRunGate {
  armed: boolean;
  held: number;
  terminated: boolean;
  request: ArrayBuffer | null;
  response: ArrayBuffer | null;
  release(): void;
}
declare global {
  interface Window {
    currentRunGate: CurrentRunGate;
  }
}
/** Delay only one unchanged genuine response, keeping the original deadline. */
export async function installCurrentRunGate(page: Page, target: 'judge' | 'run' = 'judge') {
  await page.addInitScript((target) => {
    const pending: (() => void)[] = [];
    const gate: CurrentRunGate = {
      armed: false,
      held: 0,
      terminated: false,
      request: null,
      response: null,
      release() {
        pending.splice(0).forEach((fn) => fn());
        gate.held = 0;
      },
    };
    window.currentRunGate = gate;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private matches = false;
      private bytes: ArrayBuffer | null = null;
      private wasHeld = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (!this.matches || !gate.armed || !this.onmessage) return;
          const data = event.data as { buffer?: ArrayBuffer };
          if (!(data.buffer instanceof ArrayBuffer)) return;
          gate.armed = false;
          gate.held++;
          gate.request = this.bytes;
          gate.response = data.buffer.slice(0);
          this.wasHeld = true;
          const handler = this.onmessage;
          event.stopImmediatePropagation();
          pending.push(() => handler.call(this, event));
        });
      }
      postMessage(value: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        if (
          value &&
          typeof value === 'object' &&
          'buffer' in value &&
          value.buffer instanceof ArrayBuffer
        ) {
          const request = JSON.parse(new TextDecoder().decode(value.buffer));
          this.matches =
            target === 'judge'
              ? 'judgeVersion' in request
              : 'execVersion' in request && !('judgeVersion' in request);
          if (this.matches) this.bytes = value.buffer.slice(0);
        }
        if (Array.isArray(options)) super.postMessage(value, options);
        else super.postMessage(value, options);
      }
      terminate() {
        if (this.wasHeld) gate.terminated = true;
        super.terminate();
      }
    };
  }, target);
}
export async function heldCurrentResult(page: Page) {
  const raw = await page.evaluate(() => {
    const g = window.currentRunGate;
    if (!g.request || !g.response) throw Error('Held genuine IPC required');
    const encode = (b: ArrayBuffer) => {
      let s = '';
      const a = new Uint8Array(b);
      for (let i = 0; i < a.length; i += 16384)
        s += String.fromCharCode(...a.subarray(i, i + 16384));
      return btoa(s);
    };
    return { request: encode(g.request), response: encode(g.response), terminated: g.terminated };
  });
  const req = Buffer.from(raw.request, 'base64'),
    res = Buffer.from(raw.response, 'base64');
  const request = JSON.parse(req.toString('utf8')) as C6JudgeRequest;
  const result = await decodeC6Response(
    Uint8Array.from(res).buffer,
    request,
    engineBuild.wasmSha256,
  );
  await test.info().attach('held-genuine-request', { body: req, contentType: 'application/json' });
  await test.info().attach('held-genuine-response', { body: res, contentType: 'application/json' });
  return { ...raw, request, result };
}
