import { readFileSync } from 'node:fs';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { comparisonCatalogs } from '../../web/src/comparison/content';
import { ComparisonController } from '../../web/src/comparison/controller';
import { acceptedCaseRequest, type ExecutionClient } from '../../web/src/engine/execution-client';
import {
  decodeResult,
  encodeRequest,
  makeAdapterResult,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';
import { initSync, execute_request, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import { PlayerModel } from '../../web/src/player/model';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function setup() {
  const requests: ExecuteRequest[] = [],
    starts: number[] = [],
    preparations: unknown[] = [];
  const make = () => ({
    invalidate: vi.fn(),
    prepare: vi.fn<ExecutionClient['prepare']>(async (catalog, values, start) => {
      starts.push(start!);
      preparations.push(values);
      return JSON.parse(
        new TextDecoder().decode(
          prepare_input(
            JSON.stringify(catalog),
            new TextEncoder().encode(JSON.stringify(values)),
            1000,
          ),
        ),
      ).source;
    }),
    execute: vi.fn<ExecutionClient['execute']>(async (request, catalog, commit, start) => {
      requests.push(request);
      starts.push(start!);
      const bytes = execute_request(
        encodeRequest(request),
        JSON.stringify(catalog),
        engineBuild.wasmSha256,
        1000,
      ).slice();
      const result = await decodeResult(bytes.buffer, request);
      commit?.(result);
      return result;
    }),
  });
  const clients = [make(), make()] as const;
  let clock = 0;
  const controller = new ComparisonController({ clients, now: () => (clock += 42) });
  controller.configure(comparisonCatalogs());
  return { controller, clients, requests, starts, preparations };
}
async function loaded(values = [3, 1, 2]) {
  const fixture = setup();
  await fixture.controller.prepare({ values: { values }, random: null });
  await fixture.controller.execute();
  return fixture;
}

describe('16.2 actual Rust pair and combined lifecycle', () => {
  beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
  afterEach(() => vi.useRealTimers());
  it('restricts to the original two C cases and supports reversing the pair', () => {
    const a = comparisonCatalogs(),
      b = comparisonCatalogs(true);
    expect(a.map((c) => c.subject.id)).toEqual(['case.c.bubble-sort', 'case.c.selection-sort']);
    expect(b.map((c) => c.subject.id)).toEqual(a.map((c) => c.subject.id).reverse());
    expect(a.every((c) => c.program.languageRef.id === 'lang.c')).toBe(true);
  });
  it('freezes independent equal input copies before awaiting and issues two independent requests', async () => {
    const f = setup(),
      input = { values: { values: [7, -3, 0, -3] }, random: null };
    const preparing = f.controller.prepare(input);
    input.values.values[0] = 999;
    await preparing;
    await f.controller.execute();
    const lanes = f.controller.getSnapshot().lanes;
    expect(lanes[0].input).toEqual(lanes[1].input);
    expect(lanes[0].input).not.toBe(lanes[1].input);
    expect(lanes[0].input!.values.values).not.toBe(lanes[1].input!.values.values);
    expect(Object.isFrozen(lanes[0].input!.values.values)).toBe(true);
    expect(f.preparations[0]).not.toBe(f.preparations[1]);
    expect(f.requests).toHaveLength(2);
    expect(f.requests[0].input.values).toEqual({ values: [7, -3, 0, -3] });
    for (const key of ['contextId', 'submissionId', 'runId'] as const)
      expect(f.requests[0].identity[key]).not.toBe(f.requests[1].identity[key]);
    expect(f.starts).toEqual([42, 42, 84, 84]);
    expect(lanes.every((lane) => lane.result?.producer === 'rust')).toBe(true);
    expect(lanes.every((lane) => acceptedCaseRequest(lane.result!) === null)).toBe(true);
  });
  it.each([[], [0], [2, 2, 2], [1, 2, 3], [3, 2, 1], [-999, 999, 0]])(
    'sorts boundary input through two real programs: %j',
    async (...items) => {
      const f = await loaded(items as number[]);
      for (const lane of f.controller.getSnapshot().lanes) {
        expect(lane.result?.terminal.status).toBe('completed');
        const model = new PlayerModel();
        model.acceptValidated(model.begin(lane.result!.identity), lane.result!);
        model.seek(lane.view.length);
        expect(model.snapshot().state!.output).toBe(
          (items as number[])
            .slice()
            .sort((a, b) => a - b)
            .join(' ') + '\n',
        );
      }
    },
  );
  it('restores every full state and holds the shorter real trajectory at its terminal', async () => {
    const { controller } = await loaded([3, 1, 2]);
    const initial = controller.getSnapshot(),
      results = initial.lanes.map((lane) => lane.result!);
    const expected = results.map((result) => {
      const model = new PlayerModel();
      model.acceptValidated(model.begin(result.identity), result);
      return model;
    });
    expect(new Set(initial.lanes.map((lane) => lane.view.length)).size).toBe(2);
    for (let k = 0; k <= initial.length; k++) {
      controller.seek(k);
      controller.getSnapshot().lanes.forEach((lane, index) => {
        expected[index].seek(Math.min(k, lane.view.length));
        expect(lane.view).toEqual(expected[index].snapshot());
      });
    }
    for (let k = initial.length; k >= 0; k--) {
      controller.seek(k);
      controller.getSnapshot().lanes.forEach((lane, index) => {
        expected[index].seek(Math.min(k, lane.view.length));
        expect(lane.view).toEqual(expected[index].snapshot());
      });
    }
    expect(controller.getSnapshot().lanes.map((lane) => lane.view.state)).toEqual(
      initial.lanes.map((lane) => lane.view.state),
    );
  });
  it('changes only replay timing; pause, seek and edits invalidate old timer callbacks', async () => {
    const { controller, clients } = await loaded();
    vi.useFakeTimers();
    controller.play();
    controller.play();
    vi.advanceTimersByTime(500);
    expect(controller.getSnapshot().cursor).toBe(1);
    controller.setRate(4);
    vi.advanceTimersByTime(125);
    expect(controller.getSnapshot().cursor).toBe(2);
    const counters = controller.getSnapshot().lanes.map((lane) => lane.view.state!.counters);
    controller.setRate(0.25);
    expect(controller.getSnapshot().lanes.map((lane) => lane.view.state!.counters)).toEqual(
      counters,
    );
    controller.pause();
    vi.advanceTimersByTime(5000);
    expect(controller.getSnapshot().cursor).toBe(2);
    controller.play();
    controller.seek(1);
    vi.advanceTimersByTime(5000);
    expect(controller.getSnapshot().cursor).toBe(1);
    controller.play();
    controller.invalidate();
    vi.advanceTimersByTime(5000);
    expect(controller.getSnapshot().length).toBe(0);
    expect(clients.every((client) => client.execute.mock.calls.length === 1)).toBe(true);
  });
  it('discard late preparation after edits and recover with a fresh preparation', async () => {
    const f = setup(),
      hold = deferred<Awaited<ReturnType<ExecutionClient['prepare']>>>();
    const original = f.clients[0].prepare.getMockImplementation()!;
    const real = await original(comparisonCatalogs()[0], { values: [1] }, 42);
    f.clients[0].prepare.mockImplementationOnce(() => hold.promise);
    const pending = f.controller.prepare({ values: { values: [1] }, random: null });
    f.controller.invalidate();
    hold.resolve(real);
    await pending;
    expect(f.controller.getSnapshot().phase).toBe('idle');
    expect(f.controller.getSnapshot().lanes.every((lane) => !lane.source)).toBe(true);
    await f.controller.prepare({ values: { values: [1] }, random: null });
    expect(f.controller.getSnapshot().phase).toBe('ready');
  });
  it('fails whole preparation if either side fails', async () => {
    const f = setup();
    f.clients[1].prepare.mockRejectedValueOnce(new Error('E_MODULE_LOAD'));
    await f.controller.prepare({ values: { values: [1] }, random: null });
    expect(f.controller.getSnapshot().phase).toBe('failed');
    expect(f.controller.getSnapshot().lanes.every((lane) => !lane.source)).toBe(true);
    await f.controller.execute();
    expect(f.requests).toHaveLength(0);
  });
  it('keeps a real accepted side, cancels provisional side, ignores its late final result and allows rerun', async () => {
    const f = setup(),
      hold = deferred<ExecuteResult>();
    await f.controller.prepare({ values: { values: [2, 1] }, random: null });
    const original = f.clients[1].execute.getMockImplementation()!;
    let late!: ExecuteResult;
    f.clients[1].execute.mockImplementationOnce(async (...args) => {
      late = await original(...args);
      return hold.promise;
    });
    const running = f.controller.execute();
    await vi.waitFor(() => expect(f.controller.getSnapshot().lanes[1].result).toBeDefined());
    f.controller.cancel();
    hold.resolve(late);
    await running;
    expect(f.controller.getSnapshot().lanes.map((lane) => lane.phase)).toEqual([
      'accepted',
      'cancelled',
    ]);
    expect(f.controller.getSnapshot().lanes[1].result).toBeUndefined();
    f.controller.seek(f.controller.getSnapshot().length);
    expect(f.controller.getSnapshot().lanes[0].view.terminal?.status).toBe('completed');
    await f.controller.execute();
    expect(f.controller.getSnapshot().lanes.every((lane) => lane.phase === 'accepted')).toBe(true);
  });
  it('keeps an injected adapter failure separate while allowing the other independent real run', async () => {
    const f = setup();
    f.clients[0].execute.mockImplementationOnce(async (req) =>
      makeAdapterResult(req, 'resource-limit', 'E_DEADLINE'),
    );
    await f.controller.prepare({ values: { values: [2, 1] }, random: null });
    await f.controller.execute();
    const lanes = f.controller.getSnapshot().lanes;
    expect(lanes[0].result?.terminal.status).toBe('resource-limit');
    expect(lanes[0].view.cursor).toBeNull();
    expect(lanes[1].result?.producer).toBe('rust');
    expect(lanes[1].result?.terminal.status).toBe('completed');
  });
  it('rejects a crossed identity rather than displaying another run', async () => {
    const f = setup();
    f.clients[0].execute.mockImplementationOnce(async (req) => {
      const bad = makeAdapterResult(req, 'cancelled', 'E_CANCELLED');
      bad.identity.runId = crypto.randomUUID();
      return bad;
    });
    await f.controller.prepare({ values: { values: [1] }, random: null });
    await f.controller.execute();
    expect(f.controller.getSnapshot().lanes[0].error).toBe('COMPARISON_IDENTITY_MISMATCH');
    expect(f.controller.getSnapshot().lanes[0].result).toBeUndefined();
  });
});
