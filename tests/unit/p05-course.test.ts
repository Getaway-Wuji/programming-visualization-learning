import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectContentDraft, parseContent } from '../../web/src/content/validator.mjs';
import type { ContentPackage } from '../../web/src/content/types';
import type { CoursePractice } from '../../web/src/content/practice';
import { exerciseCatalog } from '../../web/src/content/practice';
import { exerciseRequest } from '../../web/src/practice/submission';
import { encodeRequest } from '../../web/src/engine/protocol';

const bytes = readFileSync('content/c/p05/course-1.0.0.json');
const source = JSON.parse(bytes.toString('utf8')) as ContentPackage;
const original = JSON.parse(
  readFileSync('content/c/p0/course-1.0.1.json', 'utf8'),
) as ContentPackage;
const data = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const practice: CoursePractice = {
  practiceVersion: '1.0.0',
  sourceSha256: '',
  packageRef: { id: source.packageId, version: source.packageVersion },
  exercises: source.exercises,
  programs: source.programs,
  inputSpecs: source.inputSpecs,
  judgeProfiles: source.judgeProfiles,
};
const catalog = exerciseCatalog(practice, 'exercise.c.first-output');
const request = () =>
  structuredClone(
    exerciseRequest(
      catalog,
      {
        text: '#include <stdio.h>\nint main(void){printf("Hello, C!\\n");return 0;}\n',
        bindingMap: [],
        blockMap: [],
      },
      { contextId: 'p05.unit', contextRevision: 1, sourceRevision: 1 },
      'p05.unit.submission',
      catalog.subject.tests[0]!,
    ),
  );

