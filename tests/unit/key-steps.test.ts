import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import {
  initSync as initAlgorithm,
  execute_algorithm,
} from '../../web/src/generated/algorithm/c_viz_algorithm';
import {
  initSync as initMemory,
  execute_memory,
} from '../../web/src/generated/memory/c_viz_memory';
import { engineBuild as algorithmBuild } from '../../web/src/generated/algorithm/engine-build';
import { engineBuild as memoryBuild } from '../../web/src/generated/memory/engine-build';
import { algorithmRequest } from '../../web/src/engine/algorithm-client';
import { memoryRequest } from '../../web/src/engine/memory-client';
import {
  decodeAlgorithmResult,
  encodeAlgorithmRequest,
} from '../../web/src/engine/algorithm-protocol';
import { decodeMemoryResult, encodeMemoryRequest } from '../../web/src/engine/memory-protocol';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { allSortCases, prepareSort } from '../../web/src/algorithms/content';
import { classicCases, prepareClassic } from '../../web/src/classics/content';
import { keyStepCursors, nextStepCursor } from '../../web/src/player/key-steps';

beforeAll(() => {
  initAlgorithm({ module: readFileSync('web/src/generated/algorithm/c_viz_algorithm_bg.wasm') });
  initMemory({ module: readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm') });
});

for (const spec of allSortCases)
  it(`key stops preserve all recorded C++ states and reverse recovery: ${spec.id}`, async () => {
    const prepared = prepareSort(spec, [3, -1, 2]),
      request = algorithmRequest(prepared.source, 'cpp', prepared.input);
    const bytes = execute_algorithm(
      encodeAlgorithmRequest(request),
      algorithmBuild.wasmSha256,
      1000,
    ).slice();
    const result = await decodeAlgorithmResult(bytes.buffer, request, algorithmBuild.wasmSha256);
    const keys = keyStepCursors(result),
      all = new AlgorithmPlayer(),
      selected = new AlgorithmPlayer();
    all.accept(result);
    selected.accept(result);
    expect(result.terminal.status).toBe('completed');
    expect(keys.length).toBeLessThan(result.trace!.steps.length);
    for (const cursor of keys.slice(1)) {
      selected.play();
      selected.tick(nextStepCursor(keys, selected.snapshot().cursor, 1));
      selected.pause();
      all.seek(cursor);
      expect(selected.snapshot()).toEqual(all.snapshot());
    }
    for (const cursor of keys.slice(0, -1).reverse()) {
      selected.seek(nextStepCursor(keys, selected.snapshot().cursor, -1));
      all.seek(cursor);
      expect(selected.snapshot()).toEqual(all.snapshot());
    }
    expect(selected.snapshot().state).toEqual(result.trace!.initialState);
  });

for (const spec of classicCases)
  it(`memory-backed key stops preserve recursive frames, aliases and output: ${spec.id}`, async () => {
    const prepared = prepareClassic(spec, spec.defaultInput.join(' ')),
      request = memoryRequest(prepared.source, 'cpp', prepared.input);
    const bytes = execute_memory(
      encodeMemoryRequest(request),
      memoryBuild.wasmSha256,
      1000,
    ).slice();
    const result = await decodeMemoryResult(bytes.buffer, request, memoryBuild.wasmSha256);
    const keys = keyStepCursors(result),
      all = new MemoryPlayer(),
      selected = new MemoryPlayer();
    all.accept(result);
    selected.accept(result);
    for (const cursor of [...keys, ...keys.toReversed()]) {
      selected.seek(cursor);
      all.seek(cursor);
      expect(selected.snapshot()).toEqual(all.snapshot());
    }
    expect(selected.snapshot().state).toEqual(result.trace!.initialState);
  });
