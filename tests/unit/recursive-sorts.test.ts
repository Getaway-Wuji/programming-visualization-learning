import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initSync, execute_algorithm } from '../../web/src/generated/algorithm/c_viz_algorithm';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import { algorithmRequest } from '../../web/src/engine/algorithm-client';
import {
  decodeAlgorithmResult,
  encodeAlgorithmRequest,
} from '../../web/src/engine/algorithm-protocol';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import { prepareSort, recursiveSortCases } from '../../web/src/algorithms/content';
import { slotValue } from '../../web/src/algorithms/presentation';

beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/algorithm/c_viz_algorithm_bg.wasm') }),
);
describe('16.5 actual recursive C++ programs', () => {
  for (const spec of recursiveSortCases) {
    for (const [name, values] of Object.entries({
      default: spec.defaultInput,
      empty: [],
      single: [0],
      duplicates: [3, -2, 3, -2, 0, 3],
      ends: [-999, 999, 0, 999, -999],
      sorted: Array.from({ length: 30 }, (_, i) => i - 15),
      reverse: Array.from({ length: 30 }, (_, i) => 15 - i),
      equal: Array(30).fill(999) as number[],
      mixed: Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -999 : i % 3 === 1 ? 999 : 0)),
    }))
      it(`${spec.id} ${name}: sorted output, real aliases, depth, full reverse`, async () => {
        const prepared = prepareSort(spec, values),
          request = algorithmRequest(prepared.source, 'cpp', prepared.input);
        const bytes = execute_algorithm(
          encodeAlgorithmRequest(request),
          engineBuild.wasmSha256,
          1000,
        ).slice();
        const result = await decodeAlgorithmResult(bytes.buffer, request, engineBuild.wasmSha256);
        expect(result.terminal.status).toBe('completed');
        expect(result.trace?.completeness).toBe('complete');
        const player = new AlgorithmPlayer();
        player.accept(result);
        const initial = player.snapshot();
        let maxFrames = 0,
          aliasSeen = false,
          scratchSeen = false;
        for (let i = 0; i <= result.trace!.steps.length; i++) {
          player.seek(i);
          const state = player.snapshot().state!;
          maxFrames = Math.max(maxFrames, state.frames.length);
          for (const scope of state.scopes)
            for (const alias of scope.aliases) {
              aliasSeen = true;
              expect(state.objects.some((o) => o.id === alias.objectId)).toBe(true);
            }
          const scratch = state.objects.find((o) => o.name === 'scratch');
          if (scratch) {
            scratchSeen = true;
            expect(scratch.length).toBe(30);
          }
          if (i && i % 97 === 0) {
            const saved = player.snapshot();
            player.seek(i - 1);
            player.seek(i);
            expect(player.snapshot()).toEqual(saved);
          }
        }
        expect(maxFrames).toBeLessThanOrEqual(7);
        expect(aliasSeen).toBe(true);
        expect(scratchSeen).toBe(spec.id.endsWith('merge-sort'));
        expect(player.snapshot().state!.output).toBe(
          [...values]
            .sort((a, b) => a - b)
            .map((v) => `${v} `)
            .join('') + '\n',
        );
        expect(player.snapshot().state!.objects).toEqual([]);
        const outputIndex = result.trace!.steps.findIndex((s) =>
          s.changes.some((c) => c.op === 'output'),
        );
        player.seek(outputIndex);
        const array = player.snapshot().state!.objects.find((o) => o.name === 'values')!;
        expect(Array.from({ length: values.length }, (_, i) => slotValue(array, i))).toEqual(
          [...values].sort((a, b) => a - b),
        );
        for (let i = result.trace!.steps.length; i >= 0; i--) player.seek(i);
        expect(player.snapshot()).toEqual(initial);
        expect(request.input).toEqual(values);
        expect(result.stats.fuelUsed).toBeLessThan(1000000);
      });
  }
});
