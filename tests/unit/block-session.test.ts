import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PracticeSession, type PracticeLearningPort } from '../../web/src/practice/session';
import {
  correctBlockProgram,
  correctionProgram,
  starterProgram,
} from '../../web/src/blocks/starters';
import type { BlockProgram } from '../../web/src/blocks/model';
import type { CoursePractice } from '../../web/src/content/practice';
import type { CourseReading } from '../../web/src/content/reading';
import type { ExecutionClient, PreparedSource } from '../../web/src/engine/execution-client';
import {
  decodeResult,
  encodeRequest,
  makeAdapterResult,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';
import { initSync, prepare_input, execute_request } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import { createLearningCatalog } from '../../web/src/learning/catalog';
import { blocksAtLocation } from '../../web/src/practice/block-location';

const content = JSON.parse(
  readFileSync('web/public/content/practice/course-practice-1.0.0.json', 'utf8'),
) as CoursePractice;
const reading = JSON.parse(
  readFileSync('web/public/content/reading/course-reading-1.0.0.json', 'utf8'),
) as CourseReading;
const catalog = createLearningCatalog({ ...reading.catalog, purpose: 'course-practice' });
const encoder = new TextEncoder();
const decoder = new TextDecoder();
type Port = Pick<
  ExecutionClient,
  'prepare' | 'execute' | 'invalidate' | 'cancel' | 'checkDeadline'
>;
type Finalizer = (request: ExecuteRequest, result: ExecuteResult) => Promise<ExecuteResult>;
function client(finalize?: Finalizer): Port {
  return {
    prepare: async (value, input = value.program.exampleInput) => {
      const sorted = Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, input[key]]),
      );
      return (
        JSON.parse(
          decoder.decode(
            prepare_input(JSON.stringify(value), encoder.encode(JSON.stringify(sorted)), 1000),
          ),
        ) as { source: PreparedSource }
      ).source;
    },
    execute: async (request, value, display) => {
      const bytes = execute_request(
        encodeRequest(request),
        JSON.stringify(value),
        engineBuild.wasmSha256,
        1000,
      ).slice();
      const result = await decodeResult(bytes.buffer, request);
      display?.(result);
      return finalize ? await finalize(request, result) : result;
    },
    invalidate: vi.fn(),
    cancel: vi.fn(),
    checkDeadline: vi.fn(),
  };
}
async function openEmpty(port: Port, learning?: PracticeLearningPort, id = 'exercise.c.echo') {
  const session = new PracticeSession(
    port,
    async () => content,
    (action) => action(),
    learning,
  );
  session.enter(id);
  await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('ready'));
  return session;
}
async function open(port: Port, learning?: PracticeLearningPort, id = 'exercise.c.echo') {
  const session = await openEmpty(port, learning, id);
  const active = session.getSnapshot().catalog!;
  const program = correctBlockProgram(active.subject.id, active.program.bindings);
  session.editBlocks(program, [], {});
  await session.preview();
  expect(session.getSnapshot().source).toBeDefined();
  return { session, program, active };
}

