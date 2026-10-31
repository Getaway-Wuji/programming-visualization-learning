import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { initSync, execute_advanced } from '../web/src/generated/advanced/c_viz_advanced.js';
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
export function checkExampleSchema(value, schema, path = '$') {
  if ('const' in schema) assert.deepEqual(value, schema.const, path);
  if (schema.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), path);
    assert.ok(
      schema.required.every((k) => Object.hasOwn(value, k)),
      path,
    );
    assert.ok(
      Object.keys(value).every((k) => Object.hasOwn(schema.properties, k)),
      path,
    );
    for (const [k, v] of Object.entries(value))
      checkExampleSchema(v, schema.properties[k], path + '.' + k);
  } else if (schema.type === 'array') {
    assert.ok(
      Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems,
      path,
    );
    if (schema.uniqueItems)
      assert.equal(new Set(value.map((v) => JSON.stringify(v))).size, value.length, path);
    value.forEach((v, i) => checkExampleSchema(v, schema.items, path + '[' + i + ']'));
  } else if (schema.type === 'string') {
    assert.ok(
      typeof value === 'string' &&
        value.length >= (schema.minLength ?? 1) &&
        value.length <= (schema.maxLength ?? Infinity),
      path,
    );
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), path);
  } else if (schema.type === 'integer') {
    assert.ok(Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum, path);
  } else if (schema.type === 'boolean') assert.equal(typeof value, 'boolean', path);
}
export function validateExamples(registry = read('content/advanced/examples-1.0.0.json')) {
  checkExampleSchema(registry, read('content/advanced/examples-1.0.0.schema.json'));
  const base = read('content/c/p05/course-1.0.0.json');
  assert.deepEqual(registry.packageRef, { id: base.packageId, version: base.packageVersion });
  assert.deepEqual(
    registry.examples.map((e) => e.id),
    ['example.cpp.two-sum', 'example.cpp.move-zeroes', 'example.cpp.search-insert'],
  );
  const same = (a, b) => a.id === b.id && a.version === b.version,
    ids = [];
  const valid = (e, s) =>
    s.values.length >= e.minItems &&
    s.values.length <= e.maxItems &&
    s.values.every((v) => Number.isInteger(v) && v >= e.min && v <= e.max) &&
    (e.hasTarget
      ? Number.isInteger(s.target) && s.target >= e.min && s.target <= e.max
      : s.target === undefined) &&
    (!e.strictlyIncreasing || s.values.every((v, i) => i === 0 || s.values[i - 1] < v));
  for (const e of registry.examples) {
    const slug = e.id.slice('example.cpp.'.length);
    assert.equal(e.caseRef.id, 'case.cpp.example-' + slug);
    assert.equal(e.sourceFile, 'content/advanced/example-' + slug + '-1.0.0.cpp');
    const lesson = base.lessons.find((l) => same(l, e.prerequisiteLessonRef));
    assert.ok(lesson);
    assert.deepEqual(e.knowledgeRefs, lesson.knowledgeRefs);
    assert.ok(/^https:\/\/leetcode\.com\/problems\/[a-z-]+\/description\/$/.test(e.source.url));
    const expected = {
      'two-sum': [1, 'Two Sum'],
      'move-zeroes': [283, 'Move Zeroes'],
      'search-insert': [35, 'Search Insert Position'],
    }[slug];
    assert.equal(e.source.problemNumber, expected[0]);
    assert.equal(e.source.title, expected[1]);
    assert.equal(
      e.source.url,
      'https://leetcode.com/problems/' +
        (slug === 'search-insert' ? 'search-insert-position' : slug) +
        '/description/',
    );
    ids.push(e.id, e.caseRef.id, e.solutionRef.id, e.programRef.id);
    assert.ok(valid(e, e.defaults));
    assert.equal(new Set(e.samples.map((s) => s.key)).size, e.samples.length);
    for (const sample of e.samples) {
      assert.ok(valid(e, sample));
      assert.ok(sample.expectedStdout.endsWith('\n'));
    }
    const source = readFileSync(e.sourceFile, 'utf8');
    assert.equal(source.split('{{n}}').length, 2);
    assert.ok(
      Buffer.byteLength(source) < 32768 &&
        source.includes('std::cin') &&
        source.includes('std::cout'),
    );
    assert.equal(
      e.samples.some((s) => s.values.length === 12),
      true,
    );
  }
  assert.equal(new Set(ids).size, ids.length);
  return {
    examples: 3,
    solutions: 3,
    samples: registry.examples.reduce((n, e) => n + e.samples.length, 0),
    learningAuthority: false,
  };
}
/** Build-time execution of public examples; no browser or user learning data. */
export function executePublicExamples() {
  const registry = read('content/advanced/examples-1.0.0.json');
  validateExamples(registry);
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
  return registry.examples.flatMap((e) =>
    e.samples.map((sample) => {
      const source = readFileSync(e.sourceFile, 'utf8').replace(
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
          values: [...sample.values, ...(e.hasTarget ? [sample.target] : [])],
        },
      };
      const result = JSON.parse(
        new TextDecoder().decode(
          execute_advanced(new TextEncoder().encode(canonical(request)), buildId, 1000),
        ),
      );
      assert.equal(result.terminal.status, 'completed');
      assert.equal(result.terminal.returnValue, sample.expectedReturn);
      const output = result.trace.steps
        .flatMap((s) => s.changes.filter((c) => c.op === 'output').map((c) => c.append))
        .join('');
      assert.equal(output, sample.expectedStdout, e.id + '/' + sample.key);
      return {
        exampleRef: { id: e.id, version: e.version },
        sample: sample.key,
        steps: result.trace.steps.length,
        output,
        returnValue: result.terminal.returnValue,
      };
    }),
  );
}
