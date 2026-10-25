import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  coursePath,
  embeddedExamples,
  originalContent,
  referenceStdout,
  sha256,
  verifyCourseContent,
  workspace,
} from '../../scripts/verify-course-content.mjs';
import {
  ContentError,
  inspectContentDraft,
  parseContent,
} from '../../web/src/content/validator.mjs';
import type { CourseContentDraft } from '../../web/src/content/validator.mjs';
import type {
  CaseEntity,
  ExerciseEntity,
  InputValues,
  ProgramEntity,
} from '../../web/src/content/types';
import { decodeResult, encodeRequest } from '../../web/src/engine/protocol';
import type { ExecuteRequest, ExecuteResult, TraceObject } from '../../web/src/engine/protocol';
import { initSync, execute_request, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';

const bytes = readFileSync(coursePath);
const candidate = () => structuredClone(inspectContentDraft(bytes)) as CourseContentDraft;
const course = candidate();
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
const encoded = (value: unknown) => encoder.encode(JSON.stringify(value));
function rejected(value: unknown, code: string) {
  try {
    inspectContentDraft(encoded(value));
    throw new Error('Invalid candidate accepted');
  } catch (error) {
    expect(error).toBeInstanceOf(ContentError);
    expect((error as ContentError).diagnostics.some((entry) => entry.code === code)).toBe(true);
  }
}
describe('09.1 separate offline editorial review and unchanged production publication gate', () => {
  it('keeps 82 immutable entity identities, exact references, ten knowledge points and six/24 targets', () => {
    const { summary } = verifyCourseContent(bytes);
    expect(summary.bumpedEntityCount).toBe(22);
    expect(summary.unchangedEntityCount).toBe(60);
    expect(summary.counts.knowledgePoints).toBe(10);
    expect(summary.publicationVerified).toBe(false);
    expect(summary.judgeImplemented).toBe(false);
    expect(Object.isFrozen(inspectContentDraft(bytes).lessons[0].teaching)).toBe(true);
  });
  it('keeps the existing 1.0.0 fixture accepted and rejects 1.0.1 in the production parser', () => {
    expect(originalContent().packageVersion).toBe('1.0.0');
    expect(() => parseContent(bytes)).toThrow(ContentError);
    const fixture = structuredClone(originalContent());
    expect(() => parseContent(encoded({ ...fixture, purpose: 'publishable' }))).toThrow(
      'CONTENT_PUBLICATION_UNVERIFIED',
    );
    expect(() => inspectContentDraft(encoded({ ...fixture, purpose: 'publishable' }))).toThrow(
      'CONTENT_SCHEMA_INVALID',
    );
    expect(fixture.purpose).toBe('contract-fixture');
  });
  it.each([
    [
      'mixed entity version',
      (c: CourseContentDraft) => Object.assign(c.lessons[0], { version: '1.0.0' }),
      'CONTENT_SCHEMA_INVALID',
    ],
    [
      'unregistered package',
      (c: CourseContentDraft) => Object.assign(c, { packageVersion: '1.0.2' }),
      'CONTENT_SCHEMA_INVALID',
    ],
    [
      'unregistered entity',
      (c: CourseContentDraft) => Object.assign(c.programs[0], { version: '1.0.1' }),
      'CONTENT_SCHEMA_INVALID',
    ],
    [
      'fixture purpose on editorial version',
      (c: CourseContentDraft) => Object.assign(c, { purpose: 'contract-fixture' }),
      'CONTENT_SCHEMA_INVALID',
    ],
    [
      'missing knowledge',
      (c: CourseContentDraft) =>
        Object.assign(c.lessons[0].knowledgeRefs[0], { id: 'knowledge.c.missing' }),
      'CONTENT_REF_MISSING',
    ],
    [
      'stale exact reference',
      (c: CourseContentDraft) => Object.assign(c.chapters[0].lessonRefs[0], { version: '1.0.0' }),
      'CONTENT_REF_VERSION',
    ],
    [
      'changed test expectation',
      (c: CourseContentDraft) =>
        Object.assign(c.exercises[0].tests[0], { expectedStdout: '999\n' }),
      'CONTENT_JUDGE_INVALID',
    ],
    [
      'false prior compatibility',
      (c: CourseContentDraft) => Object.assign(c.lessons[0], { acceptedPriorVersions: ['1.0.0'] }),
      'CONTENT_LEARNING_COMPATIBILITY_INVALID',
    ],
  ] as const)('rejects %s', (_label, mutate, code) => {
    const value = candidate();
    mutate(value);
    rejected(value, code);
  });
  it('rejects duplicate JSON keys in the offline path too', () => {
    expect(() => inspectContentDraft(encoder.encode('{"x":1,"x":2}'))).toThrow(
      'CONTENT_JSON_DUPLICATE_KEY',
    );
  });
  it('extracts all 11 unmodified complete body examples, including four deliberate runtime failures', () => {
    const examples = embeddedExamples(course);
    expect(examples).toHaveLength(11);
    expect(examples.filter((item) => item.error).map((item) => item.error)).toEqual([
      'E_UNINITIALIZED',
      'E_DIV_ZERO',
      'E_INT_OVERFLOW',
      'E_INDEX_BOUNDS',
    ]);
  });
  it('rejects same-ID same-version source rewrites in the course authoring audit', () => {
    const changed = candidate();
    Object.assign(changed.programs[0], {
      sourceExample: changed.programs[0].sourceExample.replace('printf', 'missing'),
    });
    expect(() => verifyCourseContent(encoded(changed))).toThrow('Same ID and version');
  });
});

const executionEvidence: unknown[] = [];
async function runReference(
  program: ProgramEntity,
  subject: CaseEntity | ExerciseEntity,
  input: InputValues,
  key: string,
  test?: ExerciseEntity['tests'][number],
) {
  const isExercise = !!test;
  const profile = isExercise
    ? course.judgeProfiles.find((item) => item.id === (subject as ExerciseEntity).judgeRef.id)!
    : null;
  const catalog = {
    packageRef: { id: course.packageId, version: course.packageVersion },
    subject,
    program,
    inputSpec: course.inputSpecs.find((item) => item.id === program.inputRef.id)!,
    ...(profile ? { judgeProfile: profile } : {}),
  };
  const catalogText = JSON.stringify(catalog);
  const prepared = JSON.parse(
    decoder.decode(prepare_input(catalogText, encoder.encode(canonical(input)), 1000)),
  ) as { source: ExecuteRequest['source'] };
  const request: ExecuteRequest = {
    kind: 'execute',
    protocolVersion: '1.0.0',
    traceVersion: '1.0.0',
    diagnosticVersion: '1.0.0',
    judgeVersion: '1.0.0',
    encodingVersion: '1.0.0',
    identity: {
      contextId: `course-${key}`,
      contextRevision: 1,
      sourceRevision: 1,
      submissionId: `submit-${key}`,
      runId: `run-${key}`,
      testCaseKey: test?.caseKey ?? null,
    },
    mode: isExercise ? 'exercise-test' : 'case',
    packageRef: catalog.packageRef,
    languageRef: program.languageRef,
    subsetRef: program.subsetRef,
    programRef: subject.programRef,
    subjectRef: { id: subject.id, version: subject.version },
    learningRevision: subject.learningRevision,
    engineRef: { id: 'engine.c.p0', version: '1.0.0', buildId: engineBuild.wasmSha256 },
    source: prepared.source,
    input: { specRef: program.inputRef, values: input, random: null },
    judge:
      test && profile
        ? {
            profileRef: { id: profile.id, version: profile.version },
            rule: profile.rule,
            expectedStdout: test.expectedStdout,
            expectedExitCode: 0,
            ...(test.expectedArray ? { expectedArray: [...test.expectedArray] } : {}),
          }
        : null,
    budgetRef: { id: 'budget.p0', version: '1.0.0' },
    remainingMs: 1000,
  };
  const requestBytes = encodeRequest(request);
  const resultBytes = execute_request(
    requestBytes,
    catalogText,
    engineBuild.wasmSha256,
    1000,
  ).slice();
  const result = await decodeResult(resultBytes.buffer, request);
  expect(result.producer).toBe('rust');
  expect(result.terminal).toMatchObject({ status: 'completed', exitCode: 0, diagnostics: [] });
  expect(result.trace!.completeness).toBe('complete');
  expect(result.resolvedBindings).toHaveLength(program.bindings.length);
  if (test) expect(result.judgeResult!.status).toBe('met');
  else expect(result.judgeResult).toBeNull();
  return { request, result, requestBytes, resultBytes };
}
function facts(result: ExecuteResult) {
  let stdout = '';
  let beforeDestruction: (number | null)[] | null = null;
  for (const step of result.trace!.steps) {
    for (const change of step.changes) {
      if (change.op === 'output') stdout += change.append;
      if (change.op === 'record' && change.table === 'objects') {
        const object = (change.after ?? change.before) as TraceObject;
        if (change.after === null && object.name === 'values')
          beforeDestruction = Array.from(
            { length: object.length },
            (_, index) =>
              object.cells.find((cell) => cell.index === index)?.value ?? object.defaultValue,
          );
      }
    }
  }
  return { stdout, beforeDestruction };
}
const testRows = course.exercises.flatMap((exercise) =>
  exercise.tests.map((test) => ({ exercise, test, key: `${exercise.id}-${test.caseKey}` })),
);
describe('09.1 original public reference programs through the unchanged Rust/WASM EXEC boundary', () => {
  beforeAll(() =>
    initSync({ module: readFileSync(resolve(workspace, 'web/src/generated/c_viz_wasm_bg.wasm')) }),
  );
  it.each(testRows)(
    'validates the frozen input/output and true pre-destruction array: $key',
    async ({ exercise, test, key }) => {
      const program = course.programs.find((item) => item.id === exercise.programRef.id)!;
      const execution = await runReference(program, exercise, test.input, key, test);
      const observed = facts(execution.result);
      expect(observed.stdout).toBe(test.expectedStdout);
      if (test.expectedArray) expect(observed.beforeDestruction).toEqual(test.expectedArray);
      executionEvidence.push({
        kind: 'exercise-reference-test',
        key,
        input: test.input,
        stdout: observed.stdout,
        expectedArray: test.expectedArray ?? null,
        observedArray: test.expectedArray ? observed.beforeDestruction : null,
        producer: 'rust',
        terminal: 'completed',
        exitCode: 0,
        judgeStatus: execution.result.judgeResult!.status,
        sourceSha256: sha256(execution.request.source.text),
        requestSha256: sha256(execution.requestBytes),
        resultSha256: sha256(execution.resultBytes),
        steps: execution.result.trace!.steps.length,
      });
    },
  );
  it.each(course.programs)(
    'checks the unchanged complete default reference: $id',
    async (program) => {
      const subject =
        course.cases.find((item) => item.programRef.id === program.id) ??
        course.exercises.find((item) => item.programRef.id === program.id)!;
      const matchingTest =
        'tests' in subject
          ? subject.tests.find((test) => canonical(test.input) === canonical(program.exampleInput))!
          : undefined;
      const execution = await runReference(
        program,
        subject,
        program.exampleInput,
        `default-${program.id}`,
        matchingTest,
      );
      expect(execution.request.source.text).toBe(program.sourceExample);
      const observed = facts(execution.result);
      expect(observed.stdout).toBe(referenceStdout[program.id]);
      executionEvidence.push({
        kind: 'default-reference',
        key: program.id,
        input: program.exampleInput,
        stdout: observed.stdout,
        producer: 'rust',
        terminal: 'completed',
        exitCode: 0,
        sourceSha256: sha256(execution.request.source.text),
        requestSha256: sha256(execution.requestBytes),
        resultSha256: sha256(execution.resultBytes),
        steps: execution.result.trace!.steps.length,
      });
    },
  );
  it('writes a bounded public-only verification summary and never treats it as a submission pass', () => {
    expect(executionEvidence).toHaveLength(34);
    mkdirSync(resolve(workspace, '.artifacts'), { recursive: true });
    writeFileSync(
      resolve(
        workspace,
        process.env.COURSE_EXECUTION_REPORT ?? '.artifacts/course-execution-current.json',
      ),
      JSON.stringify(
        {
          evidenceVersion: '09.1-reference-execution@1',
          passed: true,
          method:
            'Original public programs instantiated and executed by unchanged Rust/WASM; full production decoder validates all complete traces.',
          courseSha256: sha256(bytes),
          wasmSha256: engineBuild.wasmSha256,
          publicTestCount: 24,
          defaultReferenceCount: 10,
          judgeImplemented: false,
          publicationVerified: false,
          samples: executionEvidence,
        },
        null,
        2,
      ) + '\n',
    );
  });
});
