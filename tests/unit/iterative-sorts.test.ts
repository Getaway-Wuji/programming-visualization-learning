import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initSync, execute_algorithm } from '../../web/src/generated/algorithm/c_viz_algorithm';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import { AlgorithmExecutionClient, algorithmRequest } from '../../web/src/engine/algorithm-client';
import {
  decodeAlgorithmResult,
  encodeAlgorithmRequest,
  type AlgorithmRequest,
  type AlgorithmResult,
} from '../../web/src/engine/algorithm-protocol';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import { parseSortInput, prepareSort, sortCases } from '../../web/src/algorithms/content';
import { SortController } from '../../web/src/algorithms/controller';
import { slotValue, sortExplanation, writtenSlots } from '../../web/src/algorithms/presentation';

beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/algorithm/c_viz_algorithm_bg.wasm') }),
);
async function execute(request: AlgorithmRequest) {
  const bytes = execute_algorithm(
    encodeAlgorithmRequest(request),
    engineBuild.wasmSha256,
    1000,
  ).slice();
  return decodeAlgorithmResult(bytes.buffer, request, engineBuild.wasmSha256);
}
function samples(min: number, max: number) {
  return [
    { id: 'default', values: [7, -3, 0, 5, -3, 2, 9] },
    { id: 'empty', values: [] },
    { id: 'single', values: [0] },
    { id: 'duplicates', values: [3, -2, 3, -2, 0, 3] },
    { id: 'sorted', values: [min, -1, 0, 1, max] },
    { id: 'reverse', values: [9, 7, 5, 3, 1, -1, -3] },
    { id: 'domain-ends', values: [max, min, 0, max, min] },
    { id: 'capacity-reverse', values: Array.from({ length: 30 }, (_, i) => 15 - i) },
    { id: 'capacity-equal', values: Array(30).fill(max) as number[] },
    {
      id: 'capacity-mixed',
      values: Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? min : i % 3 === 1 ? max : 0)),
    },
  ];
}
describe('16.4 real C++ programs and reversible full states', () => {
  for (const spec of sortCases)
    for (const sample of samples(spec.min, spec.max))
      it(`${spec.id}: actual Rust ${sample.id} sorts and preserves full reverse state`, async () => {
        const prepared = prepareSort(spec, sample.values),
          request = algorithmRequest(prepared.source, 'cpp', prepared.input),
          result = await execute(request);
        expect(result.language).toBe('cpp');
        expect(result.engine.buildId).toBe(engineBuild.wasmSha256);
        expect(result.terminal.status).toBe('completed');
        expect(result.trace?.completeness).toBe('complete');
        const expected = [...sample.values].sort((a, b) => a - b),
          player = new AlgorithmPlayer();
        player.accept(result);
        const initial = player.snapshot();
        const firstOutput = result.trace!.steps.findIndex((step) =>
          step.changes.some((change) => change.op === 'output'),
        );
        expect(firstOutput).toBeGreaterThan(0);
        player.seek(firstOutput);
        const beforeOutput = player.snapshot().state!,
          array = beforeOutput.objects.find((object) => object.name === 'values')!;
        expect(array.length).toBe(30);
        expect(
          Array.from({ length: sample.values.length }, (_, index) => slotValue(array, index)),
        ).toEqual(expected);
        if (spec.id.endsWith('counting-sort')) {
          const counts = beforeOutput.objects.find((object) => object.name === 'counts')!;
          expect(counts.length).toBe(41);
          expect(Array.from({ length: 41 }, (_, index) => slotValue(counts, index))).toEqual(
            Array(41).fill(0),
          );
        }
        const point = Math.min(
          result.trace!.steps.length - 1,
          Math.max(1, Math.floor(result.trace!.steps.length / 2)),
        );
        player.seek(point);
        const saved = player.snapshot();
        player.seek(point + 1);
        player.seek(point);
        expect(player.snapshot()).toEqual(saved);
        player.seek(result.trace!.steps.length);
        const final = player.snapshot();
        expect(final.state!.output).toBe(expected.map((value) => `${value} `).join('') + '\n');
        expect(final.state!.control.inputCursor).toBe(sample.values.length);
        expect(final.state!.objects).toEqual([]);
        expect(final.state!.frames).toEqual([]);
        expect(final.state!.counters.swaps).toBe(0);
        expect(result.stats.fuelUsed).toBeLessThan(1000000);
        for (let at = result.trace!.steps.length - 1; at >= 0; at--) player.seek(at);
        expect(player.snapshot()).toEqual(initial);
        expect(prepared.source).toContain(`int n = ${sample.values.length};`);
        expect(prepared.source).toContain('std::cin >> values[i]');
        expect(request.input).toEqual(sample.values);
        expect(request.input).not.toBe(sample.values);
      });
  for (const spec of sortCases)
    it(`${spec.id}: strict input bounds and source markers match actual Rust steps`, async () => {
      for (const draft of [
        '',
        ' ',
        '[1]',
        '1e2',
        '1.5',
        '0x10',
        'NaN',
        String(spec.min - 1),
        String(spec.max + 1),
        Array(31).fill('1').join(' '),
      ])
        expect(parseSortInput(spec, draft).valid).toBe(false);
      expect(parseSortInput(spec, '[]')).toEqual({ valid: true, values: [], issue: '' });
      expect(parseSortInput(spec, `+0，${spec.min},${spec.max}`).values).toEqual([
        0,
        spec.min,
        spec.max,
      ]);
      const prepared = prepareSort(spec, spec.defaultInput),
        result = await execute(algorithmRequest(prepared.source, 'cpp', prepared.input)),
        player = new AlgorithmPlayer();
      player.accept(result);
      for (const step of result.trace!.steps) {
        const explanation = sortExplanation(result, step.seq, prepared),
          raw = result.nodeMap.find((node) => node.nodeId === step.nodeId)!;
        expect(explanation.range).toEqual(raw.byteRange);
        expect(explanation.title).toBe(
          prepared.phases.findLast((phase) => phase.start <= raw.byteRange.start)!.title,
        );
        if (step.kind === 'input.read' || step.kind === 'value.write') {
          player.seek(step.seq);
          for (const object of player.snapshot().state!.objects) {
            const expected = step.changes
              .filter((change) => change.op === 'cell' && change.objectId === object.id)
              .map((change) => (change.op === 'cell' ? change.index : -1));
            for (const index of expected) expect(writtenSlots(step, object).has(index)).toBe(true);
          }
        }
      }
      expect(() => prepareSort(spec, [spec.max + 1])).toThrow('E_INPUT_INVALID');
    });
});

