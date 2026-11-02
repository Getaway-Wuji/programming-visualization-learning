import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { PracticeSession } from '../../web/src/practice/session';
import {
  bugQuestions,
  extendBugPractice,
  hasBugLearningSupplement,
} from '../../web/src/bugs/content';
import { bugSource } from '../../web/src/bugs/source';
import type { CoursePractice } from '../../web/src/content/practice';
import { exerciseCatalog } from '../../web/src/content/practice';
import type { AnalysisPort } from '../../web/src/practice/edit-document';
import {
  encodeAnalysisRequest,
  decodeAnalysisResult,
} from '../../web/src/engine/analysis-protocol';
import { encodeRequest, decodeResult } from '../../web/src/engine/protocol';
import type { ExecutionClient, PreparedSource } from '../../web/src/engine/execution-client';
import { engineBuild } from '../../web/src/generated/engine-build';
import * as wasm from '../../web/src/generated/c_viz_wasm';

const source = JSON.parse(readFileSync('content/c/p05/course-1.0.0.json', 'utf8'));
const original: CoursePractice = {
  practiceVersion: '1.0.0',
  sourceSha256: 'a'.repeat(64),
  packageRef: { id: source.packageId, version: source.packageVersion },
  exercises: source.exercises,
  programs: source.programs,
  inputSpecs: source.inputSpecs,
  judgeProfiles: source.judgeProfiles,
};
const content = extendBugPractice(original),
  encoder = new TextEncoder(),
  decoder = new TextDecoder();
const evidence: { kind: string; request: unknown; result: unknown }[] = [];
beforeAll(() => wasm.initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
afterAll(() => {
  mkdirSync('.artifacts/14.3', { recursive: true });
  writeFileSync(
    `.artifacts/${process.env.TASK_EVIDENCE_TASK ?? '14.3'}/bugs-execution-${process.env.TASK_EVIDENCE_LABEL ?? Date.now()}.json`,
    JSON.stringify(evidence, null, 2) + '\n',
    { flag: 'wx' },
  );
});
const analyze: AnalysisPort['analyze'] = async (catalog, request, options = {}) => {
  const remaining = Math.max(
    0,
    1000 - Math.ceil(performance.now() - (options.started ?? performance.now())),
  );
  const bytes = wasm
    .analyze_code_draft(
      decoder.decode(encodeAnalysisRequest(request, catalog)),
      JSON.stringify(catalog),
      remaining,
    )
    .slice();
  const result = await decodeAnalysisResult(bytes.buffer, request, catalog);
  evidence.push({ kind: 'analysis', request, result });
  return result;
};
function client() {
  return {
    prepare: async (catalog, input = catalog.program.exampleInput) =>
      JSON.parse(
        decoder.decode(
          wasm.prepare_input(
            JSON.stringify(catalog),
            encoder.encode(
              JSON.stringify(
                Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))),
              ),
            ),
            1000,
          ),
        ),
      ).source as PreparedSource,
    execute: vi.fn<ExecutionClient['execute']>(async (request, catalog, display) => {
      const bytes = wasm
        .execute_request(
          encodeRequest(request),
          JSON.stringify(catalog),
          engineBuild.wasmSha256,
          request.remainingMs,
        )
        .slice();
      let result;
      try {
        result = await decodeResult(bytes.buffer, request);
      } catch (error) {
        evidence.push({
          kind: 'receive-failure',
          request,
          result: { raw: JSON.parse(decoder.decode(bytes)), error: String(error) },
        });
        throw error;
      }
      evidence.push({ kind: 'execute', request, result });
      display?.(result);
      return result;
    }),
    invalidate: vi.fn(),
    cancel: vi.fn(),
    checkDeadline: vi.fn(),
  } satisfies Pick<
    ExecutionClient,
    'prepare' | 'execute' | 'invalidate' | 'cancel' | 'checkDeadline'
  >;
}
async function open(id: string) {
  const port = client(),
    session = new PracticeSession(
      port,
      async () => content,
      (action) => action(),
      undefined,
      { analyze, cancel: vi.fn() },
    );
  if (id === 'exercise.c.bug-sum-initial') {
    const initialize = session.enableCodeEditing.bind(session);
    // Reproduce the canvas winning initialization before the visible editor.
    vi.spyOn(session, 'enableCodeEditing').mockImplementationOnce(() => initialize(false));
  }
  session.enter(id);
  await vi.waitFor(() => {
    const s = session.getSnapshot();
    expect(s.editDocument).toBeDefined();
    expect(s.editDocument?.analysisPending).toBe(false);
    expect(s.codeEditing).toBe(true);
    expect(s.editDocument?.codeDraft).toContain(
      bugQuestions.find((q) => q.exerciseRef.id === id)!.brokenBody,
    );
  });
  return { session, port };
}
for (const q of bugQuestions)
  it(`real Rust broken, repair, alternative and constant rejection: ${q.exerciseRef.id}`, async () => {
    const { session, port } = await open(q.exerciseRef.id);
    try {
      if (q.category === 'syntax') {
        expect(session.getSnapshot().editDocument?.diagnostics[0]).toMatchObject({
          code: 'E_PARSE_INVALID',
          origin: 'rust',
          stage: 'parse',
        });
        await session.submit();
        expect(port.execute).not.toHaveBeenCalled();
      } else {
        await session.submit();
        expect(session.getSnapshot().phase).toBe('unmet');
      }
      const catalog = exerciseCatalog(content, q.exerciseRef.id),
        base = await port.prepare(catalog, catalog.subject.tests[0].input);
      for (const body of [q.solutionBody, q.alternativeBody]) {
        session.editCode(bugSource(catalog, base, body));
        await vi.waitFor(() =>
          expect(session.getSnapshot().editDocument?.syncStatus).toBe('synced'),
        );
        await vi.waitFor(() =>
          expect(session.getSnapshot().editDocument?.analysisPending).toBe(false),
        );
        expect(session.getSnapshot().editDocument?.analysisError).toBeNull();
        await session.submit();
        expect(session.getSnapshot().phase).toBe('met');
        expect(session.getSnapshot().summaries).toHaveLength(4);
        expect(
          session.getSnapshot().summaries.every((s) => s.met && s.terminal === 'completed'),
        ).toBe(true);
      }
      session.editCode(bugSource(catalog, base, 'printf("0\\n"); return 0;'));
      await vi.waitFor(() => expect(session.getSnapshot().editDocument?.syncStatus).toBe('synced'));
      await vi.waitFor(() =>
        expect(session.getSnapshot().editDocument?.analysisPending).toBe(false),
      );
      await session.submit();
      expect(session.getSnapshot().phase).toBe('unmet');
    } finally {
      session.close();
    }
  }, 15000);

