import { schema } from './schema.mjs';
import { baseline } from './baseline.mjs';
import { schema as p05Schema } from './schema-p05.mjs';
import { validateP05Semantics } from './validator-p05.mjs';

export const MAX_CONTENT_BYTES = 2 * 1024 * 1024;
const collections = [
  'languages',
  'subsets',
  'chapters',
  'lessons',
  'knowledgePoints',
  'inputSpecs',
  'programs',
  'judgeProfiles',
  'exercises',
  'cases',
  'blocks',
  'rewardSources',
];
const pointer = (value) => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
const same = (a, b) => canonical(a) === canonical(b);
const diagnostic = (code, path, relatedId) => ({
  code,
  severity: 'error',
  path,
  ...(relatedId ? { relatedId } : {}),
});

export class ContentError extends Error {
  constructor(code, diagnostics = [diagnostic(code, '')]) {
    super(code);
    this.name = 'ContentError';
    this.code = code;
    this.diagnostics = Object.freeze(diagnostics.map((entry) => Object.freeze(entry)));
  }
}

function reject(errors) {
  if (!errors.length) return;
  errors.sort((a, b) => a.path.localeCompare(b.path, 'en') || a.code.localeCompare(b.code, 'en'));
  throw new ContentError(errors[0].code, errors);
}

// A bounded JSON reader is necessary: JSON.parse alone silently accepts duplicate keys.
// String token decoding delegates JSON escape syntax to JSON.parse, then verifies Unicode.
function readJson(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new ContentError('CONTENT_JSON_INVALID');
  if (bytes.byteLength > MAX_CONTENT_BYTES) throw new ContentError('CONTENT_SIZE_EXCEEDED');
  let source;
  try {
    source = new globalThis.TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ContentError('CONTENT_JSON_INVALID');
  }
  let cursor = 0;
  let nodes = 0;
  const fail = (code = 'CONTENT_JSON_INVALID', path = '') => {
    throw new ContentError(code, [diagnostic(code, path)]);
  };
  const whitespace = () => {
    while (' \n\r\t'.includes(source[cursor]) && cursor < source.length) cursor++;
  };
  const string = (path) => {
    const start = cursor++;
    while (cursor < source.length) {
      const char = source[cursor++];
      if (char === '\\') {
        cursor++;
      } else if (char === '"') {
        let value;
        try {
          value = JSON.parse(source.slice(start, cursor));
        } catch {
          fail();
        }
        for (let index = 0; index < value.length; index++) {
          const code = value.charCodeAt(index);
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail('CONTENT_JSON_INVALID', path);
          } else if (code >= 0xdc00 && code <= 0xdfff) fail('CONTENT_JSON_INVALID', path);
        }
        return value;
      }
    }
    return fail();
  };
  const value = (depth, path) => {
    if (depth > 64 || ++nodes > 100_000) fail('CONTENT_JSON_INVALID', path);
    whitespace();
    const char = source[cursor];
    if (char === '"') return string(path);
    if (char === '{') {
      cursor++;
      const result = Object.create(null);
      const keys = new Set();
      whitespace();
      if (source[cursor] === '}') {
        cursor++;
        return result;
      }
      while (true) {
        whitespace();
        if (source[cursor] !== '"') fail();
        const key = string(path);
        const childPath = `${path}/${pointer(key)}`;
        if (keys.has(key)) fail('CONTENT_JSON_DUPLICATE_KEY', childPath);
        keys.add(key);
        whitespace();
        if (source[cursor++] !== ':') fail();
        result[key] = value(depth + 1, childPath);
        whitespace();
        const separator = source[cursor++];
        if (separator === '}') return result;
        if (separator !== ',') fail();
      }
    }
    if (char === '[') {
      cursor++;
      const result = [];
      whitespace();
      if (source[cursor] === ']') {
        cursor++;
        return result;
      }
      while (true) {
        result.push(value(depth + 1, `${path}/${result.length}`));
        whitespace();
        const separator = source[cursor++];
        if (separator === ']') return result;
        if (separator !== ',') fail();
      }
    }
    for (const [token, result] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ]) {
      if (source.startsWith(token, cursor)) {
        cursor += token.length;
        return result;
      }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(cursor));
    if (number) {
      cursor += number[0].length;
      const result = Number(number[0]);
      if (!Number.isFinite(result) || (Number.isInteger(result) && !Number.isSafeInteger(result)))
        fail();
      return result;
    }
    return fail();
  };
  const result = value(0, '');
  whitespace();
  if (cursor !== source.length) fail();
  return result;
}

