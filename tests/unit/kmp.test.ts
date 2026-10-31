import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { beforeAll, expect, it } from 'vitest';
import { initSync, execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import {
  advancedRequest,
  type AdvancedExecutionClient,
} from '../../web/src/engine/advanced-client';
import {
  encodeAdvancedRequest,
  decodeAdvancedResult,
  projectAdvancedStep,
  canonicalAdvancedJson,
  type AdvancedState,
  type AdvancedRequest,
} from '../../web/src/engine/advanced-protocol';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
import {
  kmpSpec,
  parseKmpInput,
  prepareKmp,
  projectKmpState,
} from '../../web/src/advanced-algorithms/kmp-content';
import { CustomCodeController } from '../../web/src/custom-code/controller';
beforeAll(() =>
  initSync({
    module: new WebAssembly.Module(
      new Uint8Array(readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
    ),
  }),
);
async function real(
  text: string,
  pattern: string,
  input: AdvancedRequest['input'] = { kind: 'lines', values: [text, pattern] },
) {
  const request = advancedRequest(prepareKmp(text, pattern).source, 'cpp', input),
    bytes = execute_advanced(encodeAdvancedRequest(request), engineBuild.wasmSha256, 1000);
  return {
    request,
    result: await decodeAdvancedResult(bytes.slice().buffer, request, engineBuild.wasmSha256),
  };
}
function naive(text: string, pattern: string) {
  for (let start = 0; start <= text.length - pattern.length; start++) {
    let same = true;
    for (let k = 0; k < pattern.length; k++) if (text[start + k] !== pattern[k]) same = false;
    if (same) return start;
  }
  return -1;
}
function borders(pattern: string) {
  return Array.from({ length: pattern.length }, (_, end) => {
    let best = 0;
    for (let length = 1; length <= end; length++)
      if (pattern.slice(0, length) === pattern.slice(end + 1 - length, end + 1)) best = length;
    return best;
  });
}
function prefixBeforeDestruction(result: Awaited<ReturnType<typeof real>>['result']) {
  let state = structuredClone(result.trace!.initialState),
    last = projectKmpState(state);
  for (const step of result.trace!.steps) {
    state = projectAdvancedStep(state, step, result.types);
    const view = projectKmpState(state);
    if (view.prefix.present && view.scalars.phase === 2) last = view;
  }
  return last;
}
it('closed KMP schema rejects changed identity, authority, unknown fields, missing rows and invalid strings', () => {
  const script = `import{validateKmp}from'./scripts/kmp-content.mjs';import{readFileSync}from'node:fs';const v=JSON.parse(readFileSync('content/algorithms/cpp/kmp-1.0.0.json'));validateKmp();let n=0;for(const edit of[v=>v.extra=1,v=>v.learningAuthority=true,v=>v.case.id='fake',v=>delete v.case.defaults.pattern,v=>v.case.defaults.text='é',v=>v.case.samples[0].text='a'.repeat(31),v=>v.case.samples[1].pattern=String.fromCharCode(10),v=>v.case.knowledgeRefs=[]]){const c=structuredClone(v);edit(c);try{validateKmp(c)}catch{n++}}if(n!==8)throw Error('mutation accepted');`;
  expect(() => execFileSync(process.execPath, ['--input-type=module', '-e', script])).not.toThrow();
});
it('empty and spaces are exact data; missing, control, nonASCII and oversize drafts are invalid', () => {
  for (const [text, pattern] of [
    ['', ''],
    [' ', ''],
    [' a ', ' '],
    ['~"\\', '~'],
  ])
    expect(parseKmpInput(text, pattern).valid).toBe(true);
  for (const bad of [undefined, null, 0, [], 'é', '中', '\n', '\t', '\0', '\x7f', 'a'.repeat(31)]) {
    expect(parseKmpInput(bad, '').valid).toBe(false);
    expect(parseKmpInput('', bad).valid).toBe(false);
    expect(() => prepareKmp(bad, '')).toThrow('E_INPUT_INVALID');
  }
});
it('source is a constant actual C++ program and both submitted rows are independently copied', () => {
  const a = prepareKmp(' ab ', ''),
    b = prepareKmp('different', 'x');
  expect(a.source).toBe(readFileSync(kmpSpec.sourceFile, 'utf8'));
  expect(b.source).toBe(a.source);
  expect(a.input).toEqual({ kind: 'lines', values: [' ab ', ''] });
  expect(a.input.values).not.toBe(b.input.values);
  expect(a.source).toContain('int prefix[30];');
  expect(a.source).not.toContain('{{');
});
for (const sample of kmpSpec.samples)
  it(`real KMP, prefix oracle and every atomic reverse: ${sample.key}`, async () => {
    const { request, result } = await real(sample.text, sample.pattern),
      expected = borders(sample.pattern),
      trace = result.trace!;
    expect(request.input).toEqual({ kind: 'lines', values: [sample.text, sample.pattern] });
    expect(result.language).toBe('cpp');
    expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0 });
    let state = structuredClone(trace.initialState),
      mid: AdvancedState | null = null;
    for (const [i, step] of trace.steps.entries()) {
      state = projectAdvancedStep(state, step, result.types);
      const v = projectKmpState(state);
      if (v.prefix.present) {
        expect(v.prefix.capacity).toBe(30);
        expect(v.prefix.extent).toBe(sample.pattern.length);
        v.prefix.values.forEach((n, k) => {
          if (n !== null) expect(n).toBe(expected[k]);
        });
      }
      if (i + 1 === Math.floor(trace.steps.length / 2)) mid = structuredClone(state);
    }
    expect(state.output).toBe(sample.expectedStdout);
    expect(sample.expectedIndex).toBe(naive(sample.text, sample.pattern));
    expect(state.control.inputCursor).toBe(2);
    expect(prefixBeforeDestruction(result).prefix.values).toEqual(expected);
    for (let k = trace.steps.length - 1; k >= 0; k--) {
      state = projectAdvancedStep(state, trace.steps[k], result.types, true);
      if (k === Math.floor(trace.steps.length / 2)) expect(state).toEqual(mid);
    }
    expect(state).toEqual(trace.initialState);
  });
