import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PracticeSession } from '../../web/src/practice/session';
import type { AnalysisPort } from '../../web/src/practice/edit-document';
import { draftFromBlockProgram } from '../../web/src/blocks/workspace';
import { correctBlockProgram } from '../../web/src/blocks/starters';
import type { CoursePractice } from '../../web/src/content/practice';
import { generateBlockSource } from '../../web/src/blocks/generator';
import {
  encodeAnalysisRequest,
  decodeAnalysisResult,
} from '../../web/src/engine/analysis-protocol';
import {
  initSync,
  prepare_input,
  execute_request,
  analyze_code_draft,
} from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import { decodeResult, encodeRequest } from '../../web/src/engine/protocol';
import type { ExecutionClient, PreparedSource } from '../../web/src/engine/execution-client';

const content = JSON.parse(
  readFileSync('web/public/content/practice/course-practice-1.0.0.json', 'utf8'),
) as CoursePractice;
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const analyze: AnalysisPort['analyze'] = async (catalog, request, options = {}) => {
  const remaining = Math.max(
    0,
    1000 - Math.ceil(performance.now() - (options.started ?? performance.now())),
  );
  const bytes = analyze_code_draft(
    decoder.decode(encodeAnalysisRequest(request, catalog)),
    JSON.stringify(catalog),
    remaining,
  ).slice();
  return decodeAnalysisResult(bytes.buffer, request, catalog);
};
function client() {
  const execute = vi.fn<ExecutionClient['execute']>(async (request, catalog, display) => {
    const bytes = execute_request(
      encodeRequest(request),
      JSON.stringify(catalog),
      engineBuild.wasmSha256,
      1000,
    ).slice();
    const result = await decodeResult(bytes.buffer, request);
    display?.(result);
    return result;
  });
  const port = {
    prepare: async (catalog, input = catalog.program.exampleInput) => {
      const sorted = Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, input[key]]),
      );
      return (
        JSON.parse(
          decoder.decode(
            prepare_input(JSON.stringify(catalog), encoder.encode(JSON.stringify(sorted)), 1000),
          ),
        ) as { source: PreparedSource }
      ).source;
    },
    execute,
    invalidate: vi.fn(),
    cancel: vi.fn(),
    checkDeadline: vi.fn(),
  } satisfies Pick<
    ExecutionClient,
    'prepare' | 'execute' | 'invalidate' | 'cancel' | 'checkDeadline'
  >;
  return port;
}
async function open(id = 'exercise.c.echo', analyzer: AnalysisPort = { analyze, cancel: vi.fn() }) {
  const port = client();
  const session = new PracticeSession(
    port,
    async () => content,
    (action) => action(),
    undefined,
    analyzer,
  );
  session.enter(id);
  await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('ready'));
  session.recordWorkspaceDraft(draftFromBlockProgram(session.getSnapshot().program!));
  await session.enableCodeEditing();
  expect(session.getSnapshot().editDocument?.syncStatus).toBe('synced');
  return { session, port };
}
async function settle(session: PracticeSession) {
  await vi.waitFor(() => expect(session.getSnapshot().editDocument?.analysisPending).toBe(false));
}
beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
describe('A single bidirectional exercise document with real Rust analysis and execution', () => {
  it('starts the same checked document with no mounted canvas or supplied workspace snapshot', async () => {
    const port = client();
    const session = new PracticeSession(
      port,
      async () => content,
      (action) => action(),
      undefined,
      {
        analyze,
        cancel: vi.fn(),
      },
    );
    session.enter('exercise.c.echo');
    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('ready'));
    expect(session.getSnapshot().draft).toBeUndefined();
    await session.enableCodeEditing();
    const document = session.getSnapshot().editDocument!;
    expect(document.syncStatus).toBe('synced');
    expect(document.validatedDocumentRevision).toBe(document.identity.documentRevision);
    expect(session.getSnapshot().draft).toBeDefined();
    expect(port.execute).not.toHaveBeenCalled();
    session.setCodeEditing(false);
    session.setCodeEditing(true);
    expect(session.getSnapshot().editDocument).toBe(document);
    session.close();
  });

  it('keeps the first incomplete block draft writable from code without resurrecting the last valid run', async () => {
    const port = client();
    const session = new PracticeSession(
      port,
      async () => content,
      (action) => action(),
      undefined,
      {
        analyze,
        cancel: vi.fn(),
      },
    );
    session.enter('exercise.c.nonnegative');
    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('ready'));
    await session.enableCodeEditing(false);
    expect(session.getSnapshot().codeEditing).toBe(false);
    const initial = session.getSnapshot();
    session.editBlocks(
      null,
      [{ code: 'BLOCK_SHAPE', blockId: 'detached', message: 'incomplete' }],
      initial.draft!,
    );
    const invalid = session.getSnapshot().editDocument!;
    await session.enableCodeEditing();
    expect(session.getSnapshot().codeEditing).toBe(true);
    expect(session.getSnapshot().editDocument).toBe(invalid);
    expect(invalid.syncStatus).toBe('invalid');
    await session.run();
    expect(port.execute).not.toHaveBeenCalled();
    session.setCodeEditing(false);
    session.switchMode('correction');
    session.switchMode('independent');
    expect(session.getSnapshot().codeEditing).toBe(false);
    expect(session.getSnapshot().editDocument?.syncStatus).toBe('invalid');
    session.close();
  });

  it('rejects an over-budget or malformed-Unicode edit atomically and retains the complete current draft', async () => {
    const { session, port } = await open();
    const document = session.getSnapshot().editDocument!;
    session.editCode('x'.repeat(32769));
    expect(session.getSnapshot().editDocument).toBe(document);
    expect(session.getSnapshot().editRejection).toContain('32 KiB');
    session.editCode('\uD800');
    expect(session.getSnapshot().editDocument).toBe(document);
    expect(session.getSnapshot().editRejection).toContain('Unicode');
    expect(port.execute).not.toHaveBeenCalled();
    session.close();
  });
  it('cancels only the running operation and prepares a fresh attempt from the same checked draft', async () => {
    const { session, port } = await open();
    const revision = session.getSnapshot().editDocument!.identity.documentRevision;
    const running = session.run();
    session.cancel();
    await running;
    expect(session.getSnapshot().phase).toBe('cancelled');
    expect(session.getSnapshot().editDocument?.syncStatus).toBe('synced');
    expect(session.getSnapshot().editDocument?.analysisError).toBeNull();
    expect(session.getSnapshot().source).toBeDefined();
    await session.preview();
    expect(session.getSnapshot().phase).toBe('ready');
    expect(session.getSnapshot().editDocument?.identity.documentRevision).toBe(revision);
    await session.run();
    expect(port.execute).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().phase).toBe('ran');
    await session.preview();
    expect(session.getSnapshot().phase).toBe('ready');
    session.close();
  });
  it.each(content.exercises.map((exercise) => exercise.id))(
    'submits original test set from code: %s',
    async (id) => {
      const { session, port } = await open(id);
      const snapshot = session.getSnapshot();
      const program = correctBlockProgram(id, snapshot.catalog!.program.bindings);
      const base = await port.prepare(snapshot.catalog!, snapshot.catalog!.subject.tests[0].input);
      const source = generateBlockSource(program, base, snapshot.catalog!.program.bindings);
      session.editCode(source.text);
      await settle(session);
      expect(session.getSnapshot().editDocument?.syncStatus).toBe('synced');
      expect(session.getSnapshot().editDocument?.codeDraft).toBe(source.text);
      await session.submit();
      expect(session.getSnapshot().phase).toBe('met');
      const accepted = session.getSnapshot();
      await session.preview();
      expect(session.getSnapshot().phase).toBe('met');
      expect(session.getSnapshot().source).toEqual(accepted.source);
      expect(session.getSnapshot().caseKey).toBe(accepted.caseKey);
      expect(session.getSnapshot().result?.identity.runId).toBe(accepted.result?.identity.runId);
      expect(port.execute).toHaveBeenCalledTimes(snapshot.catalog!.subject.tests.length);
      const controlMaps = port.execute.mock.calls.map(([request]) =>
        request.source.blockMap.map((item) => item.blockId),
      );
      for (const ids of controlMaps) expect(ids).toEqual(controlMaps[0]);
      session.close();
    },
  );
  it.each([
    ['invalid', 'int main(){int x ='],
    ['unmapped', '@empty'],
    ['unmapped', '@underscore'],
    ['invalid', 'int main(){int x = 4;printf("%d",x);}'],
  ])(
    'retains %s current source and never executes its last synced program',
    async (status, sample) => {
      const { session, port } = await open();
      const text = sample.startsWith('@')
        ? session
            .getSnapshot()
            .editDocument!.codeDraft.replace(
              'return 0;',
              sample === '@empty' ? '; return 0;' : 'int _local=1; return 0;',
            )
        : sample;
      session.editCode(text);
      await settle(session);
      expect(session.getSnapshot().editDocument?.codeDraft).toBe(text);
      expect(session.getSnapshot().editDocument?.syncStatus).toBe(status);
      expect(session.getSnapshot().source).toBeUndefined();
      expect(session.getSnapshot().editDocument?.lastSynced).not.toBeNull();
      await session.run();
      await session.submit();
      expect(port.execute).not.toHaveBeenCalled();
      session.close();
    },
  );
  it('keeps invalid text over independent/correction and presentation changes, then recovers', async () => {
    const { session } = await open();
    const original = session.getSnapshot().editDocument!.codeDraft;
    const invalid = `${original}\nint`;
    session.editCode(invalid);
    await settle(session);
    const revision = session.getSnapshot().editDocument!.identity.documentRevision;
    session.setCodeEditing(false);
    session.setCodeEditing(true);
    expect(session.getSnapshot().editDocument!.identity.documentRevision).toBe(revision);
    session.switchMode('correction');
    session.switchMode('independent');
    await settle(session);
    expect(session.getSnapshot().editDocument!.codeDraft).toBe(invalid);
    expect(session.getSnapshot().editDocument!.syncStatus).toBe('invalid');
    session.editCode(original);
    await settle(session);
    expect(session.getSnapshot().editDocument!.syncStatus).toBe('synced');
    session.close();
  });
  it('does not turn a detached block snapshot into last valid code on mode return or retry', async () => {
    const { session, port } = await open();
    const snapshot = session.getSnapshot();
    session.editBlocks(
      null,
      [{ code: 'BLOCK_SHAPE', blockId: 'detached', message: 'incomplete' }],
      snapshot.draft!,
    );
    session.switchMode('correction');
    session.switchMode('independent');
    await session.retryAnalysis();
    expect(session.getSnapshot().editDocument!.syncStatus).toBe('invalid');
    expect(session.getSnapshot().program).toBeUndefined();
    await session.run();
    expect(port.execute).not.toHaveBeenCalled();
    session.close();
  });
  it('maps selections without incrementing document or discarding a real run', async () => {
    const { session } = await open();
    const revision = session.getSnapshot().editDocument!.identity.documentRevision;
    const first = session.getSnapshot().source!.blockMap[0];
    session.selectBlock(first.blockId);
    expect(session.getSnapshot().selectedCodeRange).toEqual(first.byteRange);
    session.selectCode(first.byteRange);
    expect(session.getSnapshot().editDocument!.identity.documentRevision).toBe(revision);
    await session.run();
    const runId = session.getSnapshot().result!.identity.runId;
    session.selectBlock(first.blockId);
    session.setCodeEditing(false);
    expect(session.getSnapshot().result!.identity.runId).toBe(runId);
    session.close();
  });
});
