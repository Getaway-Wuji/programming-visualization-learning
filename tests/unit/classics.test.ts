import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initSync, execute_memory } from '../../web/src/generated/memory/c_viz_memory';
import { engineBuild } from '../../web/src/generated/memory/engine-build';
import { memoryRequest } from '../../web/src/engine/memory-client';
import {
  encodeMemoryRequest,
  decodeMemoryResult,
  type MemoryRequest,
} from '../../web/src/engine/memory-protocol';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { memorySlots } from '../../web/src/memory/presentation';
import { classicCases, prepareClassic, parseClassicInput } from '../../web/src/classics/content';
import { hanoiView } from '../../web/src/classics/presentation';
beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm') }),
);
async function real(r: MemoryRequest) {
  const b = execute_memory(encodeMemoryRequest(r), engineBuild.wasmSha256, 1000).slice();
  return decodeMemoryResult(b.buffer, r, engineBuild.wasmSha256);
}
function expected(kind: string, v: number[]) {
  if (kind === 'gcd') {
    const a = Math.abs(v[0]),
      b = Math.abs(v[1]);
    if (a === 0 && b === 0) return 'GCD 0\n';
    let d = 0;
    for (let n = 1; n <= Math.max(a, b); n++) if (a % n === 0 && b % n === 0) d = n;
    return `GCD ${d}\n`;
  }
  if (kind === 'prime')
    return `PRIME ${v[0] >= 2 && !Array.from({ length: Math.max(0, v[0] - 2) }, (_, i) => i + 2).some((d) => v[0] % d === 0) ? 1 : 0}\n`;
  const s = String(v[0]);
  return `PALINDROME ${v[0] >= 0 && s === [...s].reverse().join('') ? 1 : 0}\n`;
}
for (const spec of classicCases) {
  const samples =
    spec.kind === 'hanoi'
      ? Array.from({ length: 6 }, (_, n) => [n])
      : [
          spec.defaultInput,
          ...spec.boundarySamples.map((s) => s.input),
          ...(spec.kind === 'gcd'
            ? [
                [7, 7],
                [-999, 999],
                [1, 999],
              ]
            : spec.kind === 'prime'
              ? [[3], [4], [49], [121]]
              : [[-999], [1], [10], [909]]),
        ];
  for (const values of samples)
    it(`${spec.kind} ${values.join(',')}: actual C++, scalar/array truth and all atomic reverse`, async () => {
      const p = prepareClassic(spec, values.join(' ')),
        r = memoryRequest(p.source, 'cpp', p.input),
        result = await real(r);
      expect(r.source).toBe(readFileSync(spec.sourceFile, 'utf8'));
      expect(r.input).toEqual(values);
      expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0, code: null });
      expect(result.trace!.completeness).toBe('complete');
      const player = new MemoryPlayer();
      player.accept(result);
      const initial = player.snapshot(),
        pegs = [
          Array.from({ length: values[0] }, (_, i) => values[0] - 1 - i),
          [],
          [],
        ] as number[][];
      let maxFrames = 0,
        positionWrites = 0,
        positionsId = '',
        aliases = false;
      const moves: string[] = [];
      for (let i = 1; i <= player.snapshot().length; i++) {
        player.seek(i);
        const state = player.snapshot().state!,
          step = result.trace!.steps[i - 1];
        maxFrames = Math.max(maxFrames, state.frames.length);
        expect(state.objects.every((o) => o.storage === 'automatic')).toBe(true);
        for (const dead of state.objects.filter((o) => !o.alive)) expect(dead.cells).toEqual([]);
        if (spec.kind === 'hanoi') {
          const view = hanoiView(state, result.types);
          expect(view.layoutIssue).toBe(false);
          if (view.positions) positionsId = view.positions.id;
          for (const scope of state.scopes)
            if (scope.aliases.some((a) => a.name === 'positions')) {
              expect(scope.aliases.find((a) => a.name === 'positions')!.objectId).toBe(positionsId);
              aliases = true;
            }
          for (const change of step.changes)
            if (change.op === 'cell' && change.objectId === positionsId) {
              const disk = change.byteOffset / 4,
                from = change.before,
                to = change.after;
              expect(typeof from).toBe('number');
              expect(typeof to).toBe('number');
              expect(pegs[from as number].at(-1)).toBe(disk);
              const top = pegs[to as number].at(-1);
              expect(top === undefined || top > disk).toBe(true);
              pegs[from as number].pop();
              pegs[to as number].push(disk);
              positionWrites++;
              moves.push(`MOVE ${disk + 1} ${from} ${to}\n`);
            }
          if (view.positions) {
            const raw = memorySlots(view.positions, result.types);
            expect(raw).toHaveLength(5);
            expect(view.disks.map((d) => d.peg)).toEqual(
              raw.slice(0, values[0]).map((c) => c.value),
            );
            for (let d = 0; d < values[0]; d++)
              if (view.disks[d].peg !== null)
                expect(view.disks[d].peg).toBe(pegs.findIndex((peg) => peg.includes(d)));
          }
        }
        if (i % 89 === 0) {
          const saved = player.snapshot();
          player.seek(i - 1);
          player.seek(i);
          expect(player.snapshot()).toEqual(saved);
        }
      }
      const end = player.snapshot().state!;
      if (spec.kind === 'hanoi') {
        expect(positionWrites).toBe(2 ** values[0] - 1);
        expect(end.output).toBe(moves.join('') + `MOVES ${positionWrites}\n`);
        expect(pegs[0]).toEqual([]);
        expect(pegs[1]).toEqual([]);
        expect(pegs[2]).toEqual(Array.from({ length: values[0] }, (_, i) => values[0] - 1 - i));
        expect(aliases).toBe(true);
        expect(maxFrames).toBe(values[0] + 2);
      } else {
        expect(end.output).toBe(expected(spec.kind, values));
        expect(maxFrames).toBe(1);
      }
      expect(end.control.inputCursor).toBe(values.length);
      expect(end.frames).toEqual([]);
      expect(end.objects.every((o) => !o.alive && o.cells.length === 0)).toBe(true);
      expect(end.allocator.liveBytes).toBe(0);
      for (let i = result.trace!.steps.length - 1; i >= 0; i--) player.seek(i);
      expect(player.snapshot()).toEqual(initial);
      expect(result.stats.fuelUsed).toBeLessThan(1000000);
    });
  it(`${spec.kind} strict count/domain only and genuine missing-input prefix`, async () => {
    for (const draft of [
      '',
      '[]',
      '1.5',
      '1e2',
      '0x10',
      Array(spec.inputArity + 1)
        .fill('1')
        .join(' '),
      Array(spec.inputArity)
        .fill(String(spec.max + 1))
        .join(' '),
    ])
      expect(parseClassicInput(spec, draft).valid).toBe(false);
    expect(parseClassicInput(spec, Array(spec.inputArity).fill('-0').join('，')).values).toEqual(
      Array(spec.inputArity).fill(0),
    );
    const result = await real(
      memoryRequest(prepareClassic(spec, spec.defaultInput.join(' ')).source, 'cpp', []),
    );
    expect(result.terminal.code).toBe('E_INPUT_EXHAUSTED');
    expect(result.trace!.completeness).toBe('prefix');
    const player = new MemoryPlayer();
    player.accept(result);
    const start = player.snapshot();
    player.seek(result.trace!.steps.length);
    player.seek(0);
    expect(player.snapshot()).toEqual(start);
    if (spec.kind === 'hanoi') {
      const outside = await real(memoryRequest(prepareClassic(spec, '1').source, 'cpp', [-1]));
      expect(outside.terminal).toMatchObject({ status: 'completed', returnValue: 1 });
    }
  });
}