class RealClient extends AlgorithmExecutionClient {
  requests: AlgorithmRequest[] = [];
  override execute(request: AlgorithmRequest) {
    this.requests.push(structuredClone(request));
    return execute(request);
  }
}
class HeldClient extends AlgorithmExecutionClient {
  pending: {
    request: AlgorithmRequest;
    resolve: (result: AlgorithmResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  override execute(request: AlgorithmRequest) {
    return new Promise<AlgorithmResult>((resolve, reject) =>
      this.pending.push({ request, resolve, reject }),
    );
  }
  override invalidate() {
    /* Deliberately simulate an uncancellable late native reply. */
  }
  override cancel() {
    this.pending.at(-1)?.reject(Error('E_CANCELLED'));
  }
}
describe('16.4 controller lifecycle with actual Rust results', () => {
  afterEach(() => vi.useRealTimers());
  it('uses the exact prepared C++ request and makes stepping and speed view-only', async () => {
    const client = new RealClient(),
      controller = new SortController(client),
      spec = sortCases[0];
    await controller.execute(spec, [3, -1, 3]);
    expect(controller.getSnapshot().status).toBe('ready');
    expect(client.requests).toHaveLength(1);
    expect(client.requests[0].source).toBe(prepareSort(spec, [3, -1, 3]).source);
    expect(client.requests[0].input).toEqual([3, -1, 3]);
    controller.seek(12);
    const state = controller.getSnapshot().view.state;
    controller.step(1);
    controller.step(-1);
    expect(controller.getSnapshot().view.state).toEqual(state);
    controller.setRate(4);
    controller.replay();
    expect(controller.getSnapshot().view.cursor).toBe(0);
    expect(client.requests).toHaveLength(1);
    controller.invalidate();
  });
  it('replaces timers on speed changes, pauses without drift and invalidates old ticks', async () => {
    const controller = new SortController(new RealClient());
    await controller.execute(sortCases[1], [3, 2, 1]);
    vi.useFakeTimers();
    controller.play();
    vi.advanceTimersByTime(500);
    expect(controller.getSnapshot().view.cursor).toBe(1);
    controller.setRate(4);
    vi.advanceTimersByTime(125);
    expect(controller.getSnapshot().view.cursor).toBe(2);
    controller.pause();
    vi.advanceTimersByTime(2000);
    expect(controller.getSnapshot().view.cursor).toBe(2);
    controller.play();
    controller.invalidate();
    vi.advanceTimersByTime(2000);
    expect(controller.getSnapshot().view.state).toBeNull();
    expect(controller.getSnapshot().view.cursor).toBe(0);
  });
  it('drops a genuine old result after replacement and accepts only the current run', async () => {
    const client = new HeldClient(),
      controller = new SortController(client);
    const first = controller.execute(sortCases[0], [5, 1]),
      old = client.pending[0],
      oldResult = await execute(old.request);
    const second = controller.execute(sortCases[2], [20, -20, 0]),
      fresh = client.pending[1],
      freshResult = await execute(fresh.request);
    old.resolve(oldResult);
    await first;
    expect(controller.getSnapshot().status).toBe('running');
    expect(controller.getSnapshot().result).toBeNull();
    fresh.resolve(freshResult);
    await second;
    expect(controller.getSnapshot().result).toBe(freshResult);
    expect(controller.getSnapshot().request?.input).toEqual([20, -20, 0]);
    controller.invalidate();
  });
  it('clear/unmount invalidation and cancellation cannot restore a late run; invalid input never executes', async () => {
    const client = new HeldClient(),
      controller = new SortController(client);
    const promise = controller.execute(sortCases[0], [1, 0]),
      pending = client.pending[0],
      result = await execute(pending.request);
    controller.invalidate();
    pending.resolve(result);
    await promise;
    expect(controller.getSnapshot().view.state).toBeNull();
    const cancelled = controller.execute(sortCases[0], [2, 1]);
    controller.cancel();
    await cancelled;
    expect(controller.getSnapshot().error).toBe('E_CANCELLED');
    expect(controller.getSnapshot().view.state).toBeNull();
    await controller.execute(sortCases[2], [21]);
    expect(controller.getSnapshot().error).toBe('E_INPUT_INVALID');
    expect(client.pending).toHaveLength(2);
  });
  it('real incomplete input and changed unsupported source reject without a stale trajectory', async () => {
    const client = new RealClient(),
      controller = new SortController(client);
    await controller.execute(sortCases[0], [2, 1]);
    const request = algorithmRequest(prepareSort(sortCases[0], [1, 2]).source, 'cpp', [1]),
      result = await execute(request);
    expect(result.terminal.code).toBe('E_INPUT_EXHAUSTED');
    expect(result.trace?.completeness).toBe('prefix');
    const bad = await execute(algorithmRequest('int main(){ double x=1; return 0; }', 'cpp', []));
    expect(bad.trace).toBeNull();
    expect(bad.terminal.status).toBe('error');
    controller.invalidate();
  });
});
