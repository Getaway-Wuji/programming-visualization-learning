import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { historyMemory } from '../fixtures/editor-history';
import type { EditorHistoryPort } from '../../web/src/practice/history';
import { PracticeSession } from '../../web/src/practice/session';
import type { AnalysisPort } from '../../web/src/practice/edit-document';
import { draftFromBlockProgram } from '../../web/src/blocks/workspace';
import { correctBlockProgram } from '../../web/src/blocks/starters';
import type { CoursePractice } from '../../web/src/content/practice';
import { resolveBlockAccess } from '../../web/src/blocks/permissions';
import { createMeta, emptySnapshot } from '../../web/src/storage/model';
import { assertEditorSnapshot } from '../../web/src/storage/editor-history';
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
  readFileSync('web/public/content/practice/course-practice-1.1.0.json', 'utf8'),
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
async function open(
  id = 'exercise.c.echo',
  analyzer: AnalysisPort = { analyze, cancel: vi.fn() },
  history?: EditorHistoryPort,
) {
  const port = client();
  const session = new PracticeSession(
    port,
    async () => content,
    (action) => action(),
    {
      context: () => ({ catalog: null, epoch: 0 }),
      save: async () => undefined,
      access: (catalog) =>
        resolveBlockAccess(
          catalog.packageRef,
          catalog.subject.lessonRef,
          emptySnapshot(
            createMeta({
              generation: crypto.randomUUID(),
              timeZone: 'Asia/Shanghai',
              createdAt: '2026-10-30T00:00:00.000Z',
              activePackageRef: catalog.packageRef,
            }),
          ),
        ),
    },
    analyzer,
    history,
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

describe('13.5 configured reconstruction with real Rust and isolated drafts', () => {
  it.each([
    'exercise.c.echo',
    'exercise.c.two-x-plus-three',
    'exercise.c.nonnegative',
    'exercise.c.two-loop-sums',
    'exercise.c.increment-at-index',
    'exercise.c.array-sum',
  ])('validates the reference, a native block answer and a different structure: %s', async (id) => {
    const { session, port } = await open(id);
    const reference = session.getSnapshot().reconstructionSource!;
    expect(reference).toContain('printf');
    // Independently run the displayed reference, then construct native blocks.
    session.editCode(reference);
    await settle(session);
    await session.submit();
    expect(session.getSnapshot().phase).toBe('met');
    session.switchMode('reconstruction');
    await session.enableCodeEditing();
    expect(session.getSnapshot().codeEditing).toBe(false);
    expect(session.getSnapshot().program!.body.every((node) => node.kind === 'input')).toBe(true);
    expect(session.getSnapshot().result).toBeUndefined();
    const catalog = session.getSnapshot().catalog!;
    const blocks = correctBlockProgram(id, catalog.program.bindings);
    session.editBlocks(blocks, [], draftFromBlockProgram(blocks));
    await settle(session);
    await session.submit();
    expect(session.getSnapshot().phase).toBe('met');
    const groups = catalog.subject.tests.length;
    expect(port.execute).toHaveBeenCalledTimes(groups * 2);
    // Construct another mapped program from different, valid source through Rust.
    // This authoring fixture does not expose a source importer in reconstruction mode.
    session.switchMode('independent');
    const changes: Record<string, (text: string) => string> = {
      'exercise.c.echo': (text) =>
        text.replace('printf("%d\\n", x);', 'int copied = x;\n    printf("%d\\n", copied);'),
      'exercise.c.two-x-plus-three': (text) => text.replace('(2 * x) + 3', '(x * 2) + 3'),
      'exercise.c.nonnegative': (text) =>
        text
          .replace('x >= 0', 'x < 0')
          .replace('printf("%d\\n", 1);', 'printf("%d\\n", 8);')
          .replace('printf("%d\\n", 0);', 'printf("%d\\n", 1);')
          .replace('printf("%d\\n", 8);', 'printf("%d\\n", 0);'),
      'exercise.c.two-loop-sums': (text) =>
        text
          .replace('int i = 1', 'int i = n')
          .replace('i <= n', 'i >= 1')
          .replace('i = i + 1', 'i = i - 1')
          .replace('int j = 1', 'int j = n')
          .replace('j <= n', 'j >= 1')
          .replace('j = j + 1', 'j = j - 1'),
      'exercise.c.increment-at-index': (text) =>
        text.replace(
          'values[k] = values[k] + 1;',
          'int updated = values[k] + 1;\n    values[k] = updated;',
        ),
      'exercise.c.array-sum': (text) =>
        text
          .replace('int i = 0', 'int i = n - 1')
          .replace('i < n', 'i >= 0')
          .replace('i = i + 1', 'i = i - 1'),
    };
    const alternative = changes[id](reference);
    expect(alternative).not.toBe(reference);
    session.editCode(alternative);
    await settle(session);
    expect(session.getSnapshot().editDocument?.syncStatus).toBe('synced');
    const other = session.getSnapshot().program!;
    session.switchMode('reconstruction');
    session.editBlocks(other, [], draftFromBlockProgram(other));
    await settle(session);
    await session.submit();
    expect(session.getSnapshot().phase).toBe('met');
    expect(port.execute).toHaveBeenCalledTimes(groups * 3);
    expect(session.getSnapshot().summaries).toHaveLength(groups);
    session.close();
  });

  it('keeps mode-local history, rejects source entry and invalidates an accepted run on restore', async () => {
    const { port: storage, rows, context } = historyMemory();
    context.activePackageRef = content.packageRef;
    const { session, port } = await open('exercise.c.echo', undefined, storage);
    const original = session.getSnapshot().editDocument!.codeDraft;
    session.editCode(original + '\nint');
    await settle(session);
    session.switchMode('reconstruction');
    await session.enableCodeEditing();
    await vi.waitFor(() => expect(session.history.getSnapshot().status).toBe('ready'));
    const initial = [...rows.values()].find((r) => r.scope.mode === 'reconstruction')!;
    expect(initial.historyVersion).toBe('1.1.0');
    expect(initial.authority).toBe('blocks');
    expect(() => assertEditorSnapshot(initial)).not.toThrow();
    expect(() => assertEditorSnapshot({ ...initial, historyVersion: '1.0.0' })).toThrow();
    const foreign = {
      ...initial,
      entryId: crypto.randomUUID(),
      sequence: 99,
      authority: 'code' as const,
    };
    rows.set(foreign.entryId, foreign);
    await session.history.reload();
    const revision = session.getSnapshot().editDocument!.identity.documentRevision;
    await session.restoreHistory(foreign.entryId);
    expect(session.getSnapshot().editDocument!.identity.documentRevision).toBe(revision);
    expect(session.getSnapshot().message).toContain('当前草稿已保留');
    session.setCodeEditing(true);
    session.editCode(session.getSnapshot().reconstructionSource!);
    expect(session.getSnapshot().codeEditing).toBe(false);
    expect(session.getSnapshot().program!.body).toHaveLength(1);
    await session.submit();
    expect(session.getSnapshot().phase).toBe('unmet');
    const blocks = correctBlockProgram(
      'exercise.c.echo',
      session.getSnapshot().catalog!.program.bindings,
    );
    session.editBlocks(blocks, [], draftFromBlockProgram(blocks));
    await settle(session);
    await session.submit();
    expect(session.getSnapshot().phase).toBe('met');
    await session.restoreHistory(initial.entryId);
    expect(session.getSnapshot().result).toBeUndefined();
    expect(session.getSnapshot().program!.body).toHaveLength(1);
    const calls = port.execute.mock.calls.length;
    session.switchMode('independent');
    await settle(session);
    expect(session.getSnapshot().editDocument!.codeDraft).toBe(original + '\nint');
    await session.submit();
    expect(port.execute).toHaveBeenCalledTimes(calls);
    session.close();
  });

  it('requires the exact configured content version and preserves current source for unsupported questions', async () => {
    const { session } = await open('exercise.c.first-output');
    const before = session.getSnapshot();
    session.switchMode('reconstruction');
    expect(session.getSnapshot()).toBe(before);
    session.close();
  });
});
