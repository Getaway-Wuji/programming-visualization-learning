import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ProgramEntity } from '../../web/src/content/types';
import { decodeResult, encodeRequest, type ExecuteRequest } from '../../web/src/engine/protocol';
import { PlayerModel } from '../../web/src/player/model';
import { presentTrace, VISIBLE_CELLS, VISIBLE_OBJECTS } from '../../web/src/player/presentation';
import { initSync, prepare_input, execute_request } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';

const root = new URL('../../tests/fixtures/execution/', import.meta.url);
async function load(key = 'assignment') {
  const read = (file: string) => readFileSync(new URL(`${key}/${file}`, root));
  const request = JSON.parse(read('request.json').toString()) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(read('result.json')).buffer, request);
  const catalog = JSON.parse(read('catalog.json').toString()) as { program: ProgramEntity };
  const model = new PlayerModel();
  model.acceptValidated(model.begin(result.identity), result);
  const at = (cursor: number) => {
    model.seek(cursor);
    return presentTrace(model.snapshot(), result, request.input.values, catalog.program.bindings)!;
  };
  return { request, result, catalog, model, at };
}

describe('08.3 view projection from the single restored Rust state', () => {
  it('marks a real same-value write instead of inferring activity from changed numbers', async () => {
    const sample = await load();
    const catalog = structuredClone(sample.catalog);
    catalog.program = {
      ...catalog.program,
      sourceExample: catalog.program.sourceExample.replace('x = x + 2;', 'x = x;'),
    };
    initSync({
      module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
    });
    const request = sample.request;
    request.source = JSON.parse(
      new TextDecoder().decode(
        prepare_input(
          JSON.stringify(catalog),
          new TextEncoder().encode(JSON.stringify(request.input.values)),
          1000,
        ),
      ),
    ).source;
    request.engineRef.buildId = engineBuild.wasmSha256;
    const result = await decodeResult(
      execute_request(
        encodeRequest(request),
        JSON.stringify(catalog),
        engineBuild.wasmSha256,
        1000,
      ).slice().buffer,
      request,
    );
    const model = new PlayerModel();
    model.acceptValidated(model.begin(result.identity), result);
    model.seek(result.trace!.steps.find((step) => step.kind === 'value.write')!.seq);
    const frame = presentTrace(
      model.snapshot(),
      result,
      request.input.values,
      catalog.program.bindings,
    )!;
    expect(frame.objects[0].cells[0]).toEqual({ index: 0, value: -7, read: true, written: true });
    expect(frame.events).toContain('写入 x (o1)：-7 → -7');
    expect(frame.counters.scalarWrites).toBe(2);
  });
  it('distinguishes initial, uninitialized, initialized, read/write, output and return states', async () => {
    const { at } = await load();
    expect(at(0)).toMatchObject({ objects: [], output: '', counters: { scalarWrites: 0 } });
    expect(at(2).objects[0].cells[0]).toEqual({
      index: 0,
      value: null,
      read: false,
      written: false,
    });
    expect(at(3).objects[0].cells[0]).toEqual({ index: 0, value: -7, read: false, written: true });
    expect(at(4).objects[0].cells[0]).toEqual({ index: 0, value: -5, read: true, written: true });
    expect(at(4).events).toEqual(['读取 x (o1)：-7', '写入 x (o1)：-7 → -5']);
    expect(at(4).output).toBe('');
    expect(at(5).output).toBe('-5\n');
    expect(at(6)).toMatchObject({
      objects: [],
      output: '-5\n',
      retired: ['x (o1，s1)'],
      counters: { scalarWrites: 2 },
    });
    expect(at(5).objects[0].cells[0].value).toBe(-5);
    expect(at(0).output).toBe('');
  });

  it.each([
    'array-traversal',
    'bubble-sort',
    'array-empty',
    'assignment-div-zero',
    'array-out-of-bounds',
  ])(
    'preserves the entire presentation after reverse and arbitrary restoration: %s',
    async (key) => {
      const { at, result } = await load(key);
      const original = JSON.stringify(result);
      const frames = Array.from({ length: result.trace!.steps.length + 1 }, (_, cursor) =>
        at(cursor),
      );
      for (let cursor = frames.length - 1; cursor >= 0; cursor--)
        expect(at(cursor)).toEqual(frames[cursor]);
      for (let i = 0; i < frames.length; i++) {
        const cursor = (i * 37) % frames.length;
        expect(at(cursor)).toEqual(frames[cursor]);
      }
      expect(JSON.stringify(result)).toBe(original);
    },
  );

  it('marks array record initialization and keeps duplicates, negatives and zero unchanged', async () => {
    const { at, result } = await load('bubble-sort');
    const initialize = result.trace!.steps.find(
      (step) =>
        step.kind === 'value.initialize' &&
        step.changes.some((c) => c.op === 'record' && c.table === 'objects'),
    )!;
    const array = at(initialize.seq).objects.find((o) => o.name === 'values')!;
    expect(array.cells.map((c) => c.value)).toEqual([4, -1, 4, 0]);
    expect(array.cells.every((c) => c.written)).toBe(true);
    expect(array.length).toBe(4);
    const comparison = result.trace!.steps.find((step) =>
      step.observations.some((o) => o.kind === 'evaluate' && o.operator === '>'),
    )!;
    const frame = at(comparison.seq);
    expect(frame.events.some((text) => text.startsWith('比较 '))).toBe(true);
    expect(frame.counters).toEqual(at(comparison.seq).counters);
    const end = at(result.trace!.steps.length - 1).objects.find((o) => o.name === 'values')!;
    expect(end.cells.map((c) => c.value)).toEqual([-1, 0, 4, 4]);
  });

  it('renders logical empty input as zero cells even with a physical one-zero placeholder', async () => {
    const { at, result } = await load('array-empty');
    const cursor = result.trace!.steps.find(
      (step) =>
        step.kind === 'object.declare' &&
        step.changes.some(
          (c) =>
            c.op === 'record' &&
            c.table === 'objects' &&
            c.after &&
            'kind' in c.after &&
            c.after.kind === 'int-array',
        ),
    )!.seq;
    const array = at(cursor).objects.find((o) => o.name === 'values')!;
    expect(array).toMatchObject({ length: 0, storageLength: 1, cells: [] });
    expect(at(result.trace!.steps.length).output).toBe('0\n');
  });

  it('uses removed object identity for a real return-expression read while keeping the live panel empty', async () => {
    const sample = await load();
    const catalog = structuredClone(sample.catalog);
    catalog.program = {
      ...catalog.program,
      sourceExample: catalog.program.sourceExample.replace('return 0;', 'return x;'),
    };
    initSync({
      module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
    });
    const request = sample.request;
    request.source = JSON.parse(
      new TextDecoder().decode(
        prepare_input(
          JSON.stringify(catalog),
          new TextEncoder().encode(JSON.stringify(request.input.values)),
          1000,
        ),
      ),
    ).source;
    request.engineRef.buildId = engineBuild.wasmSha256;
    const result = await decodeResult(
      execute_request(
        encodeRequest(request),
        JSON.stringify(catalog),
        engineBuild.wasmSha256,
        1000,
      ).slice().buffer,
      request,
    );
    expect(result.terminal.status).toBe('completed');
    const model = new PlayerModel();
    model.acceptValidated(model.begin(result.identity), result);
    model.seek(result.trace!.steps.length);
    const frame = presentTrace(
      model.snapshot(),
      result,
      request.input.values,
      catalog.program.bindings,
    )!;
    expect(frame.objects).toEqual([]);
    expect(frame.events).toContain('读取 x (o1)：-5');
    expect(frame.retired).toEqual(['x (o1，s1)']);
  });

  it('rejects a stale result identity for the current view', async () => {
    const { model, result, request, catalog } = await load();
    const old = structuredClone(result);
    old.identity.sourceRevision++;
    expect(
      presentTrace(model.snapshot(), old, request.input.values, catalog.program.bindings),
    ).toBeNull();
  });

  it('bounds sparse-capacity projection and does not bind a same-name shadow to input (synthetic rendering boundary)', async () => {
    const { result, model, request, catalog } = await load('array-empty');
    const beforeReturn = result.trace!.steps.length - 1;
    model.seek(beforeReturn);
    const view = model.snapshot();
    const bound = view.state!.objects.find((o) => o.name === 'values')!;
    const extra = {
      ...structuredClone(bound),
      id: 'o999',
      scopeId: 's999',
      declarationNodeId: 'n999',
      length: 262144,
      defaultValue: null,
      cells: [{ index: 262143, value: 9 }],
    };
    view.state!.objects.push(extra);
    const frame = presentTrace(view, result, request.input.values, catalog.program.bindings)!;
    expect(frame.objects.find((o) => o.id === bound.id)!.cells).toEqual([]);
    const shadow = frame.objects.find((o) => o.id === 'o999')!;
    expect(shadow.length).toBe(262144);
    expect(shadow.cells).toHaveLength(VISIBLE_CELLS);
    expect(shadow.cells.every((c) => c.value === null)).toBe(true);
    view.state!.objects.push(
      ...Array.from({ length: 100 }, (_, i) => ({ ...extra, id: `oextra${i}` })),
    );
    const bounded = presentTrace(view, result, request.input.values, catalog.program.bindings)!;
    expect(bounded.objects).toHaveLength(VISIBLE_OBJECTS);
    expect(bounded.objectCount).toBeGreaterThan(VISIBLE_OBJECTS);
  });
});
