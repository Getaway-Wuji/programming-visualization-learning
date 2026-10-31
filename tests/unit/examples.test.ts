import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  examples,
  parseExampleInput,
  prepareExample,
  validExampleInput,
} from '../../web/src/examples/content';
import { initSync, execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import { advancedRequest } from '../../web/src/engine/advanced-client';
import {
  decodeAdvancedResult,
  encodeAdvancedRequest,
  projectAdvancedStep,
} from '../../web/src/engine/advanced-protocol';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
initSync({
  module: new WebAssembly.Module(
    new Uint8Array(readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
  ),
});

describe('reviewed classical C++ examples', () => {
  it('validates the closed manifest and rejects unknown fields, wrong references and external source URLs', () => {
    const script = `import{validateExamples}from'./scripts/examples-content.mjs';import{readFileSync}from'node:fs';const source=JSON.parse(readFileSync('content/advanced/examples-1.0.0.json'));validateExamples();let rejected=0;for(const edit of [s=>s.extra=true,s=>s.schemaVersion='99.0.0',s=>s.examples[0].prerequisiteLessonRef.version='99.0.0',s=>s.examples[0].source.url='https://example.com/wrong',s=>s.examples[0].samples[0].values=[],s=>s.examples[0].knowledgeRefs=[],s=>s.examples[0].source.authorization='confirmed']){const s=structuredClone(source);edit(s);try{validateExamples(s);}catch{rejected++;}}if(rejected!==7)throw Error('bad content accepted');`;
    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script]),
    ).not.toThrow();
  });
  it('does not accept malformed, oversized, fractional or empty input', () => {
    for (const spec of examples) {
      const target = spec.hasTarget ? '9' : '';
      for (const draft of [
        '',
        '[]',
        '1e2 3',
        '3.5 4',
        '<script> 1',
        '1000 2',
        Array(13).fill('0').join(' '),
      ])
        expect(parseExampleInput(spec, draft, target).valid).toBe(false);
      expect(() => prepareExample(spec, { values: [] })).toThrow('E_INPUT_INVALID');
    }
  });
  it('preserves input without sorting and validates strict order only where required', () => {
    const search = examples[2];
    expect(parseExampleInput(search, '3 1', '2').valid).toBe(false);
    expect(parseExampleInput(search, '1 1', '2').valid).toBe(false);
    expect(parseExampleInput(search, '-3, 1，9', '2').input.values).toEqual([-3, 1, 9]);
    expect(parseExampleInput(examples[0], '5 5', '10').valid).toBe(true);
    expect(parseExampleInput(examples[1], '0 0', '').valid).toBe(true);
    expect(parseExampleInput(examples[0], '2 3', '').valid).toBe(false);
  });
  it('does not mutate the defaults and prepares exactly the visible program and bounded input', () => {
    for (const spec of examples) {
      const before = structuredClone(spec.defaults),
        prepared = prepareExample(spec, spec.defaults);
      expect(spec.defaults).toEqual(before);
      expect(prepared.input).toEqual([
        ...before.values,
        ...(spec.hasTarget ? [before.target!] : []),
      ]);
      expect(prepared.source).toBe(
        readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(before.values.length)),
      );
      expect(prepared.source).not.toContain('{{n}}');
      expect(prepared.input.length).toBeLessThanOrEqual(30);
    }
  });
  for (const spec of examples)
    for (const sample of spec.samples)
      it(`${spec.id}/${sample.key}: real C++ and every atomic reverse`, async () => {
        expect(validExampleInput(spec, sample)).toBe(true);
        const prepared = prepareExample(spec, sample),
          request = advancedRequest(prepared.source, 'cpp', {
            kind: 'integers',
            values: prepared.input,
          });
        const bytes = execute_advanced(
          encodeAdvancedRequest(request),
          engineBuild.wasmSha256,
          1000,
        );
        const result = await decodeAdvancedResult(
          bytes.slice().buffer,
          request,
          engineBuild.wasmSha256,
        );
        expect(result.language).toBe('cpp');
        expect(result.terminal).toMatchObject({
          status: 'completed',
          returnValue: sample.expectedReturn,
        });
        const trace = result.trace!;
        let state = structuredClone(trace.initialState);
        for (const step of trace.steps) state = projectAdvancedStep(state, step, result.types);
        expect(state.output).toBe(sample.expectedStdout);
        for (let i = trace.steps.length - 1; i >= 0; i--)
          state = projectAdvancedStep(state, trace.steps[i], result.types, true);
        expect(state).toEqual(trace.initialState);
      });
  it('missing runtime input produces an honest failure prefix and fresh execution recovers', async () => {
    const prepared = prepareExample(examples[0], examples[0].defaults);
    const request = advancedRequest(prepared.source, 'cpp', {
      kind: 'integers',
      values: prepared.input.slice(0, -1),
    });
    const raw = execute_advanced(encodeAdvancedRequest(request), engineBuild.wasmSha256, 1000);
    const result = await decodeAdvancedResult(raw.slice().buffer, request, engineBuild.wasmSha256);
    expect(result.terminal).toMatchObject({ status: 'error', code: 'E_INPUT_EXHAUSTED' });
    expect(result.trace?.completeness).toBe('prefix');
    const fresh = advancedRequest(prepared.source, 'cpp', {
      kind: 'integers',
      values: prepared.input,
    });
    const bytes = execute_advanced(encodeAdvancedRequest(fresh), engineBuild.wasmSha256, 1000);
    expect(
      (await decodeAdvancedResult(bytes.slice().buffer, fresh, engineBuild.wasmSha256)).terminal
        .returnValue,
    ).toBe(0);
  });
});
