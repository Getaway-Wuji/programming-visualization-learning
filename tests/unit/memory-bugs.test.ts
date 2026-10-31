import { afterAll, beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import * as wasm from '../../web/src/generated/memory/c_viz_memory';
import { engineBuild } from '../../web/src/generated/memory/engine-build';
import {
  MemoryBugClient,
  bugRequest,
  encodeBugRequest,
  decodeBugResult,
  acceptedBugJudgement,
} from '../../web/src/memory-bugs/protocol';
import {
  memoryBugQuestions,
  extendMemoryBugLearning,
  hasMemoryBugLearningSupplement,
} from '../../web/src/memory-bugs/content';
import { bugQuestions } from '../../web/src/bugs/content';
import { p05Catalog } from '../fixtures/p05-learning';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { decodeMemoryResult, type MemoryResult } from '../../web/src/engine/memory-protocol';
import {
  createMemoryBugPassAuthority,
  isMemoryBugPassFact,
} from '../../web/src/memory-bugs/authority';
import { MemoryBugHistory, emptyMemoryWorkspace } from '../../web/src/memory-bugs/history';
import type { EditorSnapshot } from '../../web/src/storage/editor-history';

const bytes = Uint8Array.from(readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm'));
const compiled = new WebAssembly.Module(bytes);
const raw: { request: unknown; resultBase64: string; sha256: string; bytes: number }[] = [];
const summaries: unknown[] = [];
const good = new Map<string, MemoryResult[]>();
const base = p05Catalog();
const old = {
  ...base,
  exercises: [
    ...base.exercises,
    ...bugQuestions.map((q) => ({
      ref: q.exerciseRef,
      lessonRef: base.exercises.find((e) => e.ref.id === q.baseExerciseRef.id)!.lessonRef,
      learningRevision: 1,
      acceptedPriorVersions: [],
      caseKeys: q.tests.map((t) => t.caseKey),
    })),
  ],
};
const catalog = extendMemoryBugLearning(old);
let memory: WebAssembly.Memory;
// This file is the declared controlled-clock semantic adapter. The real
// 1000ms native Worker/deadline path is tested separately in the browser.
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
afterEach(() => vi.useRealTimers());
beforeAll(() => {
  memory = wasm.initSync({ module: bytes }).memory;
});
afterAll(() => {
  const directory = `.artifacts/${process.env.TASK_EVIDENCE_TASK ?? '14.4'}`;
  mkdirSync(directory, { recursive: true });
  const label = process.env.TASK_EVIDENCE_LABEL ?? String(Date.now());
  const compressed = gzipSync(JSON.stringify(raw));
  writeFileSync(`${directory}/memory-bug-raw-${label}.json.gz`, compressed, { flag: 'wx' });
  writeFileSync(
    `${directory}/memory-bug-execution-${label}.json`,
    JSON.stringify(
      {
        semanticAdapter: true,
        clientClock: 'controlled; real browser checks actual 1000ms',
        buildId: engineBuild.wasmSha256,
        rawGzipSha256: createHash('sha256').update(compressed).digest('hex'),
        summaries,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
});
function client() {
  // Real public Rust/WASM and full consumer; the Node Worker transport and
  // client clock are controlled. Native Worker/deadline proof is browser QA.
  return new MemoryBugClient({
    now: () => 0,
    fetcher: async () => new Response(bytes, { headers: { 'content-type': 'application/wasm' } }),
    compile: async () => compiled,
    createWorker: () => {
      const worker = {
        onmessage: null as Worker['onmessage'],
        onerror: null,
        onmessageerror: null,
        terminate: vi.fn(),
        postMessage(message: {
          operationId: string;
          buffer: ArrayBuffer;
          buildId: string;
          remainingMs: number;
        }) {
          const request = JSON.parse(new TextDecoder().decode(message.buffer));
          const output = wasm
            .execute_memory_bug(
              new Uint8Array(message.buffer),
              message.buildId,
              message.remainingMs,
            )
            .slice();
          raw.push({
            request,
            resultBase64: Buffer.from(output).toString('base64'),
            sha256: createHash('sha256').update(output).digest('hex'),
            bytes: output.length,
          });
          worker.onmessage?.call(
            worker as unknown as Worker,
            new MessageEvent('message', {
              data: {
                ok: true,
                operationId: message.operationId,
                buffer: output.buffer,
                wasmPages: memory.buffer.byteLength / 65536,
              },
            }),
          );
        },
      };
      return worker as unknown as Worker;
    },
  });
}
for (const [index, q] of memoryBugQuestions.entries())
  it(`real memory Bug failure, two repairs, full inverse and non-teaching rejection: ${q.exerciseRef.id}`, async () => {
    const c = client(),
      first = q.tests[0];
    try {
      const broken = await c.execute(bugRequest(q, q.brokenSource, first.caseKey, 'broken.1'), 0);
      expect(broken.terminal.code).toBe(
        ['E_UNINITIALIZED', 'E_DANGLING_POINTER', 'E_STEP_LIMIT', 'E_STEP_LIMIT'][index],
      );
      expect(broken.trace?.completeness).toBe('prefix');
      expect(acceptedBugJudgement(broken)?.status).toBe('unmet');
      if (index >= 2) expect(broken.trace?.steps).toHaveLength(20000);
      const player = new MemoryPlayer();
      player.accept(broken);
      const initial = JSON.stringify(player.snapshot().state);
      for (let cursor = 1; cursor <= broken.trace!.steps.length; cursor++) player.seek(cursor);
      for (let cursor = broken.trace!.steps.length - 1; cursor >= 0; cursor--) player.seek(cursor);
      expect(JSON.stringify(player.snapshot().state)).toBe(initial);
      summaries.push({
        kind: 'broken',
        id: q.exerciseRef.id,
        terminal: broken.terminal,
        steps: broken.trace?.steps.length,
        restored: true,
      });
      for (const field of ['solutionSource', 'alternativeSource'] as const) {
        const results = [];
        for (const t of q.tests) {
          const result = await c.execute(bugRequest(q, q[field], t.caseKey, field), 0);
          expect(acceptedBugJudgement(result)?.status).toBe('met');
          expect(result.terminal.status).toBe('completed');
          results.push(result);
          summaries.push({
            kind: field,
            id: q.exerciseRef.id,
            caseKey: t.caseKey,
            status: acceptedBugJudgement(result)?.status,
          });
        }
        if (field === 'solutionSource') good.set(q.exerciseRef.id, results);
      }
      const falseSource =
        '#include <iostream>\nint main(){int x;std::cin>>x;std::cout<<0<<"\\n";return 0;}';
      const fake = await c.execute(bugRequest(q, falseSource, first.caseKey, 'fake.1'), 0);
      expect(acceptedBugJudgement(fake)?.status).toBe('unmet');
    } finally {
      c.invalidate();
    }
  }, 20000);
it('rejects identity/input/version additions and old consumers reject the companion', async () => {
  const q = memoryBugQuestions[0],
    request = bugRequest(q, q.solutionSource, q.tests[0].caseKey, 'source.1');
  for (const change of [
    (r: typeof request) => {
      r.input = [3];
    },
    (r: typeof request) => {
      r.bug.caseKey = 'foreign';
    },
    (r: typeof request) => {
      Object.assign(r.bug, { extra: true });
    },
  ]) {
    const copy = structuredClone(request);
    change(copy);
    expect(() => encodeBugRequest(copy)).toThrow();
  }
  const record = raw.find((r) => (r.request as typeof request).source === q.solutionSource)!;
  const buffer = Uint8Array.from(Buffer.from(record.resultBase64, 'base64')).buffer;
  const { bug: _, ...normal } = request;
  void _;
  await expect(decodeMemoryResult(buffer, normal, engineBuild.wasmSha256)).rejects.toThrow();
});
it('closed judgement refuses tampering or pretending a pointer error is met', async () => {
  const q = memoryBugQuestions[0],
    record = raw[0],
    request = record.request as ReturnType<typeof bugRequest>;
  for (const variant of ['case', 'extra', 'met']) {
    const r = JSON.parse(Buffer.from(record.resultBase64, 'base64').toString());
    if (variant === 'case') r.bugJudgement.caseKey = 'other';
    if (variant === 'extra') r.bugJudgement.extra = true;
    if (variant === 'met') {
      r.bugJudgement.status = 'met';
      r.bugJudgement.checks.forEach((c: { met: boolean }) => (c.met = true));
    }
    const encoded = new TextEncoder().encode(JSON.stringify(r));
    await expect(
      decodeBugResult(encoded.buffer, request, engineBuild.wasmSha256),
    ).rejects.toThrow();
  }
  expect(q.exerciseRef.id).toContain('uninitialized');
});
it('precise 40 identities preserve the original36 and refuse field/version/parent/case drift', () => {
  expect(catalog.exercises.slice(0, 36)).toEqual(old.exercises);
  expect(catalog.lessons).toEqual(base.lessons);
  expect(hasMemoryBugLearningSupplement(catalog.exercises)).toBe(true);
  for (const field of ['ref', 'parent', 'lr', 'case', 'missing']) {
    const copy = catalog.exercises.map((e) =>
      structuredClone({ ...e, ref: { ...e.ref }, lessonRef: { ...e.lessonRef } }),
    );
    if (field === 'ref') copy[36].ref.version = '9.0.0';
    if (field === 'parent') copy[36].lessonRef = { id: 'lesson.c.echo', version: '1.1.0' };
    if (field === 'lr') Object.assign(copy[36], { learningRevision: 2 });
    if (field === 'case') Object.assign(copy[36], { caseKeys: ['other'] });
    if (field === 'missing') copy.pop();
    expect(hasMemoryBugLearningSupplement(copy)).toBe(false);
  }
});
it('private pass capability requires four actual accepted results and live ownership', () => {
  const q = memoryBugQuestions[0],
    results = good.get(q.exerciseRef.id)!;
  const owner = createMemoryBugPassAuthority(catalog, () => ({
    exerciseId: q.exerciseRef.id,
    results,
    current: true,
  }));
  expect(isMemoryBugPassFact(owner.issue())).toBe(true);
  expect(() =>
    createMemoryBugPassAuthority(
      { ...catalog, packageRef: { id: 'content.cpp.foreign', version: '1.0.0' } },
      () => ({ exerciseId: q.exerciseRef.id, results, current: true }),
    ).issue(),
  ).toThrow();
  for (const evidence of [
    { results: structuredClone(results), current: true },
    { results, current: false },
    { results: results.slice(0, 3), current: true },
  ])
    expect(() =>
      createMemoryBugPassAuthority(catalog, () => ({
        exerciseId: q.exerciseRef.id,
        ...evidence,
      })).issue(),
    ).toThrow();
  expect(() => {
    acceptedBugJudgement(results[0])!.exerciseRef.id = 'foreign';
  }).toThrow();
});
it('code-only history keeps original text and rejects old generations or foreign input', async () => {
  const q = memoryBugQuestions[0],
    generation = crypto.randomUUID();
  let row: EditorSnapshot | undefined;
  const port = {
    context: () => ({ generation, activePackageRef: catalog.packageRef, epoch: 1 }),
    read: async () => (row ? [row] : []),
    save: vi.fn(async (_ctx: unknown, draft: Omit<EditorSnapshot, 'sequence'>) => {
      row = { ...draft, sequence: 1 };
      return { saved: true as const, record: row, pruned: 0 };
    }),
  };
  const history = new MemoryBugHistory(q, port);
  await history.reload();
  history.capture(q.brokenSource, q.tests[0].caseKey, 'code', 1);
  await vi.waitFor(() => expect(history.getSnapshot().status).toBe('ready'));
  expect(row?.codeText).toBe(q.brokenSource);
  expect(row?.workspaceJson).toBe(emptyMemoryWorkspace);
  expect(history.restoreCandidate(row!.entryId)?.row.codeText).toBe(q.brokenSource);
  row!.inputJson = JSON.stringify({ caseKey: 'foreign', input: [3] });
  await history.reload();
  expect(history.restoreCandidate(row!.entryId)).toBeNull();
});