const strings = [
  '',
  'a',
  'b',
  'aa',
  'ab',
  'ba',
  'bb',
  'aaa',
  'aab',
  'aba',
  'abb',
  'baa',
  'bab',
  'bba',
  'bbb',
];
for (const text of strings)
  it(`independent short-string result and true-border oracle: text=${JSON.stringify(text)}`, async () => {
    for (const pattern of strings) {
      const { result } = await real(text, pattern);
      expect(result.terminal.status).toBe('completed');
      const state = prefixBeforeDestruction(result);
      expect(state.prefix.values).toEqual(borders(pattern));
      const output = result
        .trace!.steps.flatMap((s) =>
          s.changes.filter((c) => c.op === 'output').map((c) => c.append),
        )
        .join('');
      expect(output).toBe(naive(text, pattern) + '\n');
    }
  });
it('real multi-level prefix and matching fallback read the old prefix entry, with fixed text cursor', async () => {
  const { result } = await real('a'.repeat(29) + 'c', 'a'.repeat(29) + 'b');
  let state = structuredClone(result.trace!.initialState),
    buildFalls = 0,
    matchFalls = 0;
  for (const step of result.trace!.steps) {
    const before = projectKmpState(state);
    state = projectAdvancedStep(state, step, result.types);
    const after = projectKmpState(state);
    for (const [phase, key] of [
      [1, 'border'],
      [2, 'matched'],
    ] as const) {
      const a = before.scalars[key],
        b = after.scalars[key];
      if (before.scalars.phase === phase && a !== null && b !== null && a > b) {
        expect(b).toBe(before.prefix.values[a - 1]);
        if (phase === 1) {
          buildFalls++;
          expect(after.scalars.buildIndex).toBe(before.scalars.buildIndex);
        } else {
          matchFalls++;
          expect(after.scalars.textIndex).toBe(before.scalars.textIndex);
        }
      }
    }
  }
  expect(buildFalls).toBe(28);
  expect(matchFalls).toBe(29);
});
it('missing second input preserves actual prefix and cursor; invalid raw requests reject, then fresh input recovers', async () => {
  const { result } = await real('abc', 'a', { kind: 'lines', values: ['abc'] });
  expect(result.terminal).toMatchObject({ status: 'error', code: 'E_INPUT_EXHAUSTED' });
  let state = structuredClone(result.trace!.initialState);
  for (const step of result.trace!.steps) state = projectAdvancedStep(state, step, result.types);
  expect(state.control.inputCursor).toBe(1);
  for (const step of [...result.trace!.steps].reverse())
    state = projectAdvancedStep(state, step, result.types, true);
  expect(state).toEqual(result.trace!.initialState);
  for (const values of [
    ['abc', 'é'],
    ['a'.repeat(31), 'a'],
    ['abc', '\n'],
  ]) {
    const request = advancedRequest(prepareKmp('', '').source, 'cpp', { kind: 'lines', values });
    expect(() => encodeAdvancedRequest(request)).toThrow('E_PROTOCOL_INVALID');
    expect(() =>
      execute_advanced(
        new TextEncoder().encode(canonicalAdvancedJson(request)),
        engineBuild.wasmSha256,
        1000,
      ),
    ).toThrow();
  }
  expect((await real('abc', 'b')).result.terminal.status).toBe('completed');
});
it('shared controller dispatches the tagged lines union and keeps existing integer calls compatible', async () => {
  const requests: AdvancedRequest[] = [],
    client = {
      invalidate() {},
      cancel() {},
      async execute(request: AdvancedRequest) {
        requests.push(request);
        throw Error('controlled-dispatch-only');
      },
    };
  const controller = new CustomCodeController(client as unknown as AdvancedExecutionClient),
    input = { kind: 'lines' as const, values: [' a ', ''] };
  await controller.execute(prepareKmp('', '').source, 'cpp', input);
  input.values[0] = 'changed';
  expect(requests[0].input).toEqual({ kind: 'lines', values: [' a ', ''] });
  await controller.execute('int main(){return 0;}', 'c', [7]);
  expect(requests[1].input).toEqual({ kind: 'integers', values: [7] });
});
