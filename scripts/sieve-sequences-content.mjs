import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { initSync, execute_advanced } from '../web/src/generated/advanced/c_viz_advanced.js';
import { checkExampleSchema } from './examples-content.mjs';
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
export function validateSieveSequences(
  value = json('content/algorithms/cpp/sieve-sequences-1.0.0.json'),
) {
  checkExampleSchema(value, json('content/algorithms/cpp/sieve-sequences-1.0.0.schema.json'));
  const course = json('content/c/p05/course-1.0.0.json');
  assert.deepEqual(value.packageRef, { id: course.packageId, version: course.packageVersion });
  const slugs = ['eratosthenes-sieve', 'euler-sieve', 'maximum-subarray', 'strict-lis'];
  for (const [i, s] of value.cases.entries()) {
    assert.equal(s.id, 'case.cpp.' + slugs[i]);
    assert.deepEqual(s.programRef, { id: 'program.cpp.' + slugs[i], version: '1.0.0' });
    assert.equal(s.sourceFile, 'content/algorithms/cpp/' + slugs[i] + '-1.0.0.cpp');
    assert.equal(s.inputKind, i < 2 ? 'bound' : 'sequence');
    const lesson = course.lessons.find(
      (l) => l.id === s.prerequisiteLessonRef.id && l.version === s.prerequisiteLessonRef.version,
    );
    assert(lesson);
    assert.deepEqual(s.knowledgeRefs, lesson.knowledgeRefs);
    const valid = (values) =>
      Array.isArray(values) &&
      (i < 2
        ? values.length === 1 && Number.isInteger(values[0]) && values[0] >= 0 && values[0] <= 30
        : values.length <= 30 && values.every((v) => Number.isInteger(v) && v >= -999 && v <= 999));
    assert(valid(s.defaults.values));
    assert.equal(s.samples.length, i < 2 ? 10 : 12);
    assert.equal(new Set(s.samples.map((x) => x.key)).size, s.samples.length);
    for (const sample of s.samples) {
      assert(valid(sample.values));
      assert(sample.expectedStdout.endsWith('\n'));
    }
    const source = readFileSync(s.sourceFile, 'utf8');
    assert.equal(source.split('{{n}}').length, i < 2 ? 1 : 2);
    assert(Buffer.byteLength(source) <= 32768);
    assert(source.includes('std::cin') && source.includes('std::cout'));
    const expectedArrays = [
      ['composite', 'marks'],
      ['composite', 'marks', 'primes'],
      ['values', 'ending'],
      ['values', 'dp'],
    ][i];
    assert.deepEqual(
      s.arrays.map((a) => a.name),
      expectedArrays,
    );
    for (const a of s.arrays) {
      assert.equal(a.extent, a.name === 'primes' ? 'count' : i < 2 ? 'bound' : 'input');
      assert(source.includes('int ' + a.name + '[' + (i < 2 ? '31' : '30') + ']'));
    }
  }
  return { cases: 4, samples: 44, learningAuthority: false };
}
export function executeSieveSequences() {
  const value = json('content/algorithms/cpp/sieve-sequences-1.0.0.json');
  validateSieveSequences(value);
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
  return value.cases.flatMap((s) =>
    s.samples.map((sample) => {
      const source = readFileSync(s.sourceFile, 'utf8').replace(
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
        input: { kind: 'integers', values: [...sample.values] },
      };
      const bytes = execute_advanced(new TextEncoder().encode(canonical(request)), buildId, 1000),
        result = JSON.parse(new TextDecoder().decode(bytes));
      assert.equal(
        result.terminal.status,
        'completed',
        s.id + '/' + sample.key + ':' + JSON.stringify(result.terminal),
      );
      assert.equal(result.terminal.returnValue, 0);
      const output = result.trace.steps
        .flatMap((step) => step.changes.filter((c) => c.op === 'output').map((c) => c.append))
        .join('');
      assert.equal(output, sample.expectedStdout, s.id + '/' + sample.key);
      return {
        caseRef: { id: s.id, version: s.version },
        sample: sample.key,
        input: request.input,
        steps: result.trace.steps.length,
        resultBytes: bytes.length,
        output,
        returnValue: result.terminal.returnValue,
      };
    }),
  );
}
