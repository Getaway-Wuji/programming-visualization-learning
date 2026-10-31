import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  caseExecutionCatalog,
  caseLearningCatalog,
  caseViewRelease,
} from '../../web/src/content/case-learning';
import type { ContentPackage, InputValues } from '../../web/src/content/types';
import { caseRequest } from '../../web/src/engine/execution-client';
import { decodeResult, encodeRequest } from '../../web/src/engine/protocol';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';
import { engineBuild } from '../../web/src/generated/engine-build';
import { execute_request, initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { assertCaseViewFact, createCaseViewSession } from '../../web/src/learning/case-authority';
import { readVerifiedFact } from '../../web/src/learning/authority';
import type { VerifiedFact } from '../../web/src/learning/authority';
import { PlayerModel } from '../../web/src/player/model';
import { keyStepCursors } from '../../web/src/player/key-steps';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const runs = new Map<string, Promise<{ request: ExecuteRequest; result: ExecuteResult }>>();
function run(id = 'case.c.assignment', selected?: InputValues) {
  const catalog = caseExecutionCatalog(id)!;
  const input = selected ?? catalog.program.exampleInput;
  const key = `${id}:${canonical(input)}`;
  if (!runs.has(key)) {
    runs.set(
      key,
      (async () => {
        const prepared = JSON.parse(
          decoder.decode(
            prepare_input(JSON.stringify(catalog), encoder.encode(canonical(input)), 1000),
          ),
        ) as { source: ExecuteRequest['source'] };
        const request = caseRequest(
          catalog,
          prepared.source,
          {
            contextId: `case-view-${id}`,
            contextRevision: 1,
            sourceRevision: 1,
          },
          { values: input, random: null },
        );
        const bytes = execute_request(
          encodeRequest(request),
          JSON.stringify(catalog),
          engineBuild.wasmSha256,
          1000,
        ).slice();
        return { request, result: await decodeResult(bytes.buffer, request) };
      })(),
    );
  }
  return runs.get(key)!;
}
function player(result: ExecuteResult) {
  const model = new PlayerModel();
  expect(model.acceptValidated(model.begin(result.identity), result)).toBe(true);
  return model;
}
function session(
  request: ExecuteRequest,
  result: ExecuteResult,
  current: () => boolean = () => true,
) {
  return createCaseViewSession(
    caseExecutionCatalog(request.subjectRef!.id)!,
    request,
    result,
    current,
  );
}

describe('11.1 reviewed case authorization, observed results and rendered coverage', () => {
  beforeAll(() =>
    initSync({
      module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
    }),
  );

  it('credits only sequentially rendered key stops; jumping to the tail and stale runs cannot confirm', async () => {
    const { request, result } = await run('case.c.bubble-sort', { values: [3, 2, 1] });
    let current = true;
    const viewed = createCaseViewSession(
      caseExecutionCatalog(request.subjectRef!.id)!,
      request,
      result,
      () => current,
      true,
    );
    const model = player(result),
      stops = keyStepCursors(result);
    expect(stops.length).toBeLessThan(result.trace!.steps.length);
    viewed.present(model.snapshot(), 'key');
    model.seek(result.trace!.steps.length);
    viewed.present(model.snapshot(), 'key');
    expect(viewed.progress('key').seen).toBe(0);
    expect(() => viewed.issue()).toThrow();
    for (const cursor of stops) {
      model.seek(cursor);
      viewed.present(model.snapshot(), 'key');
    }
    expect(viewed.progress('key')).toEqual({
      seen: stops.length - 1,
      total: stops.length - 1,
      complete: true,
    });
    const fact = viewed.issue();
    expect(viewed.issue()).toBe(fact);
    current = false;
    expect(() => viewed.issue()).toThrow();
  });

  it('full-step playback can complete the same key coverage without crediting hidden states', async () => {
    const { request, result } = await run();
    const viewed = createCaseViewSession(
      caseExecutionCatalog(request.subjectRef!.id)!,
      request,
      result,
      () => true,
      true,
    );
    const model = player(result);
    for (let cursor = 0; cursor <= result.trace!.steps.length; cursor++) {
      model.seek(cursor);
      viewed.present(model.snapshot(), 'all');
    }
    expect(viewed.progress('key').complete).toBe(true);
    expect(viewed.progress('key').total).toBe(keyStepCursors(result).length - 1);
  });

  it('bundles exactly seven reviewed case/program/input projections with only case-view authority', () => {
    const source = JSON.parse(
      readFileSync(new URL('../../content/c/p0/course-1.0.1.json', import.meta.url), 'utf8'),
    ) as ContentPackage;
    expect(caseViewRelease.capabilities).toEqual(['case.view-confirmed']);
    expect(caseViewRelease.catalogs).toHaveLength(7);
    for (const catalog of caseViewRelease.catalogs) {
      const sorting = ['case.c.bubble-sort', 'case.c.selection-sort'].includes(catalog.subject.id);
      expect(catalog.packageRef).toEqual({ id: 'content.c.p0', version: '1.0.2' });
      if (sorting) {
        expect(catalog.subject.version).toBe('1.0.2');
        expect(catalog.subject.acceptedPriorVersions).toEqual(['1.0.1']);
        expect(catalog.subject.learningRevision).toBe(1);
        expect(catalog.program.version).toBe('1.0.1');
        expect(catalog.program.exampleInput).toEqual({ values: [7, -3, 0, 5, -3, 2, 9] });
        expect(catalog.program.sourceExample).toContain('int n = 7;');
        expect(catalog.program.sourceExample).toContain('int values[7] = {7, -3, 0, 5, -3, 2, 9};');
      } else {
        expect(catalog.subject).toEqual(
          source.cases.find((entry) => entry.id === catalog.subject.id),
        );
        expect(catalog.program).toEqual(
          source.programs.find((entry) => entry.id === catalog.program.id),
        );
      }
      expect(catalog.inputSpec).toEqual(
        source.inputSpecs.find((entry) => entry.id === catalog.inputSpec.id),
      );
      expect(Object.isFrozen(catalog.program)).toBe(true);
    }
    expect(caseLearningCatalog().purpose).toBe('case-view');
    expect(caseLearningCatalog().lessons).toEqual([]);
    expect(caseLearningCatalog().exercises).toEqual([]);
    expect(caseLearningCatalog().cases).toHaveLength(7);
    expect(caseExecutionCatalog('case.unknown')).toBeNull();
  });

  it.each(caseViewRelease.catalogs.map((entry) => entry.subject.id))(
    'accepts the real Rust result and every rendered state for %s',
    async (id) => {
      const { request, result } = await run(id);
      const viewed = session(request, result);
      const model = player(result);
      expect(viewed.progress().complete).toBe(false);
      expect(() => viewed.issue()).toThrow('S_CONTENT_INCOMPATIBLE');
      for (let cursor = 0; cursor <= result.trace!.steps.length; cursor++) {
        model.seek(cursor);
        viewed.present(model.snapshot());
      }
      expect(viewed.progress()).toEqual({
        seen: result.trace!.steps.length,
        total: result.trace!.steps.length,
        complete: true,
      });
      const fact = viewed.issue();
      expect(viewed.issue()).toBe(fact);
      expect(() => assertCaseViewFact(fact)).not.toThrow();
      expect(readVerifiedFact(fact).event).toEqual({
        eventContractVersion: '1.0.0',
        eventType: 'case.view-confirmed',
        result: 'confirmed',
        packageRef: request.packageRef,
        subjectRef: request.subjectRef,
        learningRevision: request.learningRevision,
      });
    },
  );

  it.each([
    ['case.c.assignment', { x: -999 }],
    ['case.c.assignment', { x: 999 }],
    ['case.c.branch', { x: 0 }],
    ['case.c.loops', { n: 0 }],
    ['case.c.loops', { n: 30 }],
    ['case.c.array-traversal', { values: [] }],
    ['case.c.array-traversal', { values: [-999, 0, 999] }],
    ['case.c.bubble-sort', { values: [] }],
    ['case.c.bubble-sort', { values: [999, -999, 999, 0] }],
    ['case.c.selection-sort', { values: [] }],
    ['case.c.selection-sort', { values: [0, 0] }],
    ['case.c.binary-search-first', { values: [], target: 0 }],
    ['case.c.binary-search-first', { values: [-999, 0, 0, 999], target: 0 }],
    ['case.c.binary-search-first', { values: [-999, 0, 999], target: -998 }],
  ] satisfies [string, InputValues][])(
    'checks real Rust template instantiation and boundary result for %s with %j',
    async (id, input) => {
      const { request, result } = await run(id, input);
      expect(() => session(request, result)).not.toThrow();
    },
  );

  it('jumping to the tail does not fill gaps; backward, pause and replay preserve seen edges', async () => {
    const { request, result } = await run();
    const viewed = session(request, result);
    const model = player(result);
    viewed.present(model.snapshot());
    model.seek(result.trace!.steps.length);
    viewed.present(model.snapshot());
    expect(viewed.progress().seen).toBe(0);
    expect(() => viewed.issue()).toThrow('S_CONTENT_INCOMPATIBLE');
    model.seek(0);
    viewed.present(model.snapshot());
    model.seek(1);
    viewed.present(model.snapshot());
    viewed.present(model.snapshot());
    model.seek(0);
    viewed.present(model.snapshot());
    expect(viewed.progress().seen).toBe(1);
    for (let cursor = 1; cursor <= result.trace!.steps.length; cursor++) {
      model.seek(cursor);
      viewed.present(model.snapshot());
    }
    expect(viewed.progress().complete).toBe(true);
    model.seek(0);
    viewed.present(model.snapshot());
    expect(viewed.progress().complete).toBe(true);
  });

  it('requires initial presentation and ignores other run identities and missing states', async () => {
    const { request, result } = await run();
    const viewed = session(request, result);
    const model = player(result);
    for (let cursor = 1; cursor <= result.trace!.steps.length; cursor++) {
      model.seek(cursor);
      viewed.present(model.snapshot());
    }
    expect(viewed.progress().seen).toBe(0);
    model.seek(0);
    const wrongRun = model.snapshot();
    wrongRun.identity!.runId = 'another-run';
    viewed.present(wrongRun);
    const missing = model.snapshot();
    missing.state = null;
    viewed.present(missing);
    model.seek(1);
    viewed.present(model.snapshot());
    expect(viewed.progress().seen).toBe(0);
  });

  it('invalidates coverage/confirmation with the current run and never accepts a foreign token', async () => {
    const { request, result } = await run();
    let current = true;
    const viewed = session(request, result, () => current);
    const model = player(result);
    for (let cursor = 0; cursor <= result.trace!.steps.length; cursor++) {
      model.seek(cursor);
      viewed.present(model.snapshot());
    }
    current = false;
    expect(viewed.progress().complete).toBe(false);
    expect(() => viewed.issue()).toThrow('S_CONTENT_INCOMPATIBLE');
    expect(() => session(request, result, () => false)).toThrow('S_CONTENT_INCOMPATIBLE');
    expect(() => assertCaseViewFact(Object.freeze({}) as VerifiedFact)).toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
  });

  it('rejects failure/prefix, stale identity, altered public catalog, edited template and illegal input', async () => {
    const { request, result } = await run();
    for (const mutate of [
      (value: ExecuteResult) => (value.terminal.status = 'program-error'),
      (value: ExecuteResult) => (value.terminal.exitCode = 1),
      (value: ExecuteResult) => (value.trace!.completeness = 'prefix'),
      (value: ExecuteResult) => (value.identity.runId = 'stale'),
      (value: ExecuteResult) => (value.producer = 'adapter'),
    ]) {
      const changed = structuredClone(result);
      mutate(changed);
      expect(() => session(request, changed)).toThrow('S_CONTENT_INCOMPATIBLE');
    }
    const edited = structuredClone(request);
    edited.source.text = edited.source.text.replace('x = x + 2;', 'x = x + 3;');
    expect(() => session(edited, result)).toThrow('S_CONTENT_INCOMPATIBLE');
    const invalidInput = structuredClone(request);
    invalidInput.input.values = { x: 1000000 };
    expect(() => session(invalidInput, result)).toThrow('S_CONTENT_INCOMPATIBLE');
    const changedCatalog = structuredClone(caseExecutionCatalog(request.subjectRef!.id)!);
    Object.assign(changedCatalog.subject, { title: 'unreviewed' });
    expect(() => createCaseViewSession(changedCatalog, request, result, () => true)).toThrow(
      'S_CONTENT_INCOMPATIBLE',
    );
  });

  it.each(['case.c.assignment', 'case.c.bubble-sort', 'case.c.binary-search-first'])(
    'rejects output inconsistent with the declared result rule for %s',
    async (id) => {
      const { request, result } = await run(id);
      const altered = structuredClone(result);
      const output = altered
        .trace!.steps.flatMap((step) => step.changes)
        .find((change) => change.op === 'output')!;
      if (output.op === 'output') output.append = '999\n';
      expect(() => session(request, altered)).toThrow('S_CONTENT_INCOMPATIBLE');
    },
  );

  it('requires actual presentation for the zero-step boundary (synthetic boundary model only)', async () => {
    const { request, result } = await run();
    const boundary = structuredClone(result);
    boundary.trace!.steps = [];
    boundary.trace!.initialState.output = `${(request.input.values.x as number) + 2}\n`;
    boundary.trace!.checkpoints = [
      { cursor: 0, state: structuredClone(boundary.trace!.initialState) },
    ];
    boundary.terminal.cursor = 0;
    const viewed = session(request, boundary);
    expect(viewed.progress()).toEqual({ seen: 0, total: 0, complete: false });
    const model = player(boundary);
    viewed.present(model.snapshot());
    expect(viewed.progress()).toEqual({ seen: 0, total: 0, complete: true });
  });
});