// Implements precisely the keyword vocabulary of the frozen 2020-12 Schema.
// allOf/$ref annotations propagate to unevaluatedProperties; failed alternatives do not.
function evaluate(rule, value, path, rootSchema = schema) {
  if (rule === true) return { errors: [], evaluated: new Set() };
  if (rule === false) return { errors: [{ path, keyword: 'false' }], evaluated: new Set() };
  const errors = [];
  const evaluated = new Set();
  const error = (keyword, errorPath = path) => errors.push({ path: errorPath, keyword });
  const merge = (result) => {
    errors.push(...result.errors);
    for (const key of result.evaluated) evaluated.add(key);
  };
  if (rule.$ref) {
    let reference = rootSchema;
    for (const key of rule.$ref.slice(2).split('/'))
      reference = reference[key.replace(/~1/g, '/').replace(/~0/g, '~')];
    merge(evaluate(reference, value, path, rootSchema));
  }
  if (rule.allOf) for (const branch of rule.allOf) merge(evaluate(branch, value, path, rootSchema));
  for (const keyword of ['anyOf', 'oneOf']) {
    if (rule[keyword]) {
      const matches = rule[keyword]
        .map((branch) => evaluate(branch, value, path, rootSchema))
        .filter((result) => !result.errors.length);
      if (!matches.length || (keyword === 'oneOf' && matches.length !== 1)) error(keyword);
      else for (const match of matches) merge(match);
    }
  }
  if (rule.not && !evaluate(rule.not, value, path, rootSchema).errors.length) error('not');
  if (rule.if) {
    const condition = evaluate(rule.if, value, path, rootSchema);
    if (!condition.errors.length) {
      merge(condition);
      if (rule.then) merge(evaluate(rule.then, value, path, rootSchema));
    } else if (rule.else) merge(evaluate(rule.else, value, path, rootSchema));
  }
  if (rule.type) {
    const valid =
      rule.type === 'object'
        ? isObject(value)
        : rule.type === 'array'
          ? Array.isArray(value)
          : rule.type === 'integer'
            ? Number.isSafeInteger(value)
            : typeof value === rule.type;
    if (!valid) error('type');
  }
  if (has(rule, 'const') && !same(rule.const, value)) error('const');
  if (rule.enum && !rule.enum.some((allowed) => same(allowed, value))) error('enum');
  if (typeof value === 'string') {
    const length = [...value].length;
    if (has(rule, 'minLength') && length < rule.minLength) error('minLength');
    if (has(rule, 'maxLength') && length > rule.maxLength) error('maxLength');
    if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) error('pattern');
  }
  if (typeof value === 'number') {
    if (has(rule, 'minimum') && value < rule.minimum) error('minimum');
    if (has(rule, 'maximum') && value > rule.maximum) error('maximum');
  }
  if (Array.isArray(value)) {
    if (has(rule, 'minItems') && value.length < rule.minItems) error('minItems');
    if (has(rule, 'maxItems') && value.length > rule.maxItems) error('maxItems');
    if (rule.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = canonical(item);
        if (seen.has(key)) error('uniqueItems');
        seen.add(key);
      }
    }
    if (rule.items)
      value.forEach((item, index) =>
        errors.push(...evaluate(rule.items, item, `${path}/${index}`, rootSchema).errors),
      );
  }
  if (isObject(value)) {
    if (rule.minProperties && Object.keys(value).length < rule.minProperties)
      error('minProperties');
    for (const key of rule.required ?? [])
      if (!has(value, key)) error('required', `${path}/${pointer(key)}`);
    for (const [key, child] of Object.entries(rule.properties ?? {})) {
      if (has(value, key)) {
        evaluated.add(key);
        errors.push(...evaluate(child, value[key], `${path}/${pointer(key)}`, rootSchema).errors);
      }
    }
    if (has(rule, 'additionalProperties')) {
      for (const key of Object.keys(value)) {
        if (!has(rule.properties ?? {}, key)) {
          evaluated.add(key);
          errors.push(
            ...evaluate(
              rule.additionalProperties,
              value[key],
              `${path}/${pointer(key)}`,
              rootSchema,
            ).errors,
          );
        }
      }
    }
    if (has(rule, 'unevaluatedProperties')) {
      for (const key of Object.keys(value)) {
        if (!evaluated.has(key)) {
          errors.push(
            ...evaluate(
              rule.unevaluatedProperties,
              value[key],
              `${path}/${pointer(key)}`,
              rootSchema,
            ).errors,
          );
          evaluated.add(key);
        }
      }
    }
  }
  return { errors, evaluated };
}

