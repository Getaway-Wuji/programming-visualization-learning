import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { beforeAll, expect, it } from 'vitest';
import {
  advancedAlgorithms,
  parseAlgorithmInput,
  prepareAdvancedAlgorithm,
  projectAlgorithmArrays,
  type AdvancedAlgorithmSpec,
} from '../../web/src/advanced-algorithms/content';
import { initSync, execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import { advancedRequest } from '../../web/src/engine/advanced-client';
import {
  encodeAdvancedRequest,
  decodeAdvancedResult,
  projectAdvancedStep,
  type AdvancedState,
} from '../../web/src/engine/advanced-protocol';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
beforeAll(() =>
  initSync({
    module: new WebAssembly.Module(
      new Uint8Array(readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
    ),
  }),
);
async function real(spec: AdvancedAlgorithmSpec, values: number[]) {
  const p = prepareAdvancedAlgorithm(spec, values),
    request = advancedRequest(p.source, 'cpp', { kind: 'integers', values: p.input }),
    bytes = execute_advanced(encodeAdvancedRequest(request), engineBuild.wasmSha256, 1000),
    result = await decodeAdvancedResult(bytes.slice().buffer, request, engineBuild.wasmSha256);
  let state = structuredClone(result.trace!.initialState);
  for (const step of result.trace!.steps) state = projectAdvancedStep(state, step, result.types);
  return { request, result, state };
}
it('closed schema rejects unknown fields, changed stable refs/arrays and invalid sample domains', () => {
  const script = `import{validateSieveSequences}from'./scripts/sieve-sequences-content.mjs';import{readFileSync}from'node:fs';const v=JSON.parse(readFileSync('content/algorithms/cpp/sieve-sequences-1.0.0.json'));validateSieveSequences();let n=0;for(const edit of[v=>v.extra=1,v=>v.learningAuthority=true,v=>v.cases[0].programRef.version='2.0.0',v=>v.cases[1].sourceFile=v.cases[0].sourceFile,v=>v.cases[0].samples[0].values=[31],v=>v.cases[1].defaults.values=[],v=>v.cases[2].samples[0].values=Array(31).fill(1),v=>v.cases[3].knowledgeRefs=[],v=>v.cases[3].arrays[1].name='fake']){const c=structuredClone(v);edit(c);try{validateSieveSequences(c)}catch{n++}}if(n!==9)throw Error('mutation accepted');`;
  expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', script])).not.toThrow();
});
it('input is format/domain-only, distinguishes explicit empty from missing, and refuses excessive slots', () => {
  for (const spec of advancedAlgorithms) {
    for (const draft of ['', '1e1', '2.5', '<script>', '1000', '1;2'])
      expect(parseAlgorithmInput(spec, draft).valid).toBe(false);
    if (spec.inputKind === 'bound') {
      for (const draft of ['[]', '-1', '31', '1 2'])
        expect(parseAlgorithmInput(spec, draft).valid).toBe(false);
      expect(parseAlgorithmInput(spec, '0').values).toEqual([0]);
      expect(parseAlgorithmInput(spec, '30').valid).toBe(true);
    } else {
      expect(parseAlgorithmInput(spec, '[]')).toMatchObject({ valid: true, values: [] });
      expect(parseAlgorithmInput(spec, '3,-1，2').values).toEqual([3, -1, 2]);
      expect(parseAlgorithmInput(spec, Array(31).fill('0').join(' ')).valid).toBe(false);
    }
  }
});
it('displayed template is the actual cpp source, fixed capacities remain positive and inputs are independent', () => {
  for (const spec of advancedAlgorithms) {
    const before = structuredClone(spec.defaults.values),
      p = prepareAdvancedAlgorithm(spec, before);
    expect(before).toEqual(spec.defaults.values);
    expect(p.input).toEqual(before);
    expect(p.input).not.toBe(before);
    expect(p.source).toBe(
      readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(before.length)),
    );
    if (spec.inputKind === 'sequence') {
      const empty = prepareAdvancedAlgorithm(spec, []);
      expect(empty.source).toContain('int n = 0');
      expect(empty.source).toContain('int values[30]');
      expect(empty.input).toEqual([]);
    }
    expect(() => prepareAdvancedAlgorithm(spec, Array(31).fill(0))).toThrow('E_INPUT_INVALID');
  }
});
for (const spec of advancedAlgorithms)
  for (const sample of spec.samples)
    it(`real cpp/full atomic reverse ${spec.id}/${sample.key}`, async () => {
      const { request, result, state } = await real(spec, sample.values);
      expect(result.language).toBe('cpp');
      expect(result.identity.runId).toBe(request.runId);
      expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0 });
      expect(state.output).toBe(sample.expectedStdout);
      expect(state.control.inputCursor).toBe(sample.values.length);
      const trace = result.trace!;
      let mid = structuredClone(trace.initialState);
      for (const step of trace.steps.slice(0, Math.floor(trace.steps.length / 2)))
        mid = projectAdvancedStep(mid, step, result.types);
      for (const a of projectAlgorithmArrays(spec, sample.values, mid)) {
        const o = mid.objects.find((o) => o.alive && o.name === a.name);
        expect(a.present).toBe(!!o);
        if (o) {
          expect(a.capacity).toBe(spec.inputKind === 'bound' ? 31 : 30);
          for (const [v, i] of a.values.map((v, i) => [v, i] as const))
            expect(v).toBe(
              o.cells.find((c) => c.byteOffset === i * 4)?.value ?? (o.zeroInitialized ? 0 : null),
            );
        }
      }
      let reverse = state;
      for (let i = trace.steps.length - 1; i >= 0; i--)
        reverse = projectAdvancedStep(reverse, trace.steps[i], result.types, true);
      expect(reverse).toEqual(trace.initialState);
    });
