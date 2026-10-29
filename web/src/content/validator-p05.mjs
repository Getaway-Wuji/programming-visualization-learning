// Semantic gate for the exact frozen P0.5 curriculum. No execution or publication grant.
import { baseline } from './baseline.mjs';

export const p05Profiles = [
  ['first-output', 'entry-output'],
  ['printf-layout', 'printf-integer-layout'],
  ['ordered-updates', 'ordered-output-dependency'],
  ['reassign-value', 'scalar-reassignment'],
  ['swap-with-temp', 'temporary-swap'],
  ['shadowed-values', 'scope-shadow-output'],
  ['wide-product', 'safe-wide-product'],
  ['quotient-remainder', 'integer-quotient-remainder'],
  ['boolean-flags', 'boolean-classification'],
  ['guarded-division', 'short-circuit-guard'],
  ['absolute-with-if', 'if-positive-normalize'],
  ['sign-classification', 'nested-sign-branches'],
  ['in-closed-range', 'interval-membership'],
  ['while-countdown', 'while-countdown'],
  ['odd-sum-until-stop', 'break-continue-odd-sum'],
  ['grid-count', 'nested-grid-count'],
  ['partial-array-init', 'partial-array-initialization'],
  ['print-logical-array', 'logical-array-print'],
  ['safe-array-access', 'guarded-array-access'],
  ['array-extrema', 'array-extrema'],
  ['count-positive', 'array-positive-count'],
  ['linear-search-first', 'linear-first-index'],
  ['check-nondecreasing', 'adjacent-order-check'],
  ['bubble-sort', 'bubble-ascending'],
  ['selection-sort', 'selection-ascending'],
  ['binary-search-first', 'binary-first-index'],
];
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
const same = (a, b) => canonical(a) === canonical(b);
const hasRef = (values, entity) =>
  values.some((ref) => ref.id === entity.id && ref.version === entity.version);
const collectionNames = Object.keys(baseline);
const refTypes = {
  languageRef: 'languages',
  subsetRef: 'subsets',
  subsetRefs: 'subsets',
  chapterRef: 'chapters',
  lessonRefs: 'lessons',
  lessonRef: 'lessons',
  relatedLessonRefs: 'lessons',
  knowledgeRefs: 'knowledgePoints',
  prerequisiteRefs: 'knowledgePoints',
  inputRef: 'inputSpecs',
  programRef: 'programs',
  exampleProgramRefs: 'programs',
  judgeRef: 'judgeProfiles',
  blockRefs: 'blocks',
  requiredExerciseRefs: 'exercises',
  optionalExerciseRefs: 'exercises',
  caseRefs: 'cases',
  rewardRef: 'rewardSources',
};
const emptyPrograms = new Set([
  'program.c.practice-first-output',
  'program.c.practice-partial-array-init',
]);
const newLessonNames = [
  'first-program',
  'printf-layout',
  'statement-order',
  'initialization-assignment',
  'temporary-swap',
  'scope-shadowing',
  'integer-safety',
  'quotient-remainder',
  'boolean-logic',
  'short-circuit-safety',
  'single-if',
  'nested-conditions',
  'interval-boundaries',
  'while-countdown',
  'loop-control',
  'nested-loops',
  'array-initialization',
  'array-traversal-output',
  'logical-length-guards',
  'array-extrema',
  'array-counting',
  'linear-search-first',
  'adjacent-order',
  'bubble-sort',
  'selection-sort',
  'binary-search-first',
];

