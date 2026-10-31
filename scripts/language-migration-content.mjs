import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkExampleSchema } from './examples-content.mjs';
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
export function validateLanguageMigration(
  value = json('content/advanced/language-migration-1.0.0.json'),
) {
  const schema = json('content/advanced/language-migration-1.0.0.schema.json');
  checkExampleSchema(value, schema);
  const enums = (v, s) => {
    if (s.enum) assert(s.enum.some((x) => JSON.stringify(x) === JSON.stringify(v)));
    if (s.type === 'object') for (const [key, x] of Object.entries(v)) enums(x, s.properties[key]);
    if (s.type === 'array') v.forEach((x) => enums(x, s.items));
  };
  enums(value, schema);
  const order = ['c', 'cpp', 'python', 'java'];
  assert.deepEqual(value.languageOrder, order);
  assert.deepEqual(
    value.languages.map((l) => l.id),
    order,
  );
  assert.deepEqual(
    value.languages.map((l) => l.defaultTarget),
    ['cpp', 'python', 'java', 'cpp'],
  );
  const urls = [
    ['https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf'],
    ['https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2017/n4659.pdf'],
    [
      'https://docs.python.org/3.13/library/stdtypes.html',
      'https://docs.python.org/3.13/reference/simple_stmts.html#assignment-statements',
      'https://docs.python.org/3.13/tutorial/controlflow.html',
    ],
    [
      'https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html',
      'https://docs.oracle.com/javase/specs/jls/se21/html/jls-10.html',
      'https://docs.oracle.com/javase/specs/jls/se21/html/jls-14.html',
      'https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html',
      'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/String.html',
    ],
  ];
  value.languages.forEach((l, i) =>
    assert.deepEqual(
      l.sourceRefs.map((r) => r.url),
      urls[i],
    ),
  );
  const base = json('content/c/p05/course-1.0.0.json');
  assert.deepEqual(value.packageRef, { id: base.packageId, version: base.packageVersion });
  assert.deepEqual(
    value.topics.map((t) => t.id),
    ['integers', 'conditions', 'loops', 'arrays', 'strings', 'functions'],
  );
  assert.deepEqual(
    value.topics.map((t) => t.lessonRef.id),
    [
      'quotient-remainder',
      'boolean-logic',
      'loops',
      'array-update',
      'logical-length-guards',
      'scope-shadowing',
    ].map((s) => 'lesson.c.' + s),
  );
  for (const topic of value.topics) {
    const same = (a, b) => a.id === b.id && a.version === b.version;
    const lesson = base.lessons.find((l) => same(l, topic.lessonRef));
    assert(lesson);
    assert.deepEqual(topic.knowledgeRefs, lesson.knowledgeRefs);
    assert(lesson.requiredExerciseRefs.length > 0);
    assert(lesson.requiredExerciseRefs.every((r) => base.exercises.some((e) => same(e, r))));
    assert.deepEqual(Object.keys(topic.snippets), order);
    for (const snippet of Object.values(topic.snippets)) {
      const lines = snippet.code.split('\n');
      assert(lines.length >= 1 && lines.length <= 24);
      assert(lines.every((line) => line.length <= 120 && !line.includes('\r')));
      for (const step of snippet.steps) {
        assert(new Set(step.lines).size === step.lines.length);
        assert(step.lines.every((line) => line >= 1 && line <= lines.length));
      }
    }
  }
  return {
    topics: 6,
    languages: 4,
    snippets: 24,
    annotations: 72,
    orderedPairs: 12,
    learningAuthority: false,
    executionAuthority: false,
  };
}
