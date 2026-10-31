import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Closed, local schema subset; no remote refs, executable expressions or coercion. */
export function validateAdvancedSchema(value, schema, path = '$') {
  if ('const' in schema) assert.deepEqual(value, schema.const, path);
  if (schema.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), path);
    assert.deepEqual(Object.keys(value).sort(), schema.required.toSorted(), path);
    for (const [key, child] of Object.entries(schema.properties))
      validateAdvancedSchema(value[key], child, `${path}.${key}`);
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), path);
    assert.ok(value.length >= schema.minItems && value.length <= schema.maxItems, path);
    assert.equal(new Set(value.map((item) => JSON.stringify(item))).size, value.length, path);
    value.forEach((item, index) => validateAdvancedSchema(item, schema.items, `${path}[${index}]`));
  } else if (schema.type === 'string') {
    assert.equal(typeof value, 'string', path);
    assert.ok(
      value.length >= (schema.minLength ?? 1) && value.length <= (schema.maxLength ?? Infinity),
      path,
    );
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), path);
  }
}

export function validateAdvancedCourse(course = read('content/advanced/course-1.0.0.json')) {
  validateAdvancedSchema(course, read('content/advanced/course-1.0.0.schema.json'));
  const base = read('content/c/p05/course-1.0.0.json');
  const cases = ['iterative-sorts', 'recursive-sorts'].flatMap(
    (id) => read(`content/algorithms/cpp/${id}-1.0.0.json`).cases,
  );
  const same = (a, b) => a.id === b.id && a.version === b.version;
  assert.deepEqual(course.packageRef, { id: base.packageId, version: base.packageVersion });
  assert.equal(course.chapters.length, 2);
  assert.equal(course.lessons.length, 4);
  const refs = course.chapters.flatMap((chapter) => chapter.lessonRefs);
  assert.equal(new Set(course.chapters.map((chapter) => chapter.id)).size, 2);
  assert.equal(new Set(refs.map((ref) => ref.id)).size, 4);
  assert.deepEqual(
    refs,
    course.lessons.map((lesson) => lesson.lessonRef),
  );
  for (const entry of course.lessons) {
    const lesson = base.lessons.find((item) => same(item, entry.lessonRef));
    const spec = cases.find((item) => same(item, entry.caseRef));
    assert.ok(lesson && spec && spec.language === 'cpp');
    assert.deepEqual(entry.knowledgeRefs, lesson.knowledgeRefs);
    assert.ok(lesson.requiredExerciseRefs.length > 0);
    for (const ref of lesson.requiredExerciseRefs)
      assert.ok(base.exercises.some((item) => same(item, ref) && same(item.lessonRef, lesson)));
    assert.ok(readFileSync(spec.sourceFile, 'utf8').includes('std::cout'));
  }
  return { chapters: 2, reusedLessons: 4, newLearningEntities: 0, newEvents: 0 };
}
