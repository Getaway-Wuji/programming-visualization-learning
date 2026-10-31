import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import { examples } from '../../web/src/examples/content';
import {
  solutionsFor,
  samplesFor,
  prepareSolution,
  compareResults,
} from '../../web/src/example-comparison/content';
import { ExamplePairController } from '../../web/src/example-comparison/controller';
import { AdvancedPlayer } from '../../web/src/engine/advanced-player';
import { advancedRequest } from '../../web/src/engine/advanced-client';
import {
  decodeAdvancedResult,
  encodeAdvancedRequest,
  projectAdvancedStep,
  type AdvancedRequest,
  type AdvancedResult,
} from '../../web/src/engine/advanced-protocol';
import { initSync, execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
beforeAll(() =>
  initSync({
    module: new WebAssembly.Module(
      new Uint8Array(readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
    ),
  }),
);
afterEach(() => vi.useRealTimers());
async function real(request: AdvancedRequest) {
  const bytes = execute_advanced(encodeAdvancedRequest(request), engineBuild.wasmSha256, 1000);
  return decodeAdvancedResult(bytes.slice().buffer, request, engineBuild.wasmSha256);
}
class Client {
  requests: { request: AdvancedRequest; started?: number }[] = [];
  invalidate = vi.fn();
  async execute(request: AdvancedRequest, options: { started?: number } = {}) {
    this.requests.push({ request, started: options.started });
    return real(request);
  }
}
class Held extends Client {
  pending: {
    request: AdvancedRequest;
    resolve: (r: AdvancedResult) => void;
    reject: (e: Error) => void;
  }[] = [];
  override execute(request: AdvancedRequest, options: { started?: number } = {}) {
    this.requests.push({ request, started: options.started });
    return new Promise<AdvancedResult>((resolve, reject) =>
      this.pending.push({ request, resolve, reject }),
    );
  }
}
async function until(f: () => boolean) {
  for (let i = 0; i < 1000 && !f(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(f()).toBe(true);
}
it('closed multi-solution schema, immutable original refs and unsupported input mutations are rejected', () => {
  const script = `import{validateSolutions}from'./scripts/example-solutions-content.mjs';import{readFileSync}from'node:fs';const v=JSON.parse(readFileSync('content/advanced/example-solutions-1.0.0.json'));validateSolutions();let n=0;for(const edit of [v=>v.extra=1,v=>v.examples[0].exampleRef.version='2.0.0',v=>v.examples[0].solutions.reverse(),v=>v.examples[1].solutions[1].sourceFile=v.examples[0].solutions[1].sourceFile,v=>v.examples[2].supplementalSamples[0].values=[1,1],v=>v.examples[0].supplementalSamples[0].target=1000,v=>v.examples[1].supplementalSamples[0].target=0,v=>v.examples[0].solutions[0].programRef.id='wrong']){const w=structuredClone(v);edit(w);try{validateSolutions(w)}catch{n++}}if(n!==8)throw Error('invalid manifest accepted');`;
  expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', script])).not.toThrow();
});
it('preparation keeps original source bytes, independently copies unsorted inputs and refuses invalid/foreign choices', () => {
  for (const spec of examples) {
    const before = structuredClone(spec.defaults),
      sols = solutionsFor(spec),
      a = prepareSolution(spec, sols[0], before),
      b = prepareSolution(spec, sols[1], before);
    expect(before).toEqual(spec.defaults);
    expect(a.input).toEqual(b.input);
    expect(a.input).not.toBe(b.input);
    for (const [i, p] of [a, b].entries())
      expect(p.source).toBe(
        readFileSync(sols[i].sourceFile, 'utf8').replace('{{n}}', String(before.values.length)),
      );
    expect(() => prepareSolution(spec, sols[0], { values: [] })).toThrow('E_INPUT_INVALID');
    expect(() =>
      prepareSolution(spec, { ...sols[1], sourceFile: sols[0].sourceFile }, before),
    ).toThrow('E_CONTENT_MISMATCH');
  }
});
for (const spec of examples)
  for (const sample of samplesFor(spec))
    it(`both real cpp/full atomic reverse: ${spec.id}/${sample.key}`, async () => {
      const results: AdvancedResult[] = [];
      for (const solution of solutionsFor(spec)) {
        const prepared = prepareSolution(spec, solution, sample),
          request = advancedRequest(prepared.source, 'cpp', {
            kind: 'integers',
            values: prepared.input,
          }),
          result = await real(request);
        results.push(result);
        expect(result.language).toBe('cpp');
        expect(result.identity.runId).toBe(request.runId);
        expect(result.terminal).toMatchObject({
          status: 'completed',
          returnValue: sample.expectedReturn,
        });
        const trace = result.trace!;
        let state = structuredClone(trace.initialState);
        for (const step of trace.steps) state = projectAdvancedStep(state, step, result.types);
        expect(state.output).toBe(sample.expectedStdout);
        for (let i = trace.steps.length - 1; i >= 0; i--)
          state = projectAdvancedStep(state, trace.steps[i], result.types, true);
        expect(state).toEqual(trace.initialState);
      }
      expect(results[0].identity.runId).not.toBe(results[1].identity.runId);
      expect(compareResults(spec, sample.values.length, results)).toBe(
        sample.expectedReturn ? 'rejected' : 'equal',
      );
    });
it('duplicate groups multiply pair counts; input-exhausted prefix is not equivalent and a fresh real run recovers', async () => {
  const spec = examples[0],
    sol = solutionsFor(spec)[1],
    p = prepareSolution(spec, sol, { values: [1, 1, 4, 4], target: 5 });
  const result = await real(
    advancedRequest(p.source, 'cpp', { kind: 'integers', values: p.input }),
  );
  expect(result.terminal.returnValue).toBe(1);
  const bad = await real(
    advancedRequest(p.source, 'cpp', { kind: 'integers', values: p.input.slice(0, -1) }),
  );
  expect(bad.terminal.code).toBe('E_INPUT_EXHAUSTED');
  expect(compareResults(spec, 4, [bad, bad])).toBe('unavailable');
  expect(compareResults(spec, 4, [null, result])).toBe('unavailable');
  const fresh = await real(advancedRequest(p.source, 'cpp', { kind: 'integers', values: p.input }));
  expect(compareResults(spec, 4, [result, fresh])).toBe('rejected');
});
it('normalizes only answer-index order; never sorts move-zeroes output or treats malformed output as equal', async () => {
  const output = async (text: string) =>
    real(
      advancedRequest(
        '#include <iostream>\nint main(){std::cout << "' + text + '\\n";return 0;}',
        'cpp',
      ),
    );
  const a = await output('0 2'),
    b = await output('2 0'),
    c = await output('0 0'),
    d = await output('1 2 0'),
    e = await output('2 1 0'),
    f = await output('garbage');
  expect(compareResults(examples[0], 3, [a, b])).toBe('equal');
  expect(compareResults(examples[0], 3, [c, c])).toBe('different');
  expect(compareResults(examples[1], 3, [d, e])).toBe('different');
  expect(compareResults(examples[2], 3, [f, f])).toBe('different');
});
it('independent frozen requests share one start, shortest terminal holds and all lane states reverse exactly', async () => {
  const a = new Client(),
    b = new Client(),
    spec = examples[0],
    c = new ExamplePairController(spec, { clients: [a, b], now: () => 12 }),
    input = structuredClone(spec.defaults);
  c.prepare(input);
  input.values[0] = 999;
  const lanes = c.getSnapshot().lanes;
  expect(lanes[0].prepared!.input).toEqual([...spec.defaults.values, spec.defaults.target!]);
  expect(lanes[0].prepared!.input).not.toBe(lanes[1].prepared!.input);
  expect(Object.isFrozen(lanes[0].prepared!.input)).toBe(true);
  await c.execute();
  expect(a.requests[0].started).toBe(12);
  expect(b.requests[0].started).toBe(12);
  expect(a.requests[0].request.runId).not.toBe(b.requests[0].request.runId);
  expect(a.requests[0].request.sourceRevision).not.toBe(b.requests[0].request.sourceRevision);
  expect(Object.isFrozen(a.requests[0].request.input.values)).toBe(true);
  expect(c.getSnapshot().outcome).toBe('equal');
  for (const k of [
    43,
    Math.min(...c.getSnapshot().lanes.map((l) => l.view.length)) + 1,
    c.getSnapshot().length,
    0,
  ]) {
    c.seek(k);
    for (const lane of c.getSnapshot().lanes) {
      const player = new AdvancedPlayer();
      player.accept(lane.result!);
      player.seek(Math.min(k, lane.view.length));
      expect(lane.view).toEqual(player.snapshot());
    }
  }
  c.invalidate();
});
it('cancel preserves accepted left, discards genuinely late second result, and rerun creates fresh group identities', async () => {
  const a = new Client(),
    b = new Held(),
    c = new ExamplePairController(examples[1], { clients: [a, b] });
  c.prepare(examples[1].defaults);
  const pending = c.execute();
  await until(() => b.pending.length === 1);
  const result = await real(b.pending[0].request),
    old = c.getSnapshot().groupId;
  c.cancel();
  b.pending[0].resolve(result);
  await pending;
  expect(c.getSnapshot().phase).toBe('cancelled');
  expect(c.getSnapshot().lanes.map((l) => l.phase)).toEqual(['accepted', 'cancelled']);
  expect(c.getSnapshot().outcome).toBe('unavailable');
  c.seek(c.getSnapshot().length);
  expect(c.getSnapshot().lanes[0].view.state!.output).toBe('4 -2 4 0 0\n');
  const rerun = c.execute();
  await until(() => b.pending.length === 2);
  b.pending[1].resolve(await real(b.pending[1].request));
  await rerun;
  expect(c.getSnapshot().groupId).not.toBe(old);
  expect(c.getSnapshot().outcome).toBe('equal');
  c.invalidate();
});
it('input/topic/order/clear/unmount replacement rejects genuine late first results and invalid preparation has no half-ready side', async () => {
  for (const reason of ['input', 'topic', 'order', 'clear', 'unmount']) {
    const a = new Held(),
      b = new Client(),
      c = new ExamplePairController(examples[2], { clients: [a, b] });
    c.prepare(examples[2].defaults);
    const pending = c.execute();
    const result = await real(a.pending[0].request);
    c.invalidate();
    a.pending[0].resolve(result);
    await pending;
    expect(c.getSnapshot().phase, reason).toBe('idle');
    expect(c.getSnapshot().lanes.every((l) => !l.result && !l.prepared && !l.view.state)).toBe(
      true,
    );
    expect(b.requests).toHaveLength(0);
  }
  const c = new ExamplePairController(examples[2]);
  c.prepare({ values: [2, 1], target: 1 });
  expect(c.getSnapshot().phase).toBe('failed');
  expect(c.getSnapshot().lanes.every((l) => !l.prepared)).toBe(true);
  c.invalidate();
});
it('failed first side still permits second within the same remaining budget', async () => {
  const a = new Held(),
    b = new Client(),
    c = new ExamplePairController(examples[1], { clients: [a, b], now: () => 20 });
  c.prepare(examples[1].defaults);
  const pending = c.execute();
  a.pending[0].reject(Error('E_MODULE_LOAD'));
  await pending;
  expect(c.getSnapshot().lanes.map((l) => l.phase)).toEqual(['failed', 'accepted']);
  expect(b.requests[0].started).toBe(20);
  expect(c.getSnapshot().outcome).toBe('unavailable');
  c.invalidate();
});
it('expired first acceptance and second side never receive fresh time', async () => {
  let clock = 10;
  const a = new Held(),
    b = new Client(),
    c = new ExamplePairController(examples[1], { clients: [a, b], now: () => clock });
  c.prepare(examples[1].defaults);
  const pending = c.execute();
  const r = await real(a.pending[0].request);
  clock = 1010;
  a.pending[0].resolve(r);
  await pending;
  expect(c.getSnapshot().lanes.map((l) => l.error)).toEqual(['E_DEADLINE', 'E_DEADLINE']);
  expect(b.requests).toHaveLength(0);
  expect(c.getSnapshot().length).toBe(0);
  c.invalidate();
});
it('initial presentation consuming the shared deadline revokes that result before the next lane', async () => {
  let clock = 0,
    expired = false;
  const a = new Client(),
    b = new Client(),
    c = new ExamplePairController(examples[1], { clients: [a, b], now: () => clock });
  c.prepare(examples[1].defaults);
  c.subscribe(() => {
    if (!expired && c.getSnapshot().lanes[0].phase === 'accepted') {
      expired = true;
      clock = 1000;
    }
  });
  await c.execute();
  expect(c.getSnapshot().lanes.map((l) => l.error)).toEqual(['E_DEADLINE', 'E_DEADLINE']);
  expect(b.requests).toHaveLength(0);
  c.invalidate();
});
it('final group presentation that reaches the original cutoff revokes the last side and equivalence', async () => {
  let clock = 0;
  const a = new Client(),
    b = new Client(),
    c = new ExamplePairController(examples[1], { clients: [a, b], now: () => clock });
  c.prepare(examples[1].defaults);
  c.subscribe(() => {
    if (c.getSnapshot().phase === 'settled') clock = 1000;
  });
  await c.execute();
  expect(c.getSnapshot().lanes[0].phase).toBe('accepted');
  expect(c.getSnapshot().lanes[1].error).toBe('E_DEADLINE');
  expect(c.getSnapshot().outcome).toBe('unavailable');
  c.invalidate();
});
it('timer/rate/seek are trace-only; replacement clears queued ticks and scheme order', async () => {
  const a = new Client(),
    b = new Client(),
    c = new ExamplePairController(examples[1], { clients: [a, b] });
  c.prepare(examples[1].defaults, true);
  expect(c.getSnapshot().lanes[0].spec.solutionRef.id).toContain('swap');
  await c.execute();
  vi.useFakeTimers();
  c.play();
  await vi.advanceTimersByTimeAsync(500);
  expect(c.getSnapshot().cursor).toBe(1);
  c.setRate(4);
  await vi.advanceTimersByTimeAsync(125);
  expect(c.getSnapshot().cursor).toBe(2);
  c.pause();
  await vi.advanceTimersByTimeAsync(500);
  expect(c.getSnapshot().cursor).toBe(2);
  c.play();
  c.invalidate();
  await vi.advanceTimersByTimeAsync(1000);
  expect(c.getSnapshot().cursor).toBe(0);
  expect(c.getSnapshot().playing).toBe(false);
  expect(a.requests.length + b.requests.length).toBe(2);
  c.setRate(99);
  expect(c.getSnapshot().rate).toBe(4);
});