export function validateP05Semantics(content) {
  const errors = [];
  const add = (code, path, relatedId) =>
    errors.push({ code, severity: 'error', path, ...(relatedId ? { relatedId } : {}) });
  const index = new Map();
  for (const collection of collectionNames) {
    content[collection].forEach((entity, position) => {
      const path = `/${collection}/${position}`;
      if (index.has(entity.id)) add('CONTENT_ID_DUPLICATE', path, entity.id);
      index.set(entity.id, { entity, collection, path });
      const old = baseline[collection][entity.id];
      const revised = old && ['chapters', 'lessons', 'exercises', 'cases'].includes(collection);
      const sortedProgram =
        collection === 'programs' &&
        ['program.c.bubble-sort', 'program.c.selection-sort'].includes(entity.id);
      if (entity.version !== (revised ? '1.1.0' : sortedProgram ? '1.0.1' : '1.0.0'))
        add('CONTENT_SCHEMA_INVALID', `${path}/version`, entity.id);
    });
  }
  for (const [key, count] of Object.entries({
    chapters: 8,
    lessons: 32,
    exercises: 32,
    cases: 7,
    blocks: 20,
    judgeProfiles: 32,
  }))
    if (content[key].length !== count) add('CONTENT_P0_COVERAGE', `/${key}`);
  const additions = {
    chapters: ['state', 'expressions', 'loops', 'array-problems', 'sorting-search'].map(
      (name) => `chapter.c.${name}`,
    ),
    lessons: newLessonNames.map((name) => `lesson.c.${name}`),
    exercises: p05Profiles.map(([name]) => `exercise.c.${name}`),
    programs: p05Profiles.map(([name]) => `program.c.practice-${name}`),
    inputSpecs: p05Profiles.map(([name]) => `input.c.${name}`),
    judgeProfiles: p05Profiles.map(([name]) => `judge.c.${name}`),
  };
  for (const name of collectionNames) {
    const expected = [...Object.keys(baseline[name]), ...(additions[name] ?? [])].sort();
    if (!same(content[name].map((entry) => entry.id).sort(), expected))
      add('CONTENT_P0_COVERAGE', `/${name}`);
  }
  if (
    !same(
      content.chapters.map((entry) => entry.order).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8],
    )
  )
    add('CONTENT_P0_COVERAGE', '/chapters');
  for (const chapter of content.chapters)
    if (chapter.lessonRefs.length !== 4) add('CONTENT_P0_COVERAGE', '/chapters', chapter.id);
  const walk = (object, path) => {
    for (const [key, child] of Object.entries(object)) {
      if (refTypes[key]) {
        for (const ref of Array.isArray(child) ? child : [child]) {
          const target = index.get(ref.id);
          if (!target) add('CONTENT_REF_MISSING', `${path}/${key}`, ref.id);
          else if (target.collection !== refTypes[key])
            add('CONTENT_REF_TYPE', `${path}/${key}`, ref.id);
          else if (target.entity.version !== ref.version)
            add('CONTENT_REF_VERSION', `${path}/${key}`, ref.id);
        }
      } else if (child && typeof child === 'object' && !Array.isArray(child))
        walk(child, `${path}/${key}`);
    }
  };
  for (const { entity, path } of index.values()) walk(entity, path);
  if (errors.length) return errors;
  const find = (ref) => index.get(ref.id).entity;
  for (const language of content.languages) {
    if (
      language.id === 'lang.c'
        ? language.execution !== 'subset' ||
          !same(language.subsetRefs, [{ id: 'subset.c.p0', version: '1.0.0' }])
        : language.execution !== 'reserved' || language.subsetRefs.length !== 0
    )
      add('CONTENT_LANGUAGE_RESERVED', '/languages', language.id);
  }
  for (const { entity, path } of index.values()) {
    if (
      entity.languageRef &&
      (entity.languageRef.id !== 'lang.c' || find(entity.languageRef).execution !== 'subset')
    )
      add('CONTENT_LANGUAGE_RESERVED', path, entity.id);
    if (entity.subsetRef && entity.subsetRef.id !== 'subset.c.p0')
      add('CONTENT_SUBSET_INVALID', path, entity.id);
    if (
      entity.teaching &&
      [
        entity.teaching.explanation,
        ...entity.teaching.objectives,
        ...entity.teaching.commonMistakes,
        ...entity.teaching.boundaryNotes,
        entity.teaching.source.document,
        entity.teaching.source.locator,
      ].some((text) => !text.trim())
    )
      add('CONTENT_PUBLICATION_UNVERIFIED', path, entity.id);
    if (!entity.title.trim()) add('CONTENT_PUBLICATION_UNVERIFIED', path, entity.id);
  }
  for (const name of ['languages', 'subsets', 'blocks', 'rewardSources']) {
    if (!same(content[name].map((entry) => entry.id).sort(), Object.keys(baseline[name]).sort()))
      add('CONTENT_P0_COVERAGE', `/${name}`);
  }
  if (
    !same(find({ id: 'subset.c.p0' }).capabilityIds, baseline.subsets['subset.c.p0'].capabilityIds)
  )
    add('CONTENT_SUBSET_INVALID', '/subsets');
  for (const block of content.blocks)
    for (const key of ['connectionType', 'slotTypes', 'operators', 'capabilityIds'])
      if (!same(block[key], baseline.blocks[block.id]?.[key]))
        add('CONTENT_BLOCK_MAPPING_INVALID', '/blocks', block.id);
  for (const entry of [...content.lessons, ...content.exercises, ...content.cases]) {
    const old =
      baseline.lessons[entry.id] || baseline.exercises[entry.id] || baseline.cases[entry.id];
    const prior = old
      ? ['case.c.bubble-sort', 'case.c.selection-sort'].includes(entry.id)
        ? ['1.0.1', '1.0.2']
        : ['1.0.1']
      : [];
    if (entry.learningRevision !== 1 || !same(entry.acceptedPriorVersions, prior))
      add('CONTENT_LEARNING_COMPATIBILITY_INVALID', '/acceptedPriorVersions', entry.id);
  }
  for (const chapter of content.chapters)
    for (const ref of chapter.lessonRefs)
      if (!hasRef([find(ref).chapterRef], chapter))
        add('CONTENT_RELATION_INVALID', '/chapters', chapter.id);
  for (const lesson of content.lessons) {
    if (
      !hasRef(find(lesson.chapterRef).lessonRefs, lesson) ||
      lesson.requiredExerciseRefs.length !== 1 ||
      lesson.optionalExerciseRefs.length !== 0
    )
      add('CONTENT_RELATION_INVALID', '/lessons', lesson.id);
    for (const ref of lesson.requiredExerciseRefs)
      if (!hasRef([find(ref).lessonRef], lesson))
        add('CONTENT_RELATION_INVALID', '/lessons', lesson.id);
    for (const ref of lesson.caseRefs)
      if (!hasRef(find(ref).relatedLessonRefs, lesson))
        add('CONTENT_RELATION_INVALID', '/lessons', lesson.id);
  }
  const visiting = new Set(),
    visited = new Set();
  function visit(entry) {
    if (visiting.has(entry.id)) {
      add('CONTENT_PREREQUISITE_CYCLE', '/knowledgePoints', entry.id);
      return;
    }
    if (visited.has(entry.id)) return;
    visiting.add(entry.id);
    for (const ref of entry.prerequisiteRefs) visit(find(ref));
    visiting.delete(entry.id);
    visited.add(entry.id);
  }
  content.knowledgePoints.forEach(visit);
  for (const spec of content.inputSpecs) {
    const keys = new Set(spec.fields.map((field) => field.key));
    if (
      keys.size !== spec.fields.length ||
      spec.fields.some(
        (field) =>
          field.min > field.max || (field.kind === 'sequence' && field.minItems > field.maxItems),
      )
    )
      add('CONTENT_INPUT_SPEC_INVALID', '/inputSpecs', spec.id);
    if (
      baseline.inputSpecs[spec.id] &&
      (!same(spec.fields, baseline.inputSpecs[spec.id].fields) ||
        !same(spec.relations, baseline.inputSpecs[spec.id].relations))
    )
      add('CONTENT_INPUT_SPEC_INVALID', '/inputSpecs', spec.id);
    const derived = new Set();
    for (const relation of spec.relations) {
      const field = spec.fields.find((entry) => entry.key === relation.field);
      const target = spec.fields.find((entry) => entry.key === relation.target);
      const valid =
        relation.kind === 'length-of'
          ? field?.kind === 'sequence' &&
            !keys.has(relation.target) &&
            !derived.has(relation.target)
          : relation.kind === 'index-in'
            ? field?.kind === 'integer' && target?.kind === 'sequence'
            : field?.kind === 'sequence';
      if (!valid) add('CONTENT_INPUT_SPEC_INVALID', '/inputSpecs', spec.id);
      if (relation.kind === 'length-of') derived.add(relation.target);
    }
  }
  const inputValid = (spec, values) => {
    if (!same(Object.keys(values).sort(), spec.fields.map((field) => field.key).sort()))
      return false;
    for (const field of spec.fields) {
      const number = (value) =>
        Number.isSafeInteger(value) && value >= field.min && value <= field.max;
      const item = values[field.key];
      if (
        field.kind === 'integer'
          ? !number(item)
          : !Array.isArray(item) ||
            item.length < field.minItems ||
            item.length > field.maxItems ||
            !item.every(number)
      )
        return false;
    }
    return spec.relations.every((relation) =>
      relation.kind === 'index-in'
        ? values[relation.field] >= 0 && values[relation.field] < values[relation.target].length
        : relation.kind !== 'nondecreasing' ||
          values[relation.field].every((value, i, all) => i === 0 || value >= all[i - 1]),
    );
  };
  for (const program of content.programs) {
    const spec = find(program.inputRef);
    if (!inputValid(spec, program.exampleInput))
      add('CONTENT_INPUT_INVALID', '/programs', program.id);
    const empty = emptyPrograms.has(program.id);
    if (
      empty &&
      (spec.fields.length ||
        spec.relations.length ||
        program.bindings.length ||
        Object.keys(program.exampleInput).length)
    )
      add('CONTENT_BINDING_INVALID', '/programs', program.id);
    if (empty && program.inputRef.id !== program.id.replace('program.c.practice-', 'input.c.'))
      add('CONTENT_BINDING_INVALID', '/programs', program.id);
    if (
      (!spec.fields.length || !program.bindings.length) &&
      (!empty ||
        spec.fields.length ||
        spec.relations.length ||
        program.bindings.length ||
        Object.keys(program.exampleInput).length)
    )
      add('CONTENT_BINDING_INVALID', '/programs', program.id);
    const expected = [
      ...spec.fields.map((field) => ({
        inputKey: field.key,
        targetKind: field.kind === 'integer' ? 'scalar' : 'array',
        from: 'field',
      })),
      ...spec.relations
        .filter((relation) => relation.kind === 'length-of')
        .map((relation) => ({
          inputKey: relation.field,
          targetKind: 'logical-length',
          from: 'length-of',
        })),
    ];
    const actual = program.bindings.map(({ inputKey, targetKind, from }) => ({
      inputKey,
      targetKind,
      from,
    }));
    const sort = (list) => list.map(canonical).sort();
    if (
      !same(sort(actual), sort(expected)) ||
      new Set(program.bindings.map((binding) => binding.bindingKey)).size !==
        program.bindings.length ||
      new Set(program.bindings.map((binding) => binding.targetName)).size !==
        program.bindings.length
    )
      add('CONTENT_BINDING_INVALID', '/programs', program.id);
    if (
      !program.sourceExample.trim() ||
      new globalThis.TextEncoder().encode(program.sourceExample).length > 32768
    )
      add('CONTENT_BINDING_INVALID', '/programs', program.id);
    if (
      baseline.programs[program.id] &&
      !same(program.bindings, baseline.programs[program.id].bindings)
    )
      add('CONTENT_BINDING_INVALID', '/programs', program.id);
  }
  const newProfiles = new Map(p05Profiles.map(([suffix, rule]) => [`exercise.c.${suffix}`, rule]));
  if (
    !same(
      content.exercises.map((entry) => entry.id).sort(),
      [...Object.keys(baseline.exercises), ...newProfiles.keys()].sort(),
    )
  )
    add('CONTENT_P0_COVERAGE', '/exercises');
  for (const exercise of content.exercises) {
    const program = find(exercise.programRef),
      judge = find(exercise.judgeRef),
      lesson = find(exercise.lessonRef);
    if (
      !hasRef(lesson.requiredExerciseRefs, exercise) ||
      program.blockRefs.some((ref) => !hasRef(lesson.blockRefs, ref))
    )
      add('CONTENT_RELATION_INVALID', '/exercises', exercise.id);
    const old = baseline.exercises[exercise.id];
    if (
      old
        ? judge.rule !== old.judgeRule ||
          !same(exercise.programRef, old.programRef) ||
          !same(exercise.tests, old.tests)
        : judge.rule !== newProfiles.get(exercise.id) ||
          judge.id !== exercise.id.replace('exercise.', 'judge.') ||
          program.id !== exercise.id.replace('exercise.c.', 'program.c.practice-')
    )
      add('CONTENT_JUDGE_INVALID', '/exercises', exercise.id);
    if (
      !exercise.tests.length ||
      exercise.tests.length > 9 ||
      new Set(exercise.tests.map((test) => test.caseKey)).size !== exercise.tests.length
    )
      add('CONTENT_JUDGE_INVALID', '/exercises', exercise.id);
    for (const test of exercise.tests) {
      if (!inputValid(find(program.inputRef), test.input))
        add('CONTENT_INPUT_INVALID', '/exercises', exercise.id);
      if (
        test.expectedArray &&
        !test.expectedArray.length &&
        !['bubble-ascending', 'selection-ascending'].includes(judge.rule)
      )
        add('CONTENT_JUDGE_INVALID', '/exercises', exercise.id);
    }
  }
  for (const entry of content.cases) {
    const expected = baseline.cases[entry.id],
      program = find(entry.programRef);
    if (
      !expected ||
      entry.kind !== expected.kind ||
      entry.resultRule !== expected.resultRule ||
      entry.programRef.id !== expected.programRef.id ||
      !same(program.inputRef, baseline.programs[program.id]?.inputRef)
    )
      add('CONTENT_CASE_INVALID', '/cases', entry.id);
    for (const ref of entry.relatedLessonRefs)
      if (!hasRef(find(ref).caseRefs, entry)) add('CONTENT_RELATION_INVALID', '/cases', entry.id);
  }
  for (const [entries, eventType] of [
    [content.lessons, 'lesson.completed'],
    [content.exercises, 'exercise.passed'],
    [content.cases, 'case.view-confirmed'],
  ])
    for (const entry of entries)
      if (find(entry.rewardRef).eventType !== eventType)
        add('CONTENT_REWARD_INVALID', '/rewardRef', entry.id);
  for (const reward of content.rewardSources) {
    const daily = reward.eventType === 'daily-goal.achieved';
    if (
      reward.eventType !== baseline.rewardSources[reward.id]?.eventType ||
      reward.scope !== (daily ? 'local-day' : 'content-id') ||
      reward.repeat !== (daily ? 'once-per-day' : 'first-only')
    )
      add('CONTENT_REWARD_INVALID', '/rewardSources', reward.id);
  }
  return errors;
}
