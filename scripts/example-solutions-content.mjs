import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { initSync, execute_advanced } from '../web/src/generated/advanced/c_viz_advanced.js';
import { checkExampleSchema, validateExamples } from './examples-content.mjs';
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
export function validateSolutions(value = read('content/advanced/example-solutions-1.0.0.json')) {
  validateExamples();
  checkExampleSchema(value, read('content/advanced/example-solutions-1.0.0.schema.json'));
  const base = read('content/advanced/examples-1.0.0.json');
  const suffix = ['two-sum-merge-pointers', 'move-zeroes-swap', 'search-insert-closed'];
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const set = value.examples[i],
      spec = base.examples[i];
    assert.deepEqual(set.exampleRef, { id: spec.id, version: spec.version });
    assert.deepEqual(set.solutions[0].solutionRef, spec.solutionRef);
    assert.deepEqual(set.solutions[0].programRef, spec.programRef);
    assert.equal(set.solutions[0].sourceFile, spec.sourceFile);
    assert.deepEqual(set.solutions[1].solutionRef, {
      id: 'solution.cpp.' + suffix[i],
      version: '1.0.0',
    });
    assert.deepEqual(set.solutions[1].programRef, {
      id: 'program.cpp.example-' + suffix[i],
      version: '1.0.0',
    });
    assert.equal(
      set.solutions[1].sourceFile,
      'content/advanced/example-' + suffix[i] + '-1.0.0.cpp',
    );
    for (const s of set.solutions) {
      ids.push(s.solutionRef.id, s.programRef.id);
      const source = readFileSync(s.sourceFile, 'utf8');
      assert.equal(source.split('{{n}}').length, 2);
      assert(Buffer.byteLength(source) <= 32768);
      assert(source.includes('std::cin') && source.includes('std::cout'));
    }
    assert.equal(
      new Set([...spec.samples, ...set.supplementalSamples].map((s) => s.key)).size,
      spec.samples.length + 3,
    );
    for (const sample of set.supplementalSamples) {
      assert(sample.values.length >= spec.minItems && sample.values.length <= 12);
      assert(sample.values.every((v) => Number.isInteger(v) && v >= -999 && v <= 999));
      assert(
        spec.hasTarget
          ? Number.isInteger(sample.target) && sample.target >= -999 && sample.target <= 999
          : sample.target === undefined,
      );
      assert(
        !spec.strictlyIncreasing || sample.values.every((v, k) => !k || sample.values[k - 1] < v),
      );
      assert(sample.expectedStdout.endsWith('\n'));
    }
  }
  assert.equal(new Set(ids).size, 12);
  return { examples: 3, solutions: 6, samplePairs: 28, executions: 56, learningAuthority: false };
}
export function executeSolutionSamples() {
  const value = read('content/advanced/example-solutions-1.0.0.json'),
    base = read('content/advanced/examples-1.0.0.json');
  validateSolutions(value);
  const wasm = readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm'),
    buildId = createHash('sha256').update(wasm).digest('hex');
  initSync({ module: new WebAssembly.Module(wasm) });
  const canonical = (v) =>
    JSON.stringify(v, (_, x) =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.fromEntries(
            Object.keys(x)
              .sort()
              .map((k) => [k, x[k]]),
          )
        : x,
    );
  return value.examples.flatMap((set, i) =>
    [...base.examples[i].samples, ...set.supplementalSamples].flatMap((sample) =>
      set.solutions.map((solution) => {
        const source = readFileSync(solution.sourceFile, 'utf8').replace(
          '{{n}}',
          String(sample.values.length),
        );
        const request = {
          execVersion: '1.4.0',
          dslVersion: '1.3.0',
          diagnosticVersion: '1.3.0',
          integerEncoding: '1.0.0',
          language: 'cpp',
          engineId: 'engine.rust.advanced',
          runId: randomUUID(),
          sourceRevision: randomUUID(),
          source,
          input: {
            kind: 'integers',
            values: [...sample.values, ...(base.examples[i].hasTarget ? [sample.target] : [])],
          },
        };
        const bytes = execute_advanced(new TextEncoder().encode(canonical(request)), buildId, 1000),
          result = JSON.parse(new TextDecoder().decode(bytes));
        assert.equal(
          result.terminal.status,
          'completed',
          solution.title + '/' + sample.key + ':' + JSON.stringify(result.terminal),
        );
        assert.equal(result.terminal.returnValue, sample.expectedReturn);
        const output = result.trace.steps
          .flatMap((s) => s.changes.filter((c) => c.op === 'output').map((c) => c.append))
          .join('');
        assert.equal(output, sample.expectedStdout, solution.title + '/' + sample.key);
        return {
          exampleRef: set.exampleRef,
          solutionRef: solution.solutionRef,
          sample: sample.key,
          input: request.input,
          runId: request.runId,
          steps: result.trace.steps.length,
          output,
          returnValue: result.terminal.returnValue,
          resultBytes: bytes.length,
        };
      }),
    ),
  );
}
