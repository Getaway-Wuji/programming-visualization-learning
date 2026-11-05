import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initSync, practice_job } from '../../web/src/generated/practice/c_viz_practice';
import { engineBuild } from '../../web/src/generated/practice/engine-build';
import {
  decodePracticeResponse,
  encodePracticeRequest,
  type PracticeRequest,
  type GeneratedProblem,
  type PracticeResponse,
} from '../../web/src/generated-practice/protocol';
import { GeneratedPracticeController } from '../../web/src/generated-practice/controller';
import { PracticeClient } from '../../web/src/generated-practice/client';
import { claimEngineSlot } from '../../web/src/engine/module';

initSync({
  module: new WebAssembly.Module(
    new Uint8Array(readFileSync('web/src/generated/practice/c_viz_practice_bg.wasm')),
  ),
});
const base = {
  generatorVersion: '1.0.0' as const,
  requestId: 'test.gen',
  operation: 'generate' as const,
  knowledgeId: 'knowledge.c.expressions',
  difficulty: 1 as const,
  seed: '42',
};
function raw(req: PracticeRequest) {
  return practice_job(encodePracticeRequest(req), engineBuild.wasmSha256, 1000).slice().buffer;
}
async function run(req: PracticeRequest, p?: GeneratedProblem) {
  return decodePracticeResponse(raw(req), req, engineBuild.wasmSha256, () => {}, p);
}
async function generate(patch: Partial<typeof base> = {}) {
  const r = await run({ ...base, ...patch });
  if (r.operation !== 'generate') throw Error();
  return r.problem;
}
function grade(
  p: GeneratedProblem,
  source = p.referenceSource,
): Extract<PracticeRequest, { operation: 'grade' | 'preview' }> {
  return {
    ...base,
    knowledgeId: p.knowledgeIds[0],
    difficulty: p.difficulty,
    seed: p.seed,
    operation: 'grade',
    problemId: p.problemId,
    attemptId: 'attempt1',
    sourceRevision: 'revision1',
    source,
  };
}
function assessment(r: PracticeResponse) {
  if (r.operation === 'generate') throw Error();
  return r.assessment;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const selections = [
  'knowledge.c.expressions',
  'knowledge.c.conditions',
  'knowledge.c.loops',
].flatMap((knowledgeId) =>
  ([1, 2] as const).flatMap((difficulty) =>
    ['0', '4294967295'].map((seed) => ({ knowledgeId, difficulty, seed })),
  ),
);
test.each(selections)(
  'actual fifth WASM generates and grades entire finite domain $knowledgeId d$difficulty s$seed',
  async (selection) => {
    const req: PracticeRequest = { ...base, ...selection };
    const generated = await run(req);
    if (generated.operation !== 'generate') throw Error();
    const p = generated.problem,
      a = assessment(await run(grade(p), p));
    expect(p.validation.checkedCases).toBe(p.inputMax - p.inputMin + 1);
    expect(a).toMatchObject({
      verdict: 'passed',
      complete: true,
      checkedCases: p.cases.length,
      passedCases: p.cases.length,
    });
    expect(a.replay.result.engine.buildId).toBe(engineBuild.wasmSha256);
    const c = new GeneratedPracticeController();
    c.invalidate();
  },
);
test('normalized seed aliases produce identical Rust problems, different seeds change real content', async () => {
  expect(await generate({ seed: '00042' })).toEqual(await generate());
  const a = await generate(),
    b = await generate({ seed: '43' });
  expect(a.parameters).not.toEqual(b.parameters);
  expect(a.cases).not.toEqual(b.cases);
});
test.each(['-1', '+1', ' 1', '1 ', '1e2', '4294967296', ''])(
  'Rust rejects invalid seed %j',
  (seed) => {
    expect(() => raw({ ...base, seed })).toThrow('E_GEN_SEED');
  },
);
test('minimal request rejects archive fields, duplicate keys, unknown knowledge and invalid difficulty', () => {
  expect(() => encodePracticeRequest({ ...base, history: [] } as PracticeRequest)).toThrow(
    'E_PROTOCOL_INVALID',
  );
  expect(() =>
    practice_job(
      new TextEncoder().encode(
        JSON.stringify(base).replace('"seed":"42"', '"seed":"42","seed":"43"'),
      ),
      engineBuild.wasmSha256,
      1000,
    ),
  ).toThrow('E_PROTOCOL_INVALID');
  expect(() => raw({ ...base, knowledgeId: 'knowledge.c.arrays' })).toThrow('E_GEN_KNOWLEDGE');
  expect(() => raw({ ...base, difficulty: 3 } as unknown as PracticeRequest)).toThrow(
    'E_PROTOCOL_INVALID',
  );
});
test('wrong answer is repaired only by a new real full run; preview never grants completion', async () => {
  const p = await generate();
  const wrong = assessment(
    await run(grade(p, '#include <stdio.h>\nint main(){printf("0\\n");return 0;}'), p),
  );
  expect(wrong.verdict).toBe('unmet');
  expect(wrong.passedCases).toBeLessThan(p.cases.length);
  const preview: PracticeRequest = { ...grade(p), operation: 'preview', inputText: '0' };
  expect(assessment(await run(preview, p))).toMatchObject({ complete: false, checkedCases: 1 });
  expect(assessment(await run(grade(p), p)).verdict).toBe('passed');
});
test.each(['', '1 2', '1,2', '1e0', '+1', '13', '-13', '1.0'])(
  'Rust rejects raw invalid preview %j',
  async (inputText) => {
    const p = await generate();
    expect(() => raw({ ...grade(p), operation: 'preview', inputText })).toThrow('E_GEN_INPUT');
  },
);
test('program diagnostic, nonzero return and budget stop never become passes', async () => {
  const p = await generate();
  for (const source of ['int main( {', 'int main(){return 3;}']) {
    const a = assessment(await run(grade(p, source), p));
    expect(a.verdict).not.toBe('passed');
    expect(a.complete).toBe(false);
  }
  try {
    const a = assessment(await run(grade(p, 'int main(){while(1){}return 0;}'), p));
    expect(a.verdict).toBe('limited');
    expect(a.complete).toBe(false);
  } catch (e) {
    expect(String(e)).toMatch(/E_(FUEL_LIMIT|DEADLINE|STEP_LIMIT)/);
  }
});
test('validator rejects forged identities, expected output, count, producer and trace inverse', async () => {
  const p = await generate(),
    req = grade(p),
    original = JSON.parse(new TextDecoder().decode(raw(req)));
  const mutations: ((r: typeof original) => void)[] = [
    (r) => (r.producer = 'javascript'),
    (r) => (r.assessment.problemId += 'x'),
    (r) => r.assessment.passedCases--,
    (r) => (r.assessment.results[0].expectedStdout = '999\n'),
    (r) => (r.assessment.replay.request.source = 'int main(){return 0;}'),
    (r) => (r.assessment.replay.result.trace.steps[0].beforeHash = '0'.repeat(64)),
  ];
  for (const mutate of mutations) {
    const r = structuredClone(original);
    mutate(r);
    await expect(
      decodePracticeResponse(
        new TextEncoder().encode(JSON.stringify(r)).buffer,
        req,
        engineBuild.wasmSha256,
        () => {},
        p,
      ),
    ).rejects.toThrow();
  }
});
test('controller consumes the full reversible state and invalidates source, input, selection and clear', async () => {
  const client = new PracticeClient();
  vi.spyOn(client, 'run').mockImplementation(run);
  const c = new GeneratedPracticeController(client);
  await c.run('generate');
  c.edit(c.getSnapshot().problem!.referenceSource);
  await c.run('grade');
  const initial = c.getSnapshot().view.state,
    n = c.getSnapshot().view.length;
  expect(n).toBeGreaterThan(0);
  c.seek(n);
  expect(c.getSnapshot().view.state!.output).not.toBe('');
  for (let i = n - 1; i >= 0; i--) c.seek(i);
  expect(c.getSnapshot().view.state).toEqual(initial);
  vi.useFakeTimers();
  c.play();
  c.setRate(4);
  c.play();
  expect(vi.getTimerCount()).toBe(1);
  c.edit(c.getSnapshot().source + '\n');
  expect(c.getSnapshot().assessment).toBeNull();
  expect(c.getSnapshot().view.state).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  c.setInput('1');
  expect(c.getSnapshot().assessment).toBeNull();
  c.select({ difficulty: 2 });
  expect(c.getSnapshot().problem).toBeNull();
  c.clear();
});

test.each(['%d', '%d  \\n\\n'])(
  'OJ controller accepts Rust whitespace variant %s and rejects wrong content',
  async (format) => {
    const client = new PracticeClient();
    vi.spyOn(client, 'run').mockImplementation(run);
    const controller = new GeneratedPracticeController(client);
    await controller.run('generate');
    const source = controller.getSnapshot().problem!.referenceSource;
    controller.edit(source.replace('%d\\n', format));
    await controller.run('grade');
    expect(controller.getSnapshot().assessment?.verdict).toBe('passed');
    controller.edit(source.replace('printf("', 'printf("wrong='));
    await controller.run('grade');
    expect(controller.getSnapshot().assessment?.verdict).not.toBe('passed');
    controller.invalidate();
  },
);
test.each(['edit', 'input', 'selection', 'clear', 'unmount'])(
  'late controller result discarded after %s',
  async (action) => {
    const result = await run(base),
      client = new PracticeClient();
    let done!: (r: PracticeResponse) => void;
    vi.spyOn(client, 'run').mockReturnValue(
      new Promise((resolve) => {
        done = resolve;
      }),
    );
    const c = new GeneratedPracticeController(client),
      pending = c.run('generate');
    if (action === 'edit') c.edit('new');
    else if (action === 'input') c.setInput('3');
    else if (action === 'selection') c.select({ seed: '0' });
    else if (action === 'clear') c.clear();
    else c.invalidate();
    done(result);
    await pending;
    expect(c.getSnapshot().problem).toBeNull();
    expect(c.getSnapshot().view.state).toBeNull();
    c.invalidate();
  },
);
class WorkerStub {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  message?: { operationId: string; buffer: ArrayBuffer; remainingMs: number };
  terminate = vi.fn();
  postMessage = vi.fn((m) => {
    this.message = m;
  });
  reply(handler = this.onmessage, pages = 1) {
    handler?.call(
      this as unknown as Worker,
      new MessageEvent('message', {
        data: {
          ok: true,
          operationId: this.message!.operationId,
          buffer: new ArrayBuffer(1),
          wasmPages: pages,
        },
      }),
    );
  }
}
function setup() {
  const workers: WorkerStub[] = [],
    now = vi.fn(() => 0),
    decode = vi.fn(async () => run(base)),
    fetcher = vi.fn(
      async () =>
        new Response(new Uint8Array(engineBuild.wasmBytes), {
          headers: { 'content-type': 'application/wasm' },
        }),
    );
  const client = new PracticeClient({
    now,
    fetcher,
    compile: async () => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
    digest: async () =>
      Uint8Array.from(engineBuild.wasmSha256.match(/../g)!, (p) => parseInt(p, 16)).buffer,
    decode,
    createWorker: () => {
      const w = new WorkerStub();
      workers.push(w);
      return w as unknown as Worker;
    },
  });
  return { client, workers, now, decode, fetcher };
}
async function until(fn: () => boolean) {
  for (let i = 0; i < 100 && !fn(); i++) await Promise.resolve();
  expect(fn()).toBe(true);
}
test('single Worker slot cancels generator; late reply cannot reach decoder', async () => {
  const h = setup(),
    pending = h.client.run(base).catch((e: Error) => e.message);
  await until(() => h.workers.length === 1);
  const handler = h.workers[0].onmessage,
    release = claimEngineSlot(() => {});
  h.workers[0].reply(handler);
  expect(await pending).toBe('E_CANCELLED');
  expect(h.decode).not.toHaveBeenCalled();
  expect(h.workers[0].terminate).toHaveBeenCalledOnce();
  release();
  h.client.invalidate();
});
test.each(['reply', 'decode', 'load'])('original deadline is enforced after %s', async (phase) => {
  const h = setup();
  if (phase === 'decode')
    h.decode.mockImplementationOnce(async () => {
      h.now.mockReturnValue(1000);
      return run(base);
    });
  if (phase === 'load')
    h.fetcher.mockImplementationOnce(async () => {
      h.now.mockReturnValue(1000);
      return new Response(new Uint8Array(engineBuild.wasmBytes), {
        headers: { 'content-type': 'application/wasm' },
      });
    });
  const pending = h.client.run(base).catch((e: Error) => e.message);
  if (phase !== 'load') {
    await until(() => h.workers.length === 1);
    if (phase === 'reply') h.now.mockReturnValue(1000);
    h.workers[0].reply();
  }
  expect(await pending).toBe('E_DEADLINE');
  h.client.invalidate();
});
test.each([0, 2049, -1, 1.5])('invalid worker memory %s rejects before decode', async (pages) => {
  const h = setup(),
    pending = h.client.run(base).catch((e: Error) => e.message);
  await until(() => h.workers.length === 1);
  h.workers[0].reply(undefined, pages);
  expect(await pending).toBe('E_PROTOCOL_INVALID');
  expect(h.decode).not.toHaveBeenCalled();
  h.client.invalidate();
});
test('new generator clients share one compiled module owner; cancel and resource failures recover', async () => {
  const a = setup(),
    b = setup(),
    one = a.client.run(base).catch((e: Error) => e.message);
  await until(() => a.workers.length === 1);
  a.client.cancel();
  expect(await one).toBe('E_CANCELLED');
  const two = b.client.run(base);
  await until(() => b.workers.length === 1);
  expect(a.client.inspect().cachedModules).toBe(0);
  expect(b.client.inspect().cachedModules).toBe(1);
  b.workers[0].reply();
  await two;
  a.client.invalidate();
  b.client.invalidate();
});
