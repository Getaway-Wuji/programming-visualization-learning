import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { initSync, execute_advanced } from '../web/src/generated/advanced/c_viz_advanced.js';
import { checkExampleSchema } from './examples-content.mjs';
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
export function validateKmp(value = json('content/algorithms/cpp/kmp-1.0.0.json')) {
  checkExampleSchema(value, json('content/algorithms/cpp/kmp-1.0.0.schema.json'));
  const course = json('content/c/p05/course-1.0.0.json'),
    spec = value.case;
  assert.deepEqual(value.packageRef, { id: course.packageId, version: course.packageVersion });
  const lesson = course.lessons.find(
    (l) =>
      l.id === spec.prerequisiteLessonRef.id && l.version === spec.prerequisiteLessonRef.version,
  );
  assert(lesson);
  assert.deepEqual(spec.knowledgeRefs, lesson.knowledgeRefs);
  const valid = (s) => typeof s === 'string' && /^[\x20-\x7e]{0,30}$/.test(s);
  assert(valid(spec.defaults.text) && valid(spec.defaults.pattern));
  assert.equal(spec.samples.length, 24);
  assert.equal(new Set(spec.samples.map((s) => s.key)).size, 24);
  for (const sample of spec.samples) {
    assert(valid(sample.text) && valid(sample.pattern));
    assert.equal(sample.expectedStdout, sample.expectedIndex + '\n');
    assert.equal(sample.expectedReturn, 0);
  }
  const source = readFileSync(spec.sourceFile, 'utf8');
  assert(Buffer.byteLength(source) <= 32768);
  assert(source.includes('int prefix[30];'));
  assert.equal((source.match(/std::getline\(std::cin,/g) ?? []).length, 2);
  assert(!source.includes('{{'));
  return {
    cases: 1,
    samples: 24,
    sourceBytes: Buffer.byteLength(source),
    learningAuthority: false,
  };
}
export function executeKmpSamples() {
  const value = json('content/algorithms/cpp/kmp-1.0.0.json');
  validateKmp(value);
  const wasm = readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm'),
    buildId = createHash('sha256').update(wasm).digest('hex');
  initSync({ module: new WebAssembly.Module(wasm) });
  const source = readFileSync(value.case.sourceFile, 'utf8');
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
  return value.case.samples.map((sample) => {
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
      input: { kind: 'lines', values: [sample.text, sample.pattern] },
    };
    const bytes = execute_advanced(new TextEncoder().encode(canonical(request)), buildId, 1000),
      result = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(
      result.terminal.status,
      'completed',
      sample.key + ':' + JSON.stringify(result.terminal),
    );
    assert.equal(result.terminal.returnValue, 0);
    const output = result.trace.steps
      .flatMap((step) => step.changes.filter((c) => c.op === 'output').map((c) => c.append))
      .join('');
    assert.equal(output, sample.expectedStdout, sample.key);
    return {
      caseRef: { id: value.case.id, version: value.case.version },
      sample: sample.key,
      input: request.input,
      steps: result.trace.steps.length,
      resultBytes: bytes.length,
      output,
      returnValue: result.terminal.returnValue,
    };
  });
}
