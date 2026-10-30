import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  blockPermissionPolicy,
  blockLearningLesson,
  resolveBlockAccess,
  lockedProgramKinds,
} from '../../web/src/blocks/permissions';
import { createMeta, emptySnapshot, type Progress } from '../../web/src/storage/model';
import type { ContentPackage } from '../../web/src/content/types';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import { encodeAnalysisRequest } from '../../web/src/engine/analysis-protocol';
import { reverseAnalysis } from '../../web/src/blocks/reverse';
import type { ValidAnalysisResult } from '../../web/src/blocks/analysis-types';
import * as wasm from '../../web/src/generated/c_viz_wasm';
import { PracticeSession } from '../../web/src/practice/session';
import { correctBlockProgram } from '../../web/src/blocks/starters';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { draftFromBlockProgram } from '../../web/src/blocks/workspace';

const read = (path: string) => readFileSync(path, 'utf8');
const course = JSON.parse(read('content/c/p05/course-1.0.0.json')) as ContentPackage;
const packageRef = { id: course.packageId, version: course.packageVersion };
const first = course.lessons[0];
const ref = (entry: { id: string; version: string }) => ({ id: entry.id, version: entry.version });
const snapshot = () =>
  emptySnapshot(
    createMeta({
      generation: crypto.randomUUID(),
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-30T00:00:00.000Z',
      activePackageRef: packageRef,
    }),
  );
const completed = (rule = blockPermissionPolicy.rules[0]): Progress => ({
  eventType: 'lesson.completed',
  result: 'completed',
  subjectRef: rule.lessonRef,
  packageRef: rule.packageRef,
  learningRevision: rule.learningRevision,
  firstAt: '2026-10-30T00:00:00.000Z',
  lastAt: '2026-10-30T00:00:00.000Z',
});
beforeAll(() => wasm.initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));