function schemaDiagnostics(value, activeSchema = schema) {
  const failures = evaluate(activeSchema, value, '', activeSchema).errors;
  return failures.map(({ path, keyword }) => {
    const code =
      path === '/contractVersion'
        ? 'CONTENT_CONTRACT_UNSUPPORTED'
        : /\/(?:id|packageId)$/.test(path) &&
            ['pattern', 'minLength', 'maxLength', 'type'].includes(keyword)
          ? 'CONTENT_ID_INVALID'
          : /\/requiredExerciseRefs$/.test(path) && keyword === 'minItems'
            ? 'CONTENT_REQUIRED_EMPTY'
            : /\/(?:\w+Refs)$/.test(path) && keyword === 'uniqueItems'
              ? 'CONTENT_LIST_DUPLICATE'
              : 'CONTENT_SCHEMA_INVALID';
    return diagnostic(code, path);
  });
}

function validateSemantics(content, authoring = false) {
  const errors = [];
  const add = (code, path, id) => errors.push(diagnostic(code, path, id));
  const checkpoint = () => {
    reject(errors);
    errors.length = 0;
  };
  const index = new Map();
  for (const collection of collections) {
    content[collection].forEach((entity, position) => {
      const path = `/${collection}/${position}`;
      if (index.has(entity.id)) add('CONTENT_ID_DUPLICATE', `${path}/id`, entity.id);
      else index.set(entity.id, { entity, collection, path });
      // 09.1 is an explicitly registered, unpublished editorial revision.
      const revised =
        authoring &&
        content.packageVersion === '1.0.1' &&
        ['chapters', 'lessons', 'exercises', 'cases'].includes(collection);
      if (entity.version !== (revised ? '1.0.1' : '1.0.0'))
        add('CONTENT_SCHEMA_INVALID', `${path}/version`, entity.id);
    });
  }
  if (
    content.packageId !== 'content.c.p0' ||
    !(
      (content.packageVersion === '1.0.0' &&
        (!authoring || content.purpose === 'contract-fixture')) ||
      (authoring && content.packageVersion === '1.0.1' && content.purpose === 'publishable')
    )
  )
    add('CONTENT_SCHEMA_INVALID', '/packageVersion');
  checkpoint();
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
  const refs = [];
  const walk = (object, path, owner) => {
    if (!isObject(object)) return;
    for (const [key, child] of Object.entries(object)) {
      const childPath = `${path}/${pointer(key)}`;
      if (refTypes[key]) {
        const list = Array.isArray(child) ? child : [child];
        list.forEach((ref, position) => {
          const refPath = Array.isArray(child) ? `${childPath}/${position}` : childPath;
          const target = index.get(ref.id);
          if (!target) add('CONTENT_REF_MISSING', `${refPath}/id`, ref.id);
          else if (target.collection !== refTypes[key])
            add('CONTENT_REF_TYPE', `${refPath}/id`, ref.id);
          else if (target.entity.version !== ref.version)
            add('CONTENT_REF_VERSION', `${refPath}/version`, ref.id);
          else refs.push({ owner, key, target: target.entity, path: refPath });
        });
      } else if (isObject(child)) walk(child, childPath, owner);
    }
  };
  for (const { entity, path } of index.values()) walk(entity, path, entity);
  checkpoint();
  for (const { entity, path } of index.values()) {
    if (entity.languageRef) {
      const language = index.get(entity.languageRef.id).entity;
      if (language.execution === 'reserved')
        add('CONTENT_LANGUAGE_RESERVED', `${path}/languageRef`, entity.id);
      else if (entity.languageRef.id !== 'lang.c')
        add('CONTENT_LANGUAGE_MISMATCH', `${path}/languageRef`, entity.id);
    }
    if (entity.execution === 'reserved' && entity.subsetRefs.length)
      add('CONTENT_LANGUAGE_RESERVED', `${path}/subsetRefs`, entity.id);
    if (
      entity.subsetRef &&
      (entity.subsetRef.id !== 'subset.c.p0' ||
        !same(entity.languageRef, index.get(entity.subsetRef.id).entity.languageRef))
    )
      add('CONTENT_SUBSET_INVALID', `${path}/subsetRef`, entity.id);
  }
  reject(errors.filter((entry) => entry.code === 'CONTENT_LANGUAGE_RESERVED'));
  for (const { owner, key, target, path } of refs) {
    if (
      key !== 'languageRef' &&
      owner.languageRef &&
      target.languageRef &&
      !same(owner.languageRef, target.languageRef)
    )
      add('CONTENT_LANGUAGE_MISMATCH', path, owner.id);
  }
  const cLanguage = index.get('lang.c')?.entity;
  const subset = index.get('subset.c.p0')?.entity;
  if (
    !cLanguage ||
    cLanguage.execution !== 'subset' ||
    !same(cLanguage.subsetRefs, [{ id: 'subset.c.p0', version: '1.0.0' }]) ||
    !subset ||
    !same(subset.capabilityIds, baseline.subsets['subset.c.p0'].capabilityIds)
  )
    add('CONTENT_SUBSET_INVALID', '/subsets');
  for (const language of content.languages)
    if (language.id !== 'lang.c' && language.execution !== 'reserved')
      add('CONTENT_LANGUAGE_RESERVED', '/languages', language.id);
  checkpoint();
  const counts = { chapters: 3, lessons: 6, exercises: 6, cases: 7, blocks: 20 };
  for (const [key, count] of Object.entries(counts))
    if (content[key].length !== count) add('CONTENT_P0_COVERAGE', `/${key}`);
  if (
    content.cases.filter((entry) => entry.kind === 'demo').length !== 4 ||
    content.cases.filter((entry) => entry.kind === 'algorithm').length !== 3
  )
    add('CONTENT_P0_COVERAGE', '/cases');
  if (
    !same(
      content.chapters.map((chapter) => chapter.order).sort((a, b) => a - b),
      [1, 2, 3],
    )
  )
    add('CONTENT_P0_COVERAGE', '/chapters');
  for (const chapter of content.chapters)
    if (chapter.lessonRefs.length !== 2)
      add('CONTENT_P0_COVERAGE', `${index.get(chapter.id).path}/lessonRefs`, chapter.id);
  for (const lesson of content.lessons)
    if (lesson.requiredExerciseRefs.length !== 1)
      add('CONTENT_P0_COVERAGE', `${index.get(lesson.id).path}/requiredExerciseRefs`, lesson.id);
  // The current P0 content IDs are frozen; additions require a content/version decision.
  for (const collection of collections)
    if (
      !same(
        content[collection].map((entity) => entity.id).sort(),
        Object.keys(baseline[collection]).sort(),
      )
    )
      add('CONTENT_P0_COVERAGE', `/${collection}`);
  checkpoint();
  const includes = (list, entity) =>
    list.some((ref) => ref.id === entity.id && ref.version === entity.version);
  for (const chapter of content.chapters)
    for (const ref of chapter.lessonRefs)
      if (index.get(ref.id).entity.chapterRef.id !== chapter.id)
        add('CONTENT_RELATION_INVALID', `${index.get(chapter.id).path}/lessonRefs`, chapter.id);
  for (const lesson of content.lessons) {
    const path = index.get(lesson.id).path;
    if (!includes(index.get(lesson.chapterRef.id).entity.lessonRefs, lesson))
      add('CONTENT_RELATION_INVALID', `${path}/chapterRef`, lesson.id);
    const exerciseRefs = [...lesson.requiredExerciseRefs, ...lesson.optionalExerciseRefs];
    if (new Set(exerciseRefs.map((ref) => ref.id)).size !== exerciseRefs.length)
      add('CONTENT_RELATION_INVALID', `${path}/optionalExerciseRefs`, lesson.id);
    for (const ref of exerciseRefs)
      if (index.get(ref.id).entity.lessonRef.id !== lesson.id)
        add('CONTENT_RELATION_INVALID', `${path}/requiredExerciseRefs`, lesson.id);
    for (const ref of lesson.caseRefs)
      if (!includes(index.get(ref.id).entity.relatedLessonRefs, lesson))
        add('CONTENT_RELATION_INVALID', `${path}/caseRefs`, lesson.id);
  }
  for (const exercise of content.exercises) {
    const lesson = index.get(exercise.lessonRef.id).entity;
    if (!includes([...lesson.requiredExerciseRefs, ...lesson.optionalExerciseRefs], exercise))
      add('CONTENT_RELATION_INVALID', `${index.get(exercise.id).path}/lessonRef`, exercise.id);
  }
  for (const entry of content.cases)
    for (const ref of entry.relatedLessonRefs)
      if (!includes(index.get(ref.id).entity.caseRefs, entry))
        add('CONTENT_RELATION_INVALID', `${index.get(entry.id).path}/relatedLessonRefs`, entry.id);
  const visiting = new Set();
  const visited = new Set();
  const visit = (entity) => {
    if (visiting.has(entity.id)) {
      add('CONTENT_PREREQUISITE_CYCLE', `${index.get(entity.id).path}/prerequisiteRefs`, entity.id);
      return;
    }
    if (visited.has(entity.id)) return;
    visiting.add(entity.id);
    for (const ref of entity.prerequisiteRefs) visit(index.get(ref.id).entity);
    visiting.delete(entity.id);
    visited.add(entity.id);
  };
  content.knowledgePoints.forEach(visit);
  checkpoint();
  for (const entry of [...content.lessons, ...content.exercises, ...content.cases]) {
    // No prior-version semantic equivalence audits have been supplied in 1.0.0.
    if (entry.acceptedPriorVersions.length || entry.learningRevision !== 1)
      add(
        'CONTENT_LEARNING_COMPATIBILITY_INVALID',
        `${index.get(entry.id).path}/acceptedPriorVersions`,
        entry.id,
      );
  }
  checkpoint();
  for (const spec of content.inputSpecs) {
    const path = index.get(spec.id).path;
    const fields = new Map(spec.fields.map((field) => [field.key, field]));
    if (fields.size !== spec.fields.length)
      add('CONTENT_INPUT_SPEC_INVALID', `${path}/fields`, spec.id);
    for (const field of spec.fields)
      if (field.min > field.max || (field.kind === 'sequence' && field.minItems > field.maxItems))
        add('CONTENT_INPUT_SPEC_INVALID', `${path}/fields`, spec.id);
    const derived = new Set();
    for (const relation of spec.relations) {
      const field = fields.get(relation.field);
      const target = fields.get(relation.target);
      if (relation.kind === 'length-of') {
        if (
          field?.kind !== 'sequence' ||
          fields.has(relation.target) ||
          derived.has(relation.target)
        )
          add('CONTENT_INPUT_SPEC_INVALID', `${path}/relations`, spec.id);
        derived.add(relation.target);
      } else if (relation.kind === 'index-in') {
        if (field?.kind !== 'integer' || target?.kind !== 'sequence')
          add('CONTENT_INPUT_SPEC_INVALID', `${path}/relations`, spec.id);
      } else if (field?.kind !== 'sequence')
        add('CONTENT_INPUT_SPEC_INVALID', `${path}/relations`, spec.id);
    }
    const expected = baseline.inputSpecs[spec.id];
    if (!same(spec.fields, expected.fields) || !same(spec.relations, expected.relations))
      add('CONTENT_INPUT_SPEC_INVALID', path, spec.id);
  }
  checkpoint();
  const inputValid = (spec, values, path) => {
    if (!same(Object.keys(values).sort(), spec.fields.map((field) => field.key).sort()))
      add('CONTENT_INPUT_INVALID', path);
    for (const field of spec.fields) {
      const item = values[field.key];
      const validNumber = (number) =>
        Number.isSafeInteger(number) && number >= field.min && number <= field.max;
      if (field.kind === 'integer') {
        if (!validNumber(item)) add('CONTENT_INPUT_INVALID', `${path}/${field.key}`);
      } else if (
        !Array.isArray(item) ||
        item.length < field.minItems ||
        item.length > field.maxItems ||
        !item.every(validNumber)
      )
        add('CONTENT_INPUT_INVALID', `${path}/${field.key}`);
    }
    for (const relation of spec.relations) {
      const item = values[relation.field];
      if (
        relation.kind === 'index-in' &&
        (!Array.isArray(values[relation.target]) ||
          !Number.isSafeInteger(item) ||
          item < 0 ||
          item >= values[relation.target].length)
      )
        add('CONTENT_INPUT_INVALID', `${path}/${relation.field}`);
      if (
        relation.kind === 'nondecreasing' &&
        Array.isArray(item) &&
        item.some((number, position) => position > 0 && number < item[position - 1])
      )
        add('CONTENT_INPUT_INVALID', `${path}/${relation.field}`);
    }
  };
  for (const program of content.programs)
    inputValid(
      index.get(program.inputRef.id).entity,
      program.exampleInput,
      `${index.get(program.id).path}/exampleInput`,
    );
  for (const exercise of content.exercises) {
    const spec = index.get(index.get(exercise.programRef.id).entity.inputRef.id).entity;
    exercise.tests.forEach((test, position) =>
      inputValid(spec, test.input, `${index.get(exercise.id).path}/tests/${position}/input`),
    );
  }
  checkpoint();
  for (const program of content.programs) {
    const path = index.get(program.id).path;
    const spec = index.get(program.inputRef.id).entity;
    const bindingKeys = new Set();
    const targets = new Set();
    const expectedBindings = [];
    for (const field of spec.fields)
      expectedBindings.push({
        inputKey: field.key,
        targetKind: field.kind === 'sequence' ? 'array' : 'scalar',
        from: 'field',
      });
    for (const relation of spec.relations)
      if (relation.kind === 'length-of')
        expectedBindings.push({
          inputKey: relation.field,
          targetKind: 'logical-length',
          from: 'length-of',
        });
    for (const binding of program.bindings) {
      if (bindingKeys.has(binding.bindingKey) || targets.has(binding.targetName))
        add('CONTENT_BINDING_INVALID', `${path}/bindings`, program.id);
      bindingKeys.add(binding.bindingKey);
      targets.add(binding.targetName);
    }
    const project = ({ inputKey, targetKind, from }) => ({ inputKey, targetKind, from });
    const bindingOrder = (a, b) => canonical(a).localeCompare(canonical(b));
    if (
      !same(
        program.bindings.map(project).sort(bindingOrder),
        expectedBindings.sort(bindingOrder),
      ) ||
      !same(program.bindings, baseline.programs[program.id].bindings)
    )
      add('CONTENT_BINDING_INVALID', `${path}/bindings`, program.id);
    if (
      program.sourceExample.trim().length === 0 ||
      new globalThis.TextEncoder().encode(program.sourceExample).length > 32768
    )
      add('CONTENT_BINDING_INVALID', `${path}/sourceExample`, program.id);
  }
  checkpoint();
  for (const block of content.blocks) {
    const expected = baseline.blocks[block.id];
    for (const key of ['connectionType', 'slotTypes', 'operators', 'capabilityIds'])
      if (!same(block[key], expected[key]))
        add('CONTENT_BLOCK_MAPPING_INVALID', `${index.get(block.id).path}/${key}`, block.id);
  }
  for (const program of content.programs)
    if (!same(program.blockRefs, baseline.programs[program.id].blockRefs))
      add('CONTENT_BLOCK_MAPPING_INVALID', `${index.get(program.id).path}/blockRefs`, program.id);
  for (const lesson of content.lessons)
    for (const ref of lesson.requiredExerciseRefs) {
      const program = index.get(index.get(ref.id).entity.programRef.id).entity;
      if (program.blockRefs.some((block) => !includes(lesson.blockRefs, block)))
        add('CONTENT_BLOCK_MAPPING_INVALID', `${index.get(lesson.id).path}/blockRefs`, lesson.id);
    }
  checkpoint();
  for (const exercise of content.exercises) {
    const path = index.get(exercise.id).path;
    const expected = baseline.exercises[exercise.id];
    const judge = index.get(exercise.judgeRef.id).entity;
    if (
      judge.rule !== expected.judgeRule ||
      !same(exercise.programRef, expected.programRef) ||
      !same(exercise.tests, expected.tests)
    )
      add('CONTENT_JUDGE_INVALID', `${path}/tests`, exercise.id);
    if (new Set(exercise.tests.map((test) => test.caseKey)).size !== exercise.tests.length)
      add('CONTENT_JUDGE_INVALID', `${path}/tests`, exercise.id);
  }
  checkpoint();
  for (const entry of content.cases) {
    const expected = baseline.cases[entry.id];
    const path = index.get(entry.id).path;
    const program = index.get(entry.programRef.id).entity;
    if (
      entry.kind !== expected.kind ||
      entry.resultRule !== expected.resultRule ||
      !same(entry.programRef, expected.programRef) ||
      !same(program.inputRef, baseline.programs[program.id].inputRef)
    )
      add('CONTENT_CASE_INVALID', path, entry.id);
    if (
      entry.resultRule === 'binary-first-index' &&
      !index
        .get(program.inputRef.id)
        .entity.relations.some(
          (relation) => relation.kind === 'nondecreasing' && relation.field === 'values',
        )
    )
      add('CONTENT_CASE_INVALID', `${path}/programRef`, entry.id);
  }
  checkpoint();
  for (const [list, eventType] of [
    [content.lessons, 'lesson.completed'],
    [content.exercises, 'exercise.passed'],
    [content.cases, 'case.view-confirmed'],
  ]) {
    for (const entry of list)
      if (index.get(entry.rewardRef.id).entity.eventType !== eventType)
        add('CONTENT_REWARD_INVALID', `${index.get(entry.id).path}/rewardRef`, entry.id);
  }
  for (const reward of content.rewardSources) {
    const daily = reward.eventType === 'daily-goal.achieved';
    if (
      reward.scope !== (daily ? 'local-day' : 'content-id') ||
      reward.repeat !== (daily ? 'once-per-day' : 'first-only') ||
      reward.eventType !== baseline.rewardSources[reward.id].eventType
    )
      add('CONTENT_REWARD_INVALID', index.get(reward.id).path, reward.id);
  }
  checkpoint();
  if (content.purpose === 'publishable' && !authoring)
    add('CONTENT_PUBLICATION_UNVERIFIED', '/purpose');
  for (const { entity, path } of index.values()) {
    if (entity.teaching) {
      const teaching = entity.teaching;
      const texts = [
        ...teaching.objectives,
        teaching.explanation,
        ...teaching.commonMistakes,
        ...teaching.boundaryNotes,
        teaching.source.document,
        teaching.source.locator,
      ];
      if (texts.some((text) => !text.trim()))
        add('CONTENT_PUBLICATION_UNVERIFIED', `${path}/teaching`, entity.id);
    }
    if (entity.reference && (!entity.reference.document.trim() || !entity.reference.locator.trim()))
      add('CONTENT_PUBLICATION_UNVERIFIED', `${path}/reference`, entity.id);
    if (!entity.title.trim()) add('CONTENT_PUBLICATION_UNVERIFIED', `${path}/title`, entity.id);
  }
  checkpoint();
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function parseContent(bytes) {
  return parseCheckedContent(bytes, false);
}

// Offline editorial checks only. This is deliberately NOT used by the repository:
// passing schema/config review grants no publication or learning-event permission.
export function inspectContentDraft(bytes) {
  return parseCheckedContent(bytes, true);
}

function parseCheckedContent(bytes, authoring) {
  const content = readJson(bytes);
  const p05 = content?.contractVersion === '1.1.0';
  const structureErrors = schemaDiagnostics(content, p05 ? p05Schema : schema);
  // Dedicated structure failures precede the generic schema failure.
  const dedicated = structureErrors.filter((entry) => entry.code !== 'CONTENT_SCHEMA_INVALID');
  if (dedicated.length) reject(dedicated);
  reject(structureErrors);
  if (p05) {
    reject(validateP05Semantics(content));
    if (!authoring) throw new ContentError('CONTENT_PUBLICATION_UNVERIFIED');
  } else validateSemantics(content, authoring);
  return freeze(content);
}