describe('P0.5 exact curriculum and isolated 1.1 schema', () => {
  it('accepts only an editorial draft, never a full production publication', () => {
    const checked = inspectContentDraft(bytes);
    expect(checked.lessons).toHaveLength(32);
    expect(checked.exercises).toHaveLength(32);
    expect(checked.chapters).toHaveLength(8);
    expect(checked.exercises.reduce((sum, entry) => sum + entry.tests.length, 0)).toBe(140);
    expect(Object.isFrozen(checked.lessons)).toBe(true);
    expect(() => parseContent(bytes)).toThrow('CONTENT_PUBLICATION_UNVERIFIED');
  });
  it('preserves every original exercise test and exact program/judge semantics', () => {
    for (const exercise of original.exercises) {
      const next = source.exercises.find((entry) => entry.id === exercise.id)!;
      expect(next.tests).toEqual(exercise.tests);
      expect(next.programRef).toEqual(exercise.programRef);
      expect(next.judgeRef).toEqual(exercise.judgeRef);
      expect(next.version).toBe('1.1.0');
      expect(next.learningRevision).toBe(1);
      expect(next.acceptedPriorVersions).toEqual(['1.0.1']);
    }
    for (const old of original.judgeProfiles)
      expect(source.judgeProfiles.find((entry) => entry.id === old.id)).toEqual(old);
  });
  it.each([
    'missing-reference',
    'cross-version',
    'extra-entity',
    'new-rule-on-old',
    'empty-unapproved-input',
    'prior-fixture-version',
    'zero-unsorted-target',
    'unknown-field',
  ])('rejects %s without weakening old CONTENT', (kind) => {
    const changed = structuredClone(source);
    const raw = changed as unknown as Record<string, unknown>;
    if (kind === 'missing-reference')
      raw.lessons = changed.lessons.map((entry, index) =>
        index ? entry : { ...entry, chapterRef: { id: 'chapter.c.missing', version: '1.0.0' } },
      );
    if (kind === 'cross-version')
      raw.lessons = changed.lessons.map((entry, index) =>
        index ? entry : { ...entry, chapterRef: { ...entry.chapterRef, version: '9.0.0' } },
      );
    if (kind === 'extra-entity')
      raw.inputSpecs = [...changed.inputSpecs, { ...changed.inputSpecs[0], id: 'input.c.extra' }];
    if (kind === 'new-rule-on-old')
      raw.judgeProfiles = changed.judgeProfiles.map((entry) =>
        entry.id === 'judge.c.echo' ? { ...entry, rule: 'entry-output' } : entry,
      );
    if (kind === 'empty-unapproved-input')
      raw.inputSpecs = changed.inputSpecs.map((entry) =>
        entry.id === 'input.c.wide-product' ? { ...entry, fields: [], relations: [] } : entry,
      );
    if (kind === 'prior-fixture-version')
      raw.lessons = changed.lessons.map((entry) =>
        entry.id === 'lesson.c.variables-output'
          ? { ...entry, acceptedPriorVersions: ['1.0.0', '1.0.1'] }
          : entry,
      );
    if (kind === 'zero-unsorted-target')
      raw.exercises = changed.exercises.map((entry) =>
        entry.id === 'exercise.c.increment-at-index'
          ? { ...entry, tests: entry.tests.map((test) => ({ ...test, expectedArray: [] })) }
          : entry,
      );
    if (kind === 'unknown-field') raw.extra = true;
    expect(() => inspectContentDraft(data(changed))).toThrow();
  });
  it('accepts an exact no-input EXEC1.1 request', () => {
    expect(request().protocolVersion).toBe('1.1.0');
    expect(() => encodeRequest(request())).not.toThrow();
  });
  it.each(['first-output', 'partial-array-init'])(
    'requires reviewed %s to remain truly input-free',
    (suffix) => {
      const changed = structuredClone(source);
      const raw = changed as unknown as Record<string, unknown>;
      const echo = original.programs.find((entry) => entry.id === 'program.c.echo')!;
      const fields = original.inputSpecs.find((entry) => entry.id === echo.inputRef.id)!.fields;
      raw.inputSpecs = changed.inputSpecs.map((entry) =>
        entry.id === `input.c.${suffix}` ? { ...entry, fields, relations: [] } : entry,
      );
      raw.programs = changed.programs.map((entry) =>
        entry.id === `program.c.practice-${suffix}`
          ? { ...entry, bindings: echo.bindings, exampleInput: { x: 7 } }
          : entry,
      );
      raw.exercises = changed.exercises.map((entry) =>
        entry.id === `exercise.c.${suffix}`
          ? { ...entry, tests: entry.tests.map((test) => ({ ...test, input: { x: 7 } })) }
          : entry,
      );
      expect(() => inspectContentDraft(data(changed))).toThrow('CONTENT_BINDING_INVALID');
    },
  );
  it('rejects enabling a reserved language through a course package', () => {
    const changed = {
      ...source,
      languages: source.languages.map((entry) =>
        entry.id === 'lang.java' ? { ...entry, execution: 'subset' } : entry,
      ),
    };
    expect(() => inspectContentDraft(data(changed))).toThrow();
  });
  it.each([
    'profile-id',
    'profile-version',
    'program-id',
    'input-id',
    'subject-id',
    'extra-input',
    'extra-binding',
    'legacy-vector',
    'mixed-vector',
  ])('rejects an unreviewed no-input combination %s', (kind) => {
    const changed = request();
    if (kind === 'profile-id') changed.judge!.profileRef.id = 'judge.c.unknown';
    if (kind === 'profile-version') changed.judge!.profileRef.version = '9.0.0';
    if (kind === 'program-id') changed.programRef!.id = 'program.c.practice-other';
    if (kind === 'input-id') changed.input.specRef!.id = 'input.c.other';
    if (kind === 'subject-id') changed.subjectRef!.id = 'exercise.c.other';
    if (kind === 'extra-input') changed.input.values = { x: 1 };
    if (kind === 'extra-binding')
      changed.source.bindingMap = [{ bindingKey: 'param.x', byteRange: { start: 0, end: 1 } }];
    if (kind === 'legacy-vector') {
      changed.protocolVersion = '1.0.0';
      changed.judgeVersion = '1.0.0';
    }
    if (kind === 'mixed-vector') changed.judgeVersion = '1.0.0';
    expect(() => encodeRequest(changed)).toThrow();
  });
  it.each(['first-output', 'partial-array-init'])(
    'rejects non-null random metadata on the exact zero-input %s request',
    (suffix) => {
      const selected = exerciseCatalog(practice, `exercise.c.${suffix}`);
      const changed = exerciseRequest(
        selected,
        {
          text: selected.program.sourceExample,
          bindingMap: [],
          blockMap: [],
        },
        { contextId: 'p05.random.guard', contextRevision: 1, sourceRevision: 1 },
        'p05.random.submission',
        selected.subject.tests[0]!,
      );
      expect(() => encodeRequest(changed)).not.toThrow();
      changed.input.random = {
        generatorRef: { id: 'generator.c.p0-input', version: '1.0.0' },
        seed: 'zero-input-must-not-randomize',
      };
      expect(() => encodeRequest(changed)).toThrow('E_PROTOCOL_INVALID');
    },
  );
});