const projection = () =>
  content.exercises.map((e) => ({
    ref: { id: e.id, version: e.version },
    learningRevision: e.learningRevision,
    acceptedPriorVersions: e.acceptedPriorVersions,
    lessonRef: e.lessonRef,
    caseKeys: e.tests.map((t) => t.caseKey),
  }));
it('supplement adds only four identities and preserves every original byte and required relation', () => {
  expect(content.exercises.slice(0, 32)).toEqual(original.exercises);
  expect(original.exercises).toHaveLength(32);
  expect(
    source.lessons.reduce(
      (n: number, l: { requiredExerciseRefs: unknown[] }) => n + l.requiredExerciseRefs.length,
      0,
    ),
  ).toBe(32);
  expect(hasBugLearningSupplement(projection())).toBe(true);
  const candidate = JSON.parse(
    readFileSync('web/public/content/course/course-bundle-1.2.0.json', 'utf8'),
  );
  const originalReading = JSON.parse(
    readFileSync('web/public/content/reading/course-reading-1.1.0.json', 'utf8'),
  );
  expect(candidate.reading).toEqual(originalReading);
  expect(candidate.reading.catalog.exercises).toHaveLength(32);
  expect(candidate.practice.exercises).toHaveLength(36);
  expect(() => extendBugPractice(content)).toThrow('BUG_BASE_INVALID');
});
it.each(['id', 'version', 'revision', 'parent', 'cases', 'missing'] as const)(
  'does not authorize an altered supplementary catalog: %s',
  (field) => {
    const p = projection();
    const item = p[32];
    if (field === 'id') item.ref.id = 'exercise.c.forged';
    if (field === 'version') item.ref.version = '2.0.0';
    if (field === 'revision') item.learningRevision = 2;
    if (field === 'parent') item.lessonRef = { id: 'lesson.c.invalid', version: '1.0.0' };
    if (field === 'cases') item.caseKeys[0] = 'forged';
    if (field === 'missing') p.pop();
    expect(hasBugLearningSupplement(p)).toBe(false);
  },
);
