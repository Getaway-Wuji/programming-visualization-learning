import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initSync, execute_algorithm } from '../../web/src/generated/algorithm/c_viz_algorithm';
import { engineBuild } from '../../web/src/generated/algorithm/engine-build';
import { algorithmRequest } from '../../web/src/engine/algorithm-client';
import {
  encodeAlgorithmRequest,
  decodeAlgorithmResult,
  type AlgorithmRequest,
  type AlgorithmState,
} from '../../web/src/engine/algorithm-protocol';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import {
  structureCases,
  parseOperations,
  prepareStructure,
} from '../../web/src/structures/content';
import { slotValue } from '../../web/src/algorithms/presentation';
import { structureView } from '../../web/src/structures/presentation';
type Op = { kind: 'in'; value: number } | { kind: 'out' };
const put = (value: number): Op => ({ kind: 'in', value }),
  take = (): Op => ({ kind: 'out' }),
  fill = [put(-999), put(0), put(999), put(0), put(-3)];
const samples: Record<string, Op[]> = {
  default: [put(7), put(-3), take(), put(0), take(), put(9), take()],
  empty: [],
  singleIn: [put(-999)],
  singleOut: [take()],
  ends: [put(-999), put(999), take(), take()],
  duplicates: [put(0), put(0), take(), put(0), take(), take()],
  fill,
  fullThenOut: [...fill, put(2), take()],
  drain: [...fill, ...Array.from({ length: 6 }, take)],
  alternateMax: Array.from({ length: 10 }, () => [put(0), take()]).flat(),
  allInMax: Array.from({ length: 15 }, (_, i) => put(i % 2 ? -999 : 999)),
  allOutMax: Array.from({ length: 30 }, take),
  wrap: [
    ...[1, 2, 3, 4, 5].map(put),
    put(99),
    take(),
    take(),
    take(),
    put(6),
    put(7),
    put(8),
    ...Array.from({ length: 6 }, take),
  ],
  order: [put(7), put(-3), put(999), take(), take(), put(0), take(), take()],
};
const draft = (ops: Op[]) =>
  ops.length ? ops.map((op) => (op.kind === 'in' ? `入 ${op.value}` : '出')).join('\n') : '[]';
