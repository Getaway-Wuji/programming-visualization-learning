import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initSync, execute_algorithm } from '../../web/src/generated/algorithm/c_viz_algorithm';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import { algorithmRequest } from '../../web/src/engine/algorithm-client';
import {
  encodeAlgorithmRequest,
  decodeAlgorithmResult,
} from '../../web/src/engine/algorithm-protocol';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import {
  bucketSortCases,
  prepareSort,
  parseSortInput,
  isRecursiveSort,
  sortCatalogFor,
} from '../../web/src/algorithms/content';
import { slotValue, sortExplanation } from '../../web/src/algorithms/presentation';
import { bucketRows } from '../../web/src/algorithms/bucket-presentation';
const spec = bucketSortCases[0];
beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/algorithm/c_viz_algorithm_bg.wasm') }),
);
const samples = {
  default: spec.defaultInput,
  empty: [],
  single: [29],
  duplicates: [5, -15, 5, -15, 0, 5],
  endpoints: [-20, 29, 29, -20],
  borders: [-20, -11, -10, -1, 0, 9, 10, 19, 20, 29],
  sorted30: Array.from({ length: 30 }, (_, i) => i - 10),
  reverse30: Array.from({ length: 30 }, (_, i) => 29 - i),
  allMin: Array(30).fill(-20) as number[],
  allMax: Array(30).fill(29) as number[],
  allZero: Array(30).fill(0) as number[],
  singleBucketFirst: Array.from({ length: 30 }, (_, i) => -11 - Math.floor(i / 3)),
  singleBucketLast: Array.from({ length: 30 }, (_, i) => 29 - Math.floor(i / 3)),
};
for (const [name, values] of Object.entries(samples))
  it(`actual C++ bucket ${name}: mappings, bounded storage, per-bucket sort, merge and full reverse`, async () => {
    const prepared = prepareSort(spec, values),
      request = algorithmRequest(prepared.source, 'cpp', prepared.input),
      bytes = execute_algorithm(
        encodeAlgorithmRequest(request),
        engineBuild.wasmSha256,
        1000,
      ).slice();
    const result = await decodeAlgorithmResult(bytes.buffer, request, engineBuild.wasmSha256);
    expect(result.language).toBe('cpp');
    expect(result.terminal.status).toBe('completed');
    expect(result.trace?.completeness).toBe('complete');
    const player = new AlgorithmPlayer();
    player.accept(result);
    const initial = player.snapshot();
    let dataId = '',
      scatterWrites = 0,
      maxFrames = 0,
      maxLive = 0;
    for (let i = 1; i <= result.trace!.steps.length; i++) {
      player.seek(i);
      const state = player.snapshot().state!;
      maxFrames = Math.max(maxFrames, state.frames.length);
      maxLive = Math.max(maxLive, state.allocator.liveBytes);
      const data = state.objects.find((o) => o.name === 'bucketData');
      if (data) {
        dataId = data.id;
        expect(data.length).toBe(150);
        expect(data.defaultValue).toBeNull();
      }
      const sizes = state.objects.find((o) => o.name === 'bucketSizes');
      if (sizes) {
        expect(sizes.length).toBe(5);
        for (let b = 0; b < 5; b++) {
          const size = slotValue(sizes, b);
          if (size !== null) expect(size >= 0 && size <= 30).toBe(true);
        }
      }
      const step = result.trace!.steps[i - 1],
        phase = sortExplanation(result, i, prepared);
      const rows = bucketRows(state, step, spec.bucketLayout!);
      if (data && rows) {
        expect(rows).toHaveLength(5);
        for (const row of rows) {
          expect(row.baseAddress).toBe(data.baseAddress + row.bucket * 120);
          expect(row.endAddress - row.baseAddress).toBe(120);
          for (const cell of row.cells) {
            expect(cell.value).toBe(slotValue(data, cell.physicalIndex));
            if (cell.pending) {
              expect(cell.write).toBe(true);
              expect(cell.index).toBeGreaterThanOrEqual(row.size ?? 0);
            }
          }
        }
      } else expect(rows).toBeNull();
      if (phase.title === '分配到真实桶')
        for (const c of step.changes)
          if (c.op === 'cell' && c.objectId === dataId) {
            expect(c.after).not.toBeNull();
            expect(Math.floor(c.index / 30)).toBe(Math.floor((c.after! + 20) / 10));
            scatterWrites++;
          }
      if (i % 83 === 0) {
        const saved = player.snapshot();
        player.seek(i - 1);
        player.seek(i);
        expect(player.snapshot()).toEqual(saved);
      }
    }
    expect(scatterWrites).toBe(values.length);
    expect(maxFrames).toBe(1);
    expect(maxLive).toBeLessThan(1048576);
    const firstOutput = result.trace!.steps.findIndex((s) =>
      s.changes.some((c) => c.op === 'output'),
    );
    player.seek(firstOutput);
    const state = player.snapshot().state!,
      array = state.objects.find((o) => o.name === 'values')!,
      data = state.objects.find((o) => o.name === 'bucketData')!,
      sizes = state.objects.find((o) => o.name === 'bucketSizes')!;
    expect(Array.from({ length: values.length }, (_, i) => slotValue(array, i))).toEqual(
      [...values].sort((a, b) => a - b),
    );
    for (let b = 0; b < 5; b++) {
      const expected = values.filter((v) => Math.floor((v + 20) / 10) === b).sort((a, b) => a - b);
      expect(slotValue(sizes, b)).toBe(expected.length);
      expect(
        Array.from({ length: expected.length }, (_, i) => slotValue(data, b * 30 + i)),
      ).toEqual(expected);
    }
    player.seek(result.trace!.steps.length);
    expect(player.snapshot().state!.output).toBe(
      [...values]
        .sort((a, b) => a - b)
        .map((v) => `${v} `)
        .join('') + '\n',
    );
    expect(player.snapshot().state!.objects).toEqual([]);
    expect(player.snapshot().state!.frames).toEqual([]);
    for (let i = result.trace!.steps.length; i >= 0; i--) player.seek(i);
    expect(player.snapshot()).toEqual(initial);
    expect(result.stats.fuelUsed).toBeLessThan(1000000);
  });
it('bucket bounds are closed and strict, source matches the metadata and recursive rights stay separate', () => {
  for (const text of ['', '1e2', '0x10', '29.5', '30', '-21', Array(31).fill('0').join(' ')])
    expect(parseSortInput(spec, text).valid).toBe(false);
  expect(parseSortInput(spec, '[]').values).toEqual([]);
  expect(parseSortInput(spec, '-20，+29,0').values).toEqual([-20, 29, 0]);
  expect(isRecursiveSort(spec)).toBe(false);
  expect(sortCatalogFor(spec)).toEqual({ id: 'catalog.cpp.bucket-sort', version: '1.0.0' });
  expect(prepareSort(spec, [29, -20]).source).toBe(
    readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', '2'),
  );
  expect(() => prepareSort(spec, [30])).toThrow('E_INPUT_INVALID');
});