const isPrime = (n: number) => {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
};
it('all31 sieve upper bounds match independent trial division; Euler real composite writes are unique and marks reflect events', async () => {
  for (let upper = 0; upper <= 30; upper++) {
    const expected =
        Array.from({ length: upper + 1 }, (_, i) => i)
          .filter(isPrime)
          .join(' ') + '\n',
      outputs = [];
    for (const spec of advancedAlgorithms.slice(0, 2)) {
      const { result, state } = await real(spec, [upper]);
      expect(result.terminal.status).toBe('completed');
      expect(state.output).toBe(expected);
      outputs.push(state.output);
      let live = structuredClone(result.trace!.initialState);
      const writes = new Map<number, number>();
      for (const step of result.trace!.steps) {
        const node = result.nodeMap.find((n) => n.nodeId === step.nodeId)!;
        const text = new TextDecoder().decode(
          new TextEncoder()
            .encode(prepareAdvancedAlgorithm(spec, [upper]).source)
            .slice(node.byteRange.start, node.byteRange.end),
        );
        if (step.kind === 'value.write' && text.startsWith('composite[multiple] = 1')) {
          const multiple = live.objects.find((o) => o.alive && o.name === 'multiple')?.cells[0]
            ?.value;
          expect(typeof multiple).toBe('number');
          const delta = step.changes.find((c) => c.op === 'counters');
          expect(
            delta && delta.op === 'counters'
              ? delta.after.arrayWrites - delta.before.arrayWrites
              : 0,
          ).toBe(1);
          writes.set(multiple as number, (writes.get(multiple as number) ?? 0) + 1);
        }
        if (
          step.changes.some(
            (c) =>
              c.op === 'record' &&
              c.table === 'objects' &&
              c.before &&
              'name' in c.before &&
              c.before.name === 'marks' &&
              c.before.alive &&
              (!c.after || ('alive' in c.after && !c.after.alive)),
          )
        )
          break;
        live = projectAdvancedStep(live, step, result.types);
      }
      const composite = live.objects.find((o) => o.name === 'composite')!,
        marks = live.objects.find((o) => o.name === 'marks')!,
        changedCells = new Map<number, number>();
      for (const step of result.trace!.steps)
        for (const c of step.changes)
          if (c.op === 'cell' && c.objectId === composite.id && c.byteOffset >= 8 && c.after === 1)
            changedCells.set(c.byteOffset / 4, (changedCells.get(c.byteOffset / 4) ?? 0) + 1);
      for (let n = 2; n <= upper; n++) {
        const recorded = marks.cells.find((c) => c.byteOffset === n * 4)?.value ?? 0;
        expect(recorded).toBe(writes.get(n) ?? 0);
        if (spec.id.endsWith('euler-sieve')) {
          expect(writes.get(n) ?? 0).toBe(isPrime(n) ? 0 : 1);
          expect(changedCells.get(n) ?? 0).toBe(writes.get(n) ?? 0);
        } else if (isPrime(n)) expect(writes.get(n) ?? 0).toBe(0);
        else expect(writes.get(n) ?? 0).toBeGreaterThan(0);
      }
    }
    expect(outputs[0]).toBe(outputs[1]);
  }
});
function bruteSum(a: number[]) {
  if (!a.length) return 0;
  let best = -Infinity;
  for (let l = 0; l < a.length; l++) {
    let sum = 0;
    for (let r = l; r < a.length; r++) {
      sum += a[r];
      best = Math.max(best, sum);
    }
  }
  return best;
}
function bruteLis(a: number[]) {
  let best = 0;
  for (let mask = 0; mask < 1 << a.length; mask++) {
    let previous = -Infinity,
      length = 0,
      valid = true;
    for (let i = 0; i < a.length; i++)
      if (mask & (1 << i)) {
        if (a[i] <= previous) valid = false;
        previous = a[i];
        length++;
      }
    if (valid) best = Math.max(best, length);
  }
  return best;
}
it('all121 short signed sequences agree with independent subarray/subset enumeration, including empty and duplicates', async () => {
  for (let length = 0; length <= 4; length++)
    for (let encoded = 0; encoded < 3 ** length; encoded++) {
      let code = encoded;
      const a = Array.from({ length }, () => {
        const v = [-2, 0, 2][code % 3];
        code = Math.floor(code / 3);
        return v;
      });
      for (const [i, spec] of advancedAlgorithms.slice(2).entries()) {
        const { result, state } = await real(spec, a);
        expect(result.terminal.status).toBe('completed');
        expect(Number(state.output.trim())).toBe(i ? bruteLis(a) : bruteSum(a));
      }
    }
});
it('missing runtime input preserves an honest reversible prefix and a fresh real run recovers', async () => {
  const p = prepareAdvancedAlgorithm(advancedAlgorithms[3], [4, 9]),
    request = advancedRequest(p.source, 'cpp', { kind: 'integers', values: [4] }),
    bytes = execute_advanced(encodeAdvancedRequest(request), engineBuild.wasmSha256, 1000),
    result = await decodeAdvancedResult(bytes.slice().buffer, request, engineBuild.wasmSha256);
  expect(result.terminal).toMatchObject({ status: 'error', code: 'E_INPUT_EXHAUSTED' });
  expect(result.trace?.completeness).toBe('prefix');
  let state: AdvancedState = structuredClone(result.trace!.initialState);
  for (const step of result.trace!.steps) state = projectAdvancedStep(state, step, result.types);
  for (let i = result.trace!.steps.length - 1; i >= 0; i--)
    state = projectAdvancedStep(state, result.trace!.steps[i], result.types, true);
  expect(state).toEqual(result.trace!.initialState);
  expect((await real(advancedAlgorithms[3], [4, 9])).state.output).toBe('2\n');
});