describe('13.3 bounded course permissions', () => {
  it('links to a lesson in the exact active package rather than a missing newer lesson', () => {
    expect(
      blockLearningLesson({ id: 'content.c.p0', version: '1.0.1' }, 'scope')?.lessonRef.id,
    ).toBe('lesson.c.loops');
    expect(blockLearningLesson(packageRef, 'scope')?.lessonRef.id).toBe('lesson.c.scope-shadowing');
    expect(
      blockLearningLesson({ id: 'content.c.p05', version: '99.0.0' }, 'scope'),
    ).toBeUndefined();
  });
  it('binds every permission rule to its exact original curriculum and learning revision', () => {
    const blockIds = [
      'main',
      'integer',
      'declare-int',
      'read-variable',
      'assign-variable',
      'unary',
      'arithmetic',
      'comparison',
      'logical',
      'if',
      'while',
      'for',
      'break',
      'continue',
      'declare-array',
      'read-array',
      'write-array',
      'printf',
      'return',
      'scope',
    ];
    const kinds = [
      'main',
      'integer',
      'declare',
      'variable',
      'assign',
      'unary',
      'arithmetic',
      'compare',
      'logic',
      'if',
      'while',
      'for',
      'break',
      'continue',
      'array_declare',
      'array_read',
      'array_write',
      'print',
      'return',
      'scope',
    ];
    for (const source of blockPermissionPolicy.sources) {
      expect(createHash('sha256').update(readFileSync(source.path)).digest('hex')).toBe(
        source.sha256,
      );
      const original = JSON.parse(read(source.path)) as ContentPackage;
      for (const lesson of original.lessons) {
        const rule = blockPermissionPolicy.rules.find(
          (entry) =>
            entry.packageRef.id === original.packageId &&
            entry.packageRef.version === original.packageVersion &&
            entry.lessonRef.id === lesson.id,
        )!;
        expect(rule).toMatchObject({
          lessonRef: ref(lesson),
          learningRevision: lesson.learningRevision,
          knowledgeRefs: lesson.knowledgeRefs,
        });
        expect(rule.blocks).toEqual(
          lesson.blockRefs.map(
            (block) => kinds[blockIds.indexOf(block.id.replace('block.c.', ''))],
          ),
        );
      }
    }
    expect(
      new Set(blockPermissionPolicy.rules.map((r) => JSON.stringify([r.packageRef, r.lessonRef])))
        .size,
    ).toBe(38);
  });
  it('opens the current lesson only, without granting from started, confirmed, passed or optimistic state', () => {
    const state = snapshot();
    const rule = blockPermissionPolicy.rules.find(
      (entry) => entry.lessonRef.id === 'lesson.c.loops',
    )!;
    const done = completed(rule);
    state.progress.push({ ...done, eventType: 'lesson.study-confirmed', result: 'confirmed' });
    const access = resolveBlockAccess(packageRef, ref(first), state);
    expect(access.permanent).toEqual([]);
    expect(access.allowed).toContain('print');
    expect(access.allowed).not.toContain('while');
    expect(
      resolveBlockAccess(packageRef, { id: 'lesson.c.loops', version: '1.1.0' }, state).allowed,
    ).toContain('while');
    expect(resolveBlockAccess(packageRef, ref(first), state).allowed).not.toContain('while');
  });
  it('restores exact historical grants on refresh without awarding new version capabilities', () => {
    const state = snapshot();
    const old = blockPermissionPolicy.rules[0];
    state.progress.push(completed(old));
    expect(resolveBlockAccess(packageRef, ref(first), structuredClone(state)).permanent).toEqual(
      old.blocks,
    );
    expect(resolveBlockAccess(packageRef, ref(first), state).permanent).not.toContain('while');
    expect(state.ledger).toEqual([]);
    expect(state.meta.revision).toBe(0);
    for (const bad of [
      { ...completed(old), packageRef: { id: 'foreign.package', version: '1.0.1' } },
      { ...completed(old), subjectRef: { ...old.lessonRef, version: '99.0.0' } },
      { ...completed(old), learningRevision: old.learningRevision + 1 },
    ]) {
      state.progress = [bad];
      expect(resolveBlockAccess(packageRef, ref(first), state).permanent).toEqual([]);
    }
    expect(
      resolveBlockAccess(packageRef, { ...ref(first), version: '99.0.0' }, state),
    ).toMatchObject({ available: false, allowed: [] });
  });
  it('checks detached blocks and all nested IR nodes while preserving controlled array inputs', () => {
    const program = correctBlockProgram('exercise.c.echo', [
      { bindingKey: 'x', inputKey: 'x', targetName: 'x', targetKind: 'scalar', from: 'field' },
    ]);
    const access = resolveBlockAccess(packageRef, ref(first), null);
    expect(lockedProgramKinds(program, access)).toEqual([]);
    const draft = draftFromBlockProgram(program);
    draft.extraDetached = { type: 'cv_while', id: 'detached' };
    expect(lockedProgramKinds(program, access, draft)).toContain('while');
    expect(
      lockedProgramKinds(
        {
          ...program,
          body: [
            ...program.body,
            {
              kind: 'while',
              id: 'loop',
              condition: { kind: 'integer', id: 'condition', value: '0' },
              body: [],
            },
          ],
        },
        access,
      ),
    ).toContain('while');
    expect(
      lockedProgramKinds(
        {
          kind: 'main',
          id: 'main',
          body: [
            {
              kind: 'input',
              id: 'input',
              bindingKey: 'values',
              name: 'values',
              targetKind: 'array',
            },
          ],
        },
        access,
      ),
    ).toEqual([]);
  });

  const solutions = JSON.parse(read('tests/fixtures/p05-reference-solutions.json')) as {
    solutions: { exerciseRef: { id: string; version: string }; source: string }[];
  };
  for (const answer of solutions.solutions)
    it(`new learner can express ${answer.exerciseRef.id} using its own temporary whitelist`, () => {
      const catalog = exerciseCatalog(
        { ...course, packageRef } as unknown as CoursePractice,
        answer.exerciseRef.id,
      );
      const request = {
        kind: 'analysisRequest',
        analysisVersion: '1.0.0',
        identity: {
          contextId: 'permissions.unit',
          contextRevision: 1,
          documentRevision: 1,
          editId: 'permissions.edit',
          operationId: crypto.randomUUID(),
        },
        refs: {
          packageRef,
          programRef: ref(catalog.program),
          subsetRef: catalog.program.subsetRef,
        },
        sourceText: answer.source,
        input: {
          specRef: catalog.program.inputRef,
          values: catalog.program.exampleInput,
          random: null,
        },
      };
      const analysis = JSON.parse(
        new TextDecoder().decode(
          wasm.analyze_code_draft(
            new TextDecoder().decode(
              encodeAnalysisRequest(
                request as Parameters<typeof encodeAnalysisRequest>[0],
                catalog,
              ),
            ),
            JSON.stringify(catalog),
            1000,
          ),
        ),
      ) as ValidAnalysisResult;
      expect(analysis.status).toBe('valid');
      const mapped = reverseAnalysis(analysis, answer.source, catalog.program.bindings);
      expect(
        lockedProgramKinds(
          mapped.program,
          resolveBlockAccess(packageRef, catalog.subject.lessonRef, null),
        ),
      ).toEqual([]);
    });
  it('enforces permissions in the session before execution even without a mounted UI', async () => {
    const legacy = JSON.parse(
      read('web/public/content/practice/course-practice-1.0.0.json'),
    ) as CoursePractice;
    const execute = vi.fn();
    const session = new PracticeSession(
      {
        prepare: async (catalog, input = catalog.program.exampleInput) =>
          JSON.parse(
            new TextDecoder().decode(
              wasm.prepare_input(
                JSON.stringify(catalog),
                new TextEncoder().encode(JSON.stringify(input)),
                1000,
              ),
            ),
          ).source as PreparedSource,
        execute,
        invalidate: vi.fn(),
        cancel: vi.fn(),
        checkDeadline: vi.fn(),
      },
      async () => legacy,
      (action) => action(),
      {
        context: () => ({ catalog: null, epoch: 0 }),
        save: vi.fn(),
        access: (catalog) =>
          resolveBlockAccess(catalog.packageRef, catalog.subject.lessonRef, null),
      },
    );
    session.enter('exercise.c.echo');
    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('ready'));
    const program = {
      ...session.getSnapshot().program!,
      body: [
        ...session.getSnapshot().program!.body,
        {
          kind: 'while' as const,
          id: 'forbidden',
          condition: { kind: 'integer' as const, id: 'false', value: '0' },
          body: [],
        },
      ],
    };
    session.editBlocks(program, [], draftFromBlockProgram(program));
    await session.run();
    await session.submit();
    expect(execute).not.toHaveBeenCalled();
    expect(session.getSnapshot().message).toContain('未解锁');
    session.close();
  });
});
