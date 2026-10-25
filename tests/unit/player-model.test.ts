import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PlayerModel } from '../../web/src/player/model';
import { decodeResult, encodeRequest, makeAdapterResult } from '../../web/src/engine/protocol';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';
import { initSync, prepare_input, execute_request } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';

const base = new URL('../../项目文档/验收/07.3-真实轨迹/', import.meta.url);
const read = (key: string, file: string) => readFileSync(new URL(`${key}/${file}`, base));
async function archive(key = 'assignment') {
  const request = JSON.parse(read(key, 'request.json').toString()) as ExecuteRequest;
  const result = await decodeResult(Uint8Array.from(read(key, 'result.json')).buffer, request);
  return { request, result };
}
function loaded(result: ExecuteResult) {
  const player = new PlayerModel();
  expect(player.acceptValidated(player.begin(result.identity), result)).toBe(true);
  return player;
}

describe('08.1 state and restoration using validated real Rust traces', () => {
  it.each([
    'assignment',
    'array-traversal',
    'bubble-sort',
    'array-empty',
    'assignment-div-zero',
    'array-out-of-bounds',
  ])('restores every full state forward/backward and in arbitrary order: %s', async (key) => {
    const { result } = await archive(key);
    const original = JSON.stringify(result);
    const player = loaded(result);
    const states = [player.snapshot().state];
    const token = player.play()!;
    for (let cursor = 1; cursor <= result.trace!.steps.length; cursor++) {
      expect(player.tick(token)).toBe(true);
      const view = player.snapshot();
      expect(view.cursor).toBe(cursor);
      expect(view.location).toEqual(result.trace!.steps[cursor - 1].location);
      expect(view.observations).toEqual(result.trace!.steps[cursor - 1].observations);
      states.push(view.state);
    }
    expect(player.snapshot().status).toBe(
      result.terminal.status === 'completed' ? 'ended' : 'failed',
    );
    expect(player.tick(token)).toBe(false);
    for (let cursor = states.length - 1; cursor >= 0; cursor--) {
      expect(player.seek(cursor)).toBe(true);
      expect(player.snapshot().state).toEqual(states[cursor]);
    }
    for (let i = 0; i < states.length; i++) {
      const cursor = (i * 37) % states.length;
      player.seek(cursor);
      expect(player.snapshot().state).toEqual(states[cursor]);
    }
    player.seek(0);
    expect(player.snapshot().state).toEqual(result.trace!.initialState);
    expect(player.snapshot().location).toMatchObject({
      kind: 'synthetic',
      reason: 'initial-state',
    });
    expect(JSON.stringify(result)).toBe(original);
  });

  it('restores known scalar values, uninitialized cells, output and return destruction', async () => {
    const { result } = await archive();
    const player = loaded(result);
    player.seek(2);
    expect(player.snapshot().state!.objects[0]).toMatchObject({
      name: 'x',
      defaultValue: null,
      cells: [],
    });
    player.seek(3);
    expect(player.snapshot().state!.objects[0].cells).toEqual([{ index: 0, value: -7 }]);
    player.seek(4);
    expect(player.snapshot().state!.objects[0].cells).toEqual([{ index: 0, value: -5 }]);
    player.seek(5);
    const beforeReturn = player.snapshot().state!;
    expect(beforeReturn.output).toBe('-5\n');
    expect(beforeReturn.counters.scalarWrites).toBe(2);
    expect(beforeReturn.allocator.liveBytes).toBe(4);
    player.seek(6);
    expect(player.snapshot().state).toMatchObject({
      objects: [],
      frames: [],
      scopes: [],
      allocator: { liveBytes: 0 },
    });
    player.seek(5);
    expect(player.snapshot().state).toEqual(beforeReturn);
    player.seek(4);
    expect(player.snapshot().state!.output).toBe('');
  });

  it('keeps the real sorted values before destruction, and real failure prefixes distinct', async () => {
    const { result } = await archive('bubble-sort');
    const player = loaded(result);
    player.seek(result.trace!.steps.length - 1);
    const array = player.snapshot().state!.objects.find((o) => o.name === 'values')!;
    expect(
      Array.from(
        { length: array.length },
        (_, i) => array.cells.find((c) => c.index === i)?.value ?? array.defaultValue,
      ),
    ).toEqual([-1, 0, 4, 4]);
    const failed = loaded((await archive('assignment-div-zero')).result);
    expect(failed.snapshot().outcome!.status).toBe('program-error');
    expect(failed.snapshot().terminal).toBeNull();
    failed.seek(4);
    expect(failed.snapshot()).toMatchObject({
      status: 'failed',
      state: { output: '-7\n' },
      terminal: { diagnostics: [{ code: 'E_DIV_ZERO' }] },
    });
    failed.seek(3);
    expect(failed.snapshot().terminal).toBeNull();
    expect(failed.snapshot().status).toBe('paused');
    expect(failed.snapshot().outcome!.status).toBe('program-error');
  });

  it('pauses without changing state and rejects queued ticks after pause, seek and new runs', async () => {
    const { result } = await archive();
    const player = loaded(result);
    const first = player.play()!;
    expect(player.play()).toBe(first);
    player.tick(first);
    const before = player.snapshot();
    player.pause();
    expect(player.snapshot()).toEqual({ ...before, status: 'paused' });
    for (let i = 0; i < 20; i++) expect(player.tick(first)).toBe(false);
    const second = player.play()!;
    expect(second).not.toBe(first);
    expect(player.tick(first)).toBe(false);
    player.seek(3);
    expect(player.tick(second)).toBe(false);
    const third = player.play()!;
    player.begin(result.identity);
    expect(player.tick(third)).toBe(false);
    expect(player.snapshot()).toMatchObject({ status: 'loading', cursor: null, state: null });
  });

  it('rejects stale loads, mismatched identities and duplicate acceptance, and clears references', async () => {
    const { result } = await archive();
    const player = new PlayerModel();
    expect(player.snapshot().status).toBe('idle');
    const old = player.begin(result.identity);
    const current = player.begin(result.identity);
    expect(player.acceptValidated(old, result)).toBe(false);
    for (const key of Object.keys(result.identity)) {
      const altered = structuredClone(result);
      (altered.identity as unknown as Record<string, unknown>)[key] = 'stale';
      expect(player.acceptValidated(current, altered)).toBe(false);
    }
    expect(player.acceptValidated(current, result)).toBe(true);
    expect(player.acceptValidated(current, result)).toBe(false);
    player.invalidate();
    expect(player.acceptValidated(current, result)).toBe(false);
    expect(player.snapshot()).toMatchObject({
      status: 'idle',
      identity: null,
      cursor: null,
      state: null,
      outcome: null,
    });
  });

  it('does not expose mutable internal state and rejects invalid seeks atomically', async () => {
    const { result } = await archive();
    const player = loaded(result);
    player.seek(3);
    const view = player.snapshot();
    view.state!.objects[0].cells[0].value = 999;
    view.outcome!.status = 'cancelled';
    view.identity!.runId = 'bad';
    expect(player.snapshot().state!.objects[0].cells[0].value).toBe(-7);
    const token = player.play()!;
    const before = player.snapshot();
    for (const cursor of [-1, 7, 0.5, NaN, Infinity]) expect(player.seek(cursor)).toBe(false);
    expect(player.snapshot()).toEqual(before);
    expect(player.tick(token)).toBe(true);
  });

  it('handles no-trace adapter failure without fabricating initial state', async () => {
    const { request } = await archive();
    const player = loaded(makeAdapterResult(request, 'cancelled', 'E_CANCELLED'));
    expect(player.snapshot()).toMatchObject({
      status: 'failed',
      cursor: null,
      state: null,
      length: 0,
      location: null,
      terminal: { status: 'cancelled' },
    });
    expect(player.play()).toBeNull();
    expect(player.seek(0)).toBe(false);
  });

  it('handles a synthetic zero-step prefix as failed, never zero-step success (model boundary only)', async () => {
    // Explicit synthetic boundary: not a claim that this mutated packet came from Rust.
    const { result } = await archive('assignment-div-zero');
    result.trace!.steps = [];
    result.terminal.cursor = 0;
    const player = loaded(result);
    expect(player.snapshot()).toMatchObject({
      status: 'failed',
      cursor: 0,
      length: 0,
      state: result.trace!.initialState,
    });
    expect(player.snapshot().terminal).not.toBeNull();
    expect(player.seek(0)).toBe(true);
    expect(player.play()).toBeNull();
  });

  it('jumps across current real Rust n30 checkpoints and restores all 5330 steps', async () => {
    const { request } = await archive('bubble-sort');
    initSync({
      module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
    });
    const catalog = read('bubble-sort', 'catalog.json').toString();
    const values = { values: Array.from({ length: 30 }, (_, i) => 30 - i) };
    request.source = JSON.parse(
      new TextDecoder().decode(
        prepare_input(catalog, new TextEncoder().encode(JSON.stringify(values)), 1000),
      ),
    ).source;
    request.input.values = values;
    request.engineRef.buildId = engineBuild.wasmSha256;
    const result = await decodeResult(
      execute_request(encodeRequest(request), catalog, engineBuild.wasmSha256, 1000).slice().buffer,
      request,
    );
    expect(result.trace!.steps).toHaveLength(5330);
    const player = loaded(result);
    for (const checkpoint of [...result.trace!.checkpoints].reverse()) {
      player.seek(checkpoint.cursor);
      expect(player.snapshot().state).toEqual(checkpoint.state);
    }
    for (const cursor of [127, 128, 129, 255, 256, 257, 5329, 5330]) {
      player.seek(0);
      const token = player.play()!;
      for (let i = 0; i < cursor; i++) player.tick(token);
      const sequential = player.snapshot().state;
      player.seek(0);
      player.seek(cursor);
      expect(player.snapshot().state).toEqual(sequential);
    }
    expect(player.snapshot().state!.output).toBe(
      '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30\n',
    );
    for (let cursor = 5329; cursor >= 0; cursor--) player.seek(cursor);
    expect(player.snapshot().state).toEqual(result.trace!.initialState);
  });
});