beforeAll(() => initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') }));
describe('Block session lifecycle using real Rust results and an explicit transport finalizer model', () => {
  it.each(content.exercises.map((exercise) => exercise.id))(
    'starts %s independently with inputs only and cannot pass an empty answer',
    async (id) => {
      const save = vi.fn();
      const session = await openEmpty(
        client(),
        { context: () => ({ catalog, epoch: 0 }), save },
        id,
      );
      const initial = session.getSnapshot();
      expect(initial).toMatchObject({ mode: 'independent', action: null });
      expect(initial.program!.body).toHaveLength(initial.catalog!.program.bindings.length);
      expect(initial.program!.body.every((statement) => statement.kind === 'input')).toBe(true);
      expect(initial.source!.text).not.toMatch(/printf\(|\bif\s*\(|\bwhile\s*\(|\bfor\s*\(/);
      await session.submit();
      expect(session.getSnapshot().phase).toBe('unmet');
      expect(session.getSnapshot().result?.producer).toBe('rust');
      expect(save).not.toHaveBeenCalled();
    },
  );
  it.each(content.exercises.map((exercise) => exercise.id))(
    'submits every real published test for an explicitly built independent answer: %s',
    async (id) => {
      const save = vi.fn(async () => ({ saved: true }));
      const { session, active } = await open(
        client(),
        { context: () => ({ catalog, epoch: 0 }), save },
        id,
      );
      await session.submit();
      expect(session.getSnapshot()).toMatchObject({
        mode: 'independent',
        action: 'submit',
        phase: 'met',
        saveStatus: 'saved',
      });
      expect(session.getSnapshot().summaries).toHaveLength(active.subject.tests.length);
      expect(save).toHaveBeenCalledTimes(1);
    },
  );
  it('runs only the current first published input without minting any pass or all-test summaries', async () => {
    const execute = vi.fn(client().execute);
    const save = vi.fn();
    const { session } = await open(
      { ...client(), execute },
      { context: () => ({ catalog, epoch: 0 }), save },
    );
    await session.run();
    expect(session.getSnapshot()).toMatchObject({
      action: 'run',
      phase: 'ran',
      saveStatus: 'idle',
      summaries: [],
      result: { producer: 'rust', terminal: { status: 'completed' } },
    });
    expect(session.getSnapshot().result?.judgeResult?.status).toBe('met');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    await session.submit();
    expect(session.getSnapshot().phase).toBe('met');
    expect(execute).toHaveBeenCalledTimes(4);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('withdraws provisional run success when the final deadline guard fails', async () => {
    const save = vi.fn();
    const { session } = await open(
      client(async (request) => makeAdapterResult(request, 'resource-limit', 'E_DEADLINE')),
      { context: () => ({ catalog, epoch: 0 }), save },
    );
    await session.run();
    expect(session.getSnapshot()).toMatchObject({
      action: 'run',
      phase: 'failed',
      summaries: [],
      result: { terminal: { status: 'resource-limit' } },
    });
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps both mode drafts including invalid connections and clears accepted execution on each switch', async () => {
    const { session, program, active } = await open(client());
    const invalidDraft = { blocks: { languageVersion: 0, blocks: [{ type: 'cv_print' }] } };
    const issues = [{ code: 'BLOCK_SLOT', blockId: program.id, message: '输出表达式尚未连接' }];
    session.editBlocks(null, issues, invalidDraft);
    const revision = session.getSnapshot().modeRevision;
    session.switchMode('correction');
    expect(session.getSnapshot()).toMatchObject({
      mode: 'correction',
      modeRevision: revision + 1,
      program: correctionProgram(active.subject.id, active.program.bindings),
    });
    session.editBlocks(program, [], { correction: 'custom draft' });
    await session.run();
    expect(session.getSnapshot().phase).toBe('ran');
    session.switchMode('independent');
    expect(session.getSnapshot()).toMatchObject({
      mode: 'independent',
      phase: 'ready',
      action: null,
      draft: invalidDraft,
      issues,
      summaries: [],
    });
    expect(session.getSnapshot().program).toBeUndefined();
    expect(session.getSnapshot().source).toBeUndefined();
    expect(session.getSnapshot().result).toBeUndefined();
    expect(session.player.getSnapshot().view.cursor).toBeNull();
    session.switchMode('correction');
    expect(session.getSnapshot()).toMatchObject({
      draft: { correction: 'custom draft' },
      program,
      phase: 'ready',
    });
    session.close();
    session.enter(active.subject.id);
    await vi.waitFor(() => expect(session.getSnapshot().phase).toBe('ready'));
    expect(session.getSnapshot()).toMatchObject({
      mode: 'independent',
      program: starterProgram(active.subject.id, active.program.bindings),
    });
    expect(session.getSnapshot().draft).toBeUndefined();
  });
  it('restores source for the first test after a full submission retained the last input', async () => {
    const { session, active } = await open(client());
    const firstSource = structuredClone(session.getSnapshot().source);
    await session.submit();
    expect(session.getSnapshot().caseKey).toBe(active.subject.tests.at(-1)!.caseKey);
    expect(session.getSnapshot().source!.text).not.toBe(firstSource!.text);
    session.switchMode('correction');
    session.switchMode('independent');
    expect(session.getSnapshot().caseKey).toBe(active.subject.tests[0].caseKey);
    expect(session.getSnapshot().source).toEqual(firstSource);
    expect(session.getSnapshot().result).toBeUndefined();
    await session.run();
    expect(session.getSnapshot().phase).toBe('ran');
    expect(session.getSnapshot().source).toEqual(firstSource);
    expect(session.getSnapshot().result!.identity.testCaseKey).toBe(
      active.subject.tests[0].caseKey,
    );
  });
  it('rebuilds a valid retained draft after switching away while input preparation is pending', async () => {
    const transport = client();
    const { session } = await open(transport);
    const firstSource = structuredClone(session.getSnapshot().source);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepare = transport.prepare;
    transport.prepare = async (...args) => {
      await held;
      return prepare(...args);
    };
    const pending = session.run();
    expect(session.getSnapshot()).toMatchObject({ phase: 'preparing' });
    expect(session.getSnapshot().source).toBeUndefined();
    session.switchMode('correction');
    session.switchMode('independent');
    expect(session.getSnapshot().source).toEqual(firstSource);
    const snapshot = session.getSnapshot();
    release();
    await pending;
    expect(session.getSnapshot()).toBe(snapshot);
    expect(session.getSnapshot().phase).toBe('ready');
  });
  it.each(['edit', 'cancel', 'mode'] as const)(
    'rejects a late real run response after %s and never saves it',
    async (action) => {
      let release!: () => void;
      let arrived!: () => void;
      const received = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const save = vi.fn();
      const { session, program } = await open(
        client(async (_request, result) => {
          arrived();
          await held;
          return result;
        }),
        { context: () => ({ catalog, epoch: 0 }), save },
      );
      const pending = session.run();
      await received;
      if (action === 'edit') session.editBlocks(program, [], { changed: true });
      else if (action === 'cancel') session.cancel();
      else session.switchMode('correction');
      const snapshot = session.getSnapshot();
      release();
      await pending;
      expect(session.getSnapshot()).toBe(snapshot);
      expect(session.getSnapshot().result).toBeUndefined();
      expect(session.getSnapshot().summaries).toEqual([]);
      expect(save).not.toHaveBeenCalled();
    },
  );
  it('authorizes one pass only after every final transport acceptance, never in provisional display', async () => {
    let finalAcceptances = 0;
    const save = vi.fn<PracticeLearningPort['save']>(async () => {
      expect(finalAcceptances).toBe(3);
      return { saved: true };
    });
    const transport = client(async (_request, result) => {
      expect(save).not.toHaveBeenCalled();
      finalAcceptances++;
      return result;
    });
    const { session } = await open(transport, { context: () => ({ catalog, epoch: 4 }), save });
    await session.submit();
    expect(session.getSnapshot()).toMatchObject({ phase: 'met', saveStatus: 'saved' });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[1]).toBe(4);
    expect(session.getSnapshot().summaries).toHaveLength(3);
  });
  it('withdraws a provisional met when the final render guard expires, without a durable pass', async () => {
    const save = vi.fn();
    const { session } = await open(
      client(async (request) => makeAdapterResult(request, 'resource-limit', 'E_DEADLINE')),
      {
        context: () => ({ catalog, epoch: 1 }),
        save,
      },
    );
    await session.submit();
    expect(session.getSnapshot().phase).toBe('unmet');
    expect(session.getSnapshot().result?.terminal.status).toBe('resource-limit');
    expect(save).not.toHaveBeenCalled();
  });
  it('retains an incomplete draft and invalidates old code, trace and submission immediately', async () => {
    const transport = client();
    const { session, program } = await open(transport);
    await session.submit();
    expect(session.getSnapshot().phase).toBe('met');
    const draft = { blocks: { languageVersion: 0, blocks: [] } };
    session.editBlocks(
      null,
      [{ code: 'BLOCK_SLOT', message: '缺少输出值', blockId: program.id }],
      draft,
    );
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      draft,
      workspaceProgram: program,
    });
    expect(session.getSnapshot().program).toBeUndefined();
    expect(session.getSnapshot().source).toBeUndefined();
    expect(session.getSnapshot().result).toBeUndefined();
    expect(session.player.getSnapshot().view.cursor).toBeNull();
    await session.submit();
    expect(session.getSnapshot().phase).toBe('ready');
    expect(transport.invalidate).toHaveBeenCalled();
  });
  it('rejects a queued real success after an edit and keeps the new block program', async () => {
    let release!: () => void;
    let arrived!: () => void;
    const received = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi.fn();
    const { session, program } = await open(
      client(async (_request, result) => {
        arrived();
        await held;
        return result;
      }),
      { context: () => ({ catalog, epoch: 1 }), save },
    );
    const pending = session.submit();
    await received;
    const changed: BlockProgram = {
      ...program,
      body: [
        ...program.body,
        {
          id: 'extra.return',
          kind: 'return',
          value: { id: 'extra.zero', kind: 'integer', value: '0' },
        },
      ],
    };
    session.editBlocks(changed, [], {});
    release();
    await pending;
    expect(session.getSnapshot().program).toEqual(changed);
    expect(session.getSnapshot().phase).toBe('ready');
    expect(session.getSnapshot().result).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps a genuine accepted result met when saving fails, separate from unavailable authorization', async () => {
    const first = await open(client(), {
      context: () => ({ catalog, epoch: 1 }),
      save: async () => {
        throw new Error('S_QUOTA');
      },
    });
    await first.session.submit();
    expect(first.session.getSnapshot()).toMatchObject({ phase: 'met', saveStatus: 'unsaved' });
    const second = await open(client());
    await second.session.submit();
    expect(second.session.getSnapshot()).toMatchObject({ phase: 'met', saveStatus: 'unavailable' });
  });
  it('shares same-exercise review state but destroys all ephemeral blocks and results on departure', async () => {
    const { session, program } = await open(client());
    await session.submit();
    session.player.step(1);
    const snapshot = session.getSnapshot();
    const cursor = session.player.getSnapshot().view.cursor;
    session.enter('exercise.c.echo', true);
    session.enter('exercise.c.echo');
    expect(session.getSnapshot()).toBe(snapshot);
    expect(session.getSnapshot().program).toBe(program);
    expect(session.player.getSnapshot().view.cursor).toBe(cursor);
    session.enter(undefined);
    expect(session.getSnapshot().program).toBeUndefined();
    expect(session.getSnapshot().draft).toBeUndefined();
    expect(session.getSnapshot().result).toBeUndefined();
    session.enter('exercise.c.echo', true);
    expect(session.getSnapshot().phase).toBe('empty');
  });
  it('maps actual Rust output and input locations to their smallest generated block ranges', async () => {
    const { session } = await open(client());
    await session.submit();
    const state = session.getSnapshot();
    const output = state.result!.nodeMap.find((node) => node.kind === 'output')!;
    const ids = blocksAtLocation(state.source, state.result!.nodeMap, {
      kind: 'source',
      nodeId: output.nodeId,
    });
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(state.program?.id);
    const mapping = state.source!.blockMap.find((map) => map.blockId === ids[0])!;
    expect(mapping.byteRange).toEqual(output.byteRange);
    expect(
      blocksAtLocation(state.source, state.result!.nodeMap, {
        kind: 'synthetic',
        reason: 'initial-state',
      }),
    ).toEqual([]);
  });
});