const scalar = (state: AlgorithmState, name: string) => {
  const object = state.objects.find((o) => o.kind === 'int' && o.name === name);
  return object ? slotValue(object, 0) : null;
};
beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/algorithm/c_viz_algorithm_bg.wasm') }),
);
async function real(request: AlgorithmRequest) {
  const bytes = execute_algorithm(
    encodeAlgorithmRequest(request),
    engineBuild.wasmSha256,
    1000,
  ).slice();
  return decodeAlgorithmResult(bytes.buffer, request, engineBuild.wasmSha256);
}
for (const spec of structureCases)
  for (const [name, ops] of Object.entries(samples))
    it(`${spec.id} actual Rust ${name}: committed LIFO/FIFO, physical bounds, outcomes and full reverse`, async () => {
      const prepared = prepareStructure(spec, draft(ops)),
        request = algorithmRequest(prepared.source, 'cpp', prepared.input),
        result = await real(request);
      expect(request.source).toBe(
        readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(prepared.input.length)),
      );
      expect(request.input).toEqual(ops.flatMap((op) => (op.kind === 'in' ? [1, op.value] : [2])));
      expect(result.language).toBe('cpp');
      expect(result.terminal.status).toBe('completed');
      expect(result.terminal.returnValue).toBe(0);
      expect(result.trace?.completeness).toBe('complete');
      const player = new AlgorithmPlayer();
      player.accept(result);
      const initial = player.snapshot(),
        logical: number[] = [],
        lines: string[] = [];
      let seen = 0,
        consumed = 0,
        acceptedWrites = 0,
        maxFrames = 0;
      for (let cursor = 1; cursor <= result.trace!.steps.length; cursor++) {
        player.seek(cursor);
        const state = player.snapshot().state!,
          data = state.objects.find((o) => o.name === 'data'),
          top = scalar(state, 'top'),
          head = scalar(state, 'head'),
          tail = scalar(state, 'tail'),
          processed = scalar(state, 'processed');
        const step = result.trace!.steps[cursor - 1],
          projection = structureView(state, step, spec);
        expect(projection.layoutIssue).toBe(false);
        maxFrames = Math.max(maxFrames, state.frames.length);
        if (data) {
          expect(data.length).toBe(5);
          expect(data.defaultValue).toBeNull();
          if (spec.kind === 'stack' && top !== null) {
            expect(top >= 0 && top <= 5).toBe(true);
            for (let i = 0; i < top; i++) expect(slotValue(data, i)).not.toBeNull();
          }
          if (spec.kind === 'circular-queue' && head !== null && tail !== null) {
            expect(head >= 0 && tail >= head && tail - head <= 5).toBe(true);
            for (let i = head; i < tail; i++) expect(slotValue(data, i % 5)).not.toBeNull();
          }
        }
        if (processed !== null && processed > seen) {
          expect(processed).toBe(seen + 1);
          const op = ops[seen];
          let outcome: number;
          if (op.kind === 'in') {
            consumed += 2;
            if (logical.length === 5) {
              lines.push(`FULL ${op.value}`);
              outcome = 3;
            } else {
              logical.push(op.value);
              acceptedWrites++;
              lines.push(`IN ${op.value}`);
              outcome = 1;
            }
          } else {
            consumed++;
            if (!logical.length) {
              lines.push('EMPTY');
              outcome = 4;
            } else {
              const value = spec.kind === 'stack' ? logical.pop()! : logical.shift()!;
              lines.push(`OUT ${value}`);
              outcome = 2;
            }
          }
          expect(scalar(state, 'outcome')).toBe(outcome);
          expect(state.control.inputCursor).toBe(consumed);
          expect(scalar(state, 'consumed')).toBe(consumed);
          expect(state.output).toBe(lines.join('\n') + '\n');
          expect(
            Array.from({ length: logical.length }, (_, i) =>
              slotValue(data!, spec.kind === 'stack' ? i : (head! + i) % 5),
            ),
          ).toEqual(logical);
          expect(spec.kind === 'stack' ? top : tail! - head!).toBe(logical.length);
          expect(projection.logical?.map((item) => item.value)).toEqual(logical);
          expect(state.counters.arrayWrites).toBe(acceptedWrites);
          seen++;
        }
        if (cursor % 79 === 0) {
          const saved = player.snapshot();
          player.seek(cursor - 1);
          player.seek(cursor);
          expect(player.snapshot()).toEqual(saved);
        }
      }
      expect(seen).toBe(ops.length);
      expect(maxFrames).toBe(1);
      expect(player.snapshot().state!.output).toBe(
        (lines.length ? lines.join('\n') + '\n' : '') + 'END\n',
      );
      expect(player.snapshot().state!.objects).toEqual([]);
      expect(player.snapshot().state!.frames).toEqual([]);
      expect(result.stats.fuelUsed).toBeLessThan(1000000);
      for (let cursor = result.trace!.steps.length; cursor >= 0; cursor--) player.seek(cursor);
      expect(player.snapshot()).toEqual(initial);
    });
for (const spec of structureCases)
  it(`${spec.id} syntax/encoding never simulates capacity; malformed wire gets real diagnostic or nonzero stop`, async () => {
    for (const text of [
      '',
      ' ',
      'push 1',
      '入',
      '出 1',
      '入 1e2',
      '入 0x10',
      '入 1.5',
      '入 1000',
      '入 -1000',
      '[]\n出',
      Array(16).fill('入 1').join('\n'),
      Array(31).fill('出').join('\n'),
    ])
      expect(parseOperations(spec, text).valid).toBe(false);
    expect(parseOperations(spec, Array(6).fill('入 1').join('\n')).valid).toBe(true);
    expect(parseOperations(spec, '入 -0\n\n出').encoded).toEqual([1, 0, 2]);
    expect(parseOperations(spec, '[]').encoded).toEqual([]);
    const source = prepareStructure(spec, '出').source,
      bad = await real(algorithmRequest(source, 'cpp', [9]));
    expect(bad.terminal.status).toBe('completed');
    expect(bad.terminal.returnValue).toBe(1);
    const stopped = new AlgorithmPlayer();
    stopped.accept(bad);
    stopped.seek(bad.trace!.steps.length);
    expect(stopped.snapshot().state!.output).toBe('INVALID 9\n');
    const exhausted = await real(
      algorithmRequest(prepareStructure(spec, '入 7').source, 'cpp', [1]),
    );
    expect(exhausted.terminal.code).toBe('E_INPUT_EXHAUSTED');
    expect(exhausted.trace?.completeness).toBe('prefix');
    const prefix = new AlgorithmPlayer();
    prefix.accept(exhausted);
    const initial = prefix.snapshot();
    prefix.seek(exhausted.trace!.steps.length);
    prefix.seek(0);
    expect(prefix.snapshot()).toEqual(initial);
  });
