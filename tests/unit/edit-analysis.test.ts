import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as wasm from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import { AnalysisClient } from '../../web/src/engine/analysis-client';
import {
  decodeAnalysisResult,
  encodeAnalysisRequest,
} from '../../web/src/engine/analysis-protocol';
import type { ExecutionCatalog, PreparedSource } from '../../web/src/engine/execution-client';
import type {
  AnalysisRequest,
  AnalysisResult,
  ValidAnalysisResult,
} from '../../web/src/blocks/analysis-types';
import {
  exerciseCatalog,
  type CoursePractice,
  type ExerciseCatalog,
} from '../../web/src/content/practice';
import { correctBlockProgram } from '../../web/src/blocks/starters';
import { generateBlockSource } from '../../web/src/blocks/generator';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const content = JSON.parse(
  readFileSync('web/public/content/practice/course-practice-1.0.0.json', 'utf8'),
) as CoursePractice;
const fixtures = JSON.parse(readFileSync('项目文档/契约/13.1-结构与状态样例.json', 'utf8')) as {
  schemaCases: { id: string; body: unknown }[];
};
const fixtureRequest = fixtures.schemaCases.find((item) => item.id === 'analysisRequest')!
  .body as AnalysisRequest;
const fixtureValid = fixtures.schemaCases.find((item) => item.id === 'validResult')!
  .body as ValidAnalysisResult;
const fixtureInvalid = fixtures.schemaCases.find((item) => item.id === 'invalidResult')!
  .body as AnalysisResult;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};
const bytes = (value: unknown) => encoder.encode(canonical(value)).buffer;
const directAnalyze = (
  wasm as unknown as {
    analyze_code_draft?: (request: string, catalog: string, remaining: number) => Uint8Array;
  }
).analyze_code_draft;
function request(
  catalog: ExecutionCatalog,
  sourceText: string,
  values = catalog.program.exampleInput,
): AnalysisRequest {
  return {
    kind: 'analysisRequest',
    analysisVersion: '1.0.0',
    identity: {
      contextId: 'analysis.unit.context',
      contextRevision: 1,
      documentRevision: 1,
      editId: 'analysis.unit.edit',
      operationId: crypto.randomUUID(),
    },
    refs: {
      packageRef: catalog.packageRef,
      programRef: { id: catalog.program.id, version: catalog.program.version },
      subsetRef: catalog.program.subsetRef,
    },
    sourceText,
    input: { specRef: catalog.program.inputRef, values, random: null },
  };
}
function prepared(
  catalog: ExerciseCatalog,
  input = catalog.subject.tests[0].input,
): PreparedSource {
  const result = JSON.parse(
    decoder.decode(
      wasm.prepare_input(JSON.stringify(catalog), encoder.encode(canonical(input)), 1000),
    ),
  ) as { source: PreparedSource };
  return generateBlockSource(
    correctBlockProgram(catalog.subject.id, catalog.program.bindings),
    result.source,
    catalog.program.bindings,
  );
}
async function analyze(
  catalog: ExerciseCatalog,
  sourceText: string,
  input = catalog.subject.tests[0].input,
) {
  const req = request(catalog, sourceText, input);
  const encoded = encodeAnalysisRequest(req, catalog);
  const resultBytes = directAnalyze!(
    decoder.decode(encoded),
    JSON.stringify(catalog),
    1000,
  ).slice();
  return {
    request: req,
    result: await decodeAnalysisResult(resultBytes.buffer, req, catalog),
    resultBytes,
  };
}

describe('AST-MAP actual Rust/WASM producer and strict consumer', () => {
  beforeAll(() => {
    wasm.initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') });
    expect(typeof directAnalyze, 'Build the new engine before this acceptance suite.').toBe(
      'function',
    );
  });
  it.each(content.exercises.map((exercise) => exercise.id))(
    'analyzes all published inputs of %s without execution fields',
    async (id) => {
      const catalog = exerciseCatalog(content, id);
      for (const test of catalog.subject.tests) {
        const source = prepared(catalog, test.input);
        const { result } = await analyze(catalog, source.text, test.input);
        expect(result).toMatchObject({ kind: 'analysisResult', status: 'valid', diagnostics: [] });
        if (result.kind !== 'analysisResult' || result.status !== 'valid')
          throw new Error('Expected checked AST');
        expect(result.bindingMap).toEqual(source.bindingMap);
        expect(result).not.toHaveProperty('trace');
        expect(result).not.toHaveProperty('judgeResult');
        expect(result).not.toHaveProperty('provenance');
        expect(result.checkedAst.nodes.some((node) => node.kind === 'name')).toBe(true);
      }
    },
  );
  it('keeps Unicode/CRLF comments apart from comment-like string text', async () => {
    const catalog = exerciseCatalog(content, 'exercise.c.echo');
    const source = prepared(catalog)
      .text.replaceAll('\n', '\r\n')
      .replace('int main', '/* 中文😀 */\r\nint main');
    const result = (await analyze(catalog, source)).result;
    expect(result).toMatchObject({ kind: 'analysisResult', status: 'valid' });
    if (result.kind !== 'analysisResult' || result.status !== 'valid')
      throw new Error('Expected checked AST');
    const text = encoder.encode(source);
    const comments = result.trivia
      .filter((item) => item.kind !== 'whitespace')
      .map((item) => decoder.decode(text.slice(item.byteRange.start, item.byteRange.end)));
    expect(comments).toEqual(['/* 中文😀 */']);
  });
  it('accepts syntax nesting beyond 32 while the AST wire format remains flat', async () => {
    const catalog = exerciseCatalog(content, 'exercise.c.echo');
    const source = prepared(catalog).text.replace(
      'return 0;',
      `return ${'('.repeat(40)}0${')'.repeat(40)};`,
    );
    expect((await analyze(catalog, source)).result).toMatchObject({
      kind: 'analysisResult',
      status: 'valid',
    });
  });
  it('returns static diagnostics and no old AST for a temporary invalid draft', async () => {
    const catalog = exerciseCatalog(content, 'exercise.c.echo');
    const result = (await analyze(catalog, 'int main(){')).result;
    expect(result).toMatchObject({ kind: 'analysisResult', status: 'invalid' });
    expect(result).not.toHaveProperty('checkedAst');
    expect(result).not.toHaveProperty('blockMap');
  });
  it('rejects input shadow rebinding but accepts an unused same-name declaration', async () => {
    const catalog = exerciseCatalog(content, 'exercise.c.echo');
    const base = prepared(catalog).text;
    const location = base.lastIndexOf('return 0;');
    const shadow = `${base.slice(0, location)}{ int x = 9; printf("%d", x); }\n${base.slice(location)}`;
    expect((await analyze(catalog, shadow)).result).toMatchObject({
      kind: 'analysisResult',
      status: 'invalid',
      diagnostics: [{ code: 'E_BINDING_INVALID' }],
    });
    const unused = `${base.slice(0, location)}{ int x = 9; }\n${base.slice(location)}`;
    expect((await analyze(catalog, unused)).result).toMatchObject({
      kind: 'analysisResult',
      status: 'valid',
    });
  });
  it('returns budget failure rather than C invalid when the source crosses its byte limit', async () => {
    const catalog = exerciseCatalog(content, 'exercise.c.echo');
    const req = request(catalog, ' '.repeat(32769), catalog.subject.tests[0].input);
    expect(() => encodeAnalysisRequest(req, catalog)).toThrow();
    const raw = directAnalyze!(canonical(req), JSON.stringify(catalog), 1000).slice();
    const result = await decodeAnalysisResult(raw.buffer, req, catalog);
    expect(result).toMatchObject({ kind: 'analysisFailure', error: { code: 'budget' } });
  });
});

describe('strict analysis shapes, identity and AST relationships (synthetic negative packets)', () => {
  it('accepts the frozen design analysis shape without requiring a Blockly canvas', async () => {
    expect(await decodeAnalysisResult(bytes(fixtureValid), fixtureRequest)).toEqual(fixtureValid);
  });
  it.each(['contextId', 'contextRevision', 'documentRevision', 'editId', 'operationId'] as const)(
    'rejects stale %s',
    async (key) => {
      const result = structuredClone(fixtureValid);
      if (typeof result.identity[key] === 'number') Reflect.set(result.identity, key, 2);
      else Reflect.set(result.identity, key, 'old');
      await expect(decodeAnalysisResult(bytes(result), fixtureRequest)).rejects.toThrow();
    },
  );
  it.each([
    'unknown-field',
    'unknown-version',
    'parent',
    'dangling-child',
    'node-map',
    'unknown-candidate',
    'missing-main-candidate',
    'candidate-range',
    'binding-map',
    'trivia-range',
  ] as const)('rejects %s corruption', async (mutation) => {
    const result = structuredClone(fixtureValid);
    if (mutation === 'unknown-field') Reflect.set(result, 'rawCode', 'return 0;');
    if (mutation === 'unknown-version') Reflect.set(result, 'analysisVersion', '2.0.0');
    if (mutation === 'parent') result.checkedAst.nodes[1].parentId = null;
    if (mutation === 'dangling-child') Reflect.set(result.checkedAst.nodes[0], 'body', 'n9');
    if (mutation === 'node-map') result.nodeMap[0].byteRange.end--;
    if (mutation === 'unknown-candidate') result.blockMap[0].blockId = 'invented-id';
    if (mutation === 'missing-main-candidate') result.blockMap = [];
    if (mutation === 'candidate-range') result.blockMap[0].byteRange.end--;
    if (mutation === 'binding-map')
      result.bindingMap.push({ bindingKey: 'fake', byteRange: { start: 0, end: 12 } });
    if (mutation === 'trivia-range') result.trivia[0].byteRange.end = 99;
    await expect(decodeAnalysisResult(bytes(result), fixtureRequest)).rejects.toThrow();
  });
  it('rejects a budget diagnostic disguised as C invalid', async () => {
    const result = structuredClone(fixtureInvalid);
    if (result.kind !== 'analysisResult' || result.status !== 'invalid')
      throw new Error('Expected invalid fixture');
    result.diagnostics[0].code = 'E_FUEL_LIMIT';
    await expect(decodeAnalysisResult(bytes(result), fixtureRequest)).rejects.toThrow();
  });
  it('uses UTF-8 boundaries rather than UTF-16 positions for all source-backed ranges', async () => {
    const req = { ...structuredClone(fixtureRequest), sourceText: 'int main(){/*😀*/}' };
    const result = structuredClone(fixtureValid);
    const end = encoder.encode(req.sourceText).length;
    result.checkedAst.nodes[0].byteRange.end = end;
    result.checkedAst.nodes[1].byteRange.end = end;
    result.nodeMap[0].byteRange.end = end;
    result.nodeMap[1].byteRange.end = end;
    result.blockMap[0].byteRange.end = end;
    result.trivia = [{ kind: 'block-comment', byteRange: { start: 11, end: 19 } }];
    expect(await decodeAnalysisResult(bytes(result), req)).toEqual(result);
    // This lies in the middle of the four-byte emoji. Matching nodeMap does
    // not make it a source boundary.
    result.checkedAst.nodes[1].byteRange.end = 15;
    result.nodeMap[1].byteRange.end = 15;
    await expect(decodeAnalysisResult(bytes(result), req)).rejects.toThrow();
  });
  it('rejects partial AST data on invalid results, duplicate JSON keys, bad UTF-8 and oversized buffers', async () => {
    const invalid = structuredClone(fixtureInvalid);
    Reflect.set(invalid, 'checkedAst', fixtureValid.checkedAst);
    await expect(decodeAnalysisResult(bytes(invalid), fixtureRequest)).rejects.toThrow();
    await expect(
      decodeAnalysisResult(
        encoder.encode('{"analysisVersion":"1.0.0","analysisVersion":"1.0.0"}').buffer,
        fixtureRequest,
      ),
    ).rejects.toThrow();
    await expect(
      decodeAnalysisResult(Uint8Array.of(0xff).buffer, fixtureRequest),
    ).rejects.toThrow();
    await expect(decodeAnalysisResult(new ArrayBuffer(16777217), fixtureRequest)).rejects.toThrow();
  });
  it('calls the deadline guard during validation instead of trusting an on-time envelope', async () => {
    let calls = 0;
    await expect(
      decodeAnalysisResult(bytes(fixtureValid), fixtureRequest, undefined, () => {
        if (++calls > 5) throw new Error('E_DEADLINE');
      }),
    ).rejects.toThrow('E_DEADLINE');
  });
});

class WorkerStub {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  onmessageerror: Worker['onmessageerror'] = null;
  message?: {
    operationId: string;
    buffer: ArrayBuffer;
    remainingMs: number;
    kind: string;
    exerciseId: string;
  };
  terminate = vi.fn();
  postMessage = vi.fn((message) => {
    this.message = message;
  });
  reply(data: Record<string, unknown>, handler = this.onmessage) {
    handler?.call(this as unknown as Worker, new MessageEvent('message', { data }));
  }
}
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
const clients: AnalysisClient[] = [];
function setup() {
  const workers: WorkerStub[] = [];
  const catalog = exerciseCatalog(content, 'exercise.c.echo');
  const req = request(catalog, 'int main(){}', catalog.subject.tests[0].input);
  const now = vi.fn(() => 0);
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(new Uint8Array(engineBuild.wasmBytes), {
        headers: { 'content-type': 'application/wasm' },
      }),
  );
  const digest = vi.fn(
    async () =>
      Uint8Array.from(engineBuild.wasmSha256.match(/../g)!, (pair) => parseInt(pair, 16)).buffer,
  );
  const module = new WebAssembly.Module(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
  const compile = vi.fn(async () => module);
  const decode = vi.fn(
    async (
      _buffer: ArrayBuffer,
      selected: AnalysisRequest,
      _catalog?: ExecutionCatalog,
      guard?: () => void,
    ): Promise<AnalysisResult> => {
      guard?.();
      return {
        kind: 'analysisFailure',
        analysisVersion: '1.0.0',
        identity: selected.identity,
        refs: selected.refs,
        error: { code: 'response' },
      };
    },
  );
  const client = new AnalysisClient({
    now,
    fetcher,
    digest,
    compile,
    decode,
    createWorker: () => {
      const worker = new WorkerStub();
      workers.push(worker);
      return worker as unknown as Worker;
    },
  });
  clients.push(client);
  return { client, catalog, req, now, fetcher, digest, compile, decode, workers, module };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBe(true);
}
describe('analysis lifecycle and resource boundary (explicit Worker transport model)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const client of clients.splice(0)) client.cancel();
    vi.useRealTimers();
  });
  it.each(['fetch', 'digest', 'compile'] as const)(
    'cancels during %s and ignores late completion',
    async (phase) => {
      const h = setup();
      const download = pending<Response>(),
        hash = pending<ArrayBuffer>(),
        compiled = pending<WebAssembly.Module>();
      if (phase === 'fetch') h.fetcher.mockReturnValue(download.promise);
      if (phase === 'digest') h.digest.mockReturnValue(hash.promise);
      if (phase === 'compile') h.compile.mockReturnValue(compiled.promise);
      const result = h.client.analyze(h.catalog, h.req);
      await until(() =>
        phase === 'fetch'
          ? h.fetcher.mock.calls.length > 0
          : phase === 'digest'
            ? h.digest.mock.calls.length > 0
            : h.compile.mock.calls.length > 0,
      );
      h.client.cancel();
      download.resolve(
        new Response(new Uint8Array(engineBuild.wasmBytes), {
          headers: { 'content-type': 'application/wasm' },
        }),
      );
      hash.resolve(
        Uint8Array.from(engineBuild.wasmSha256.match(/../g)!, (pair) => parseInt(pair, 16)).buffer,
      );
      compiled.resolve(h.module);
      expect(await result).toMatchObject({ kind: 'analysisFailure', error: { code: 'cancelled' } });
      for (let i = 0; i < 200; i++) await Promise.resolve();
      expect(h.workers).toHaveLength(0);
      expect(h.client.inspect()).toMatchObject({ active: false, cachedModules: 0 });
    },
  );
  it('expires an unresolved load within the inherited full-submission deadline', async () => {
    const h = setup();
    h.now.mockReturnValue(950);
    h.fetcher.mockReturnValue(pending<Response>().promise);
    const result = h.client.analyze(h.catalog, h.req, { started: 0 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toMatchObject({ kind: 'analysisFailure', error: { code: 'budget' } });
    expect(h.workers).toHaveLength(0);
  });
  it('keeps cancellation separate from invalid C and ignores an already queued old Worker callback', async () => {
    const h = setup();
    const old = h.client.analyze(h.catalog, h.req);
    await until(() => h.workers.length === 1);
    const worker = h.workers[0],
      handler = worker.onmessage;
    const current = h.client.analyze(h.catalog, {
      ...h.req,
      identity: { ...h.req.identity, operationId: 'new.operation' },
    });
    expect(await old).toMatchObject({ kind: 'analysisFailure', error: { code: 'cancelled' } });
    worker.reply(
      { ok: true, operationId: worker.message!.operationId, buffer: new ArrayBuffer(1) },
      handler,
    );
    await until(() => h.workers.length === 2);
    h.workers[1].reply({
      ok: true,
      operationId: h.workers[1].message!.operationId,
      buffer: new ArrayBuffer(1),
    });
    await current;
    expect(h.decode).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('passes only a trusted exercise selector to the Worker, never caller catalog or answer fields', async () => {
    const h = setup();
    const result = h.client.analyze(h.catalog, h.req);
    await until(() => h.workers.length === 1);
    expect(Object.keys(h.workers[0].message!).sort()).toEqual([
      'buffer',
      'exerciseId',
      'kind',
      'module',
      'operationId',
      'remainingMs',
    ]);
    expect(h.workers[0].message).toMatchObject({
      kind: 'analyze-code',
      exerciseId: h.catalog.subject.id,
      remainingMs: 1000,
    });
    h.client.cancel();
    await result;
  });
  it.each([
    'E_MODULE_LOAD',
    'E_WORKER_FAILURE',
    'E_DEADLINE',
    'E_PROTOCOL_VERSION',
    'E_PROTOCOL_INVALID',
  ] as const)('classifies %s as infrastructure state', async (code) => {
    const h = setup();
    const result = h.client.analyze(h.catalog, h.req);
    await until(() => h.workers.length === 1);
    h.workers[0].reply({ ok: false, operationId: h.workers[0].message!.operationId, code });
    const errorCode = {
      E_MODULE_LOAD: 'module',
      E_WORKER_FAILURE: 'transport',
      E_DEADLINE: 'budget',
      E_PROTOCOL_VERSION: 'version',
      E_PROTOCOL_INVALID: 'response',
    }[code];
    expect(await result).toMatchObject({ kind: 'analysisFailure', error: { code: errorCode } });
    expect(h.client.inspect().active).toBe(false);
  });
  it('honors an AbortSignal and rejects unknown packet fields before decoding', async () => {
    const h = setup();
    const signal = new AbortController();
    const aborted = h.client.analyze(h.catalog, h.req, { signal: signal.signal });
    await until(() => h.workers.length === 1);
    signal.abort();
    expect(await aborted).toMatchObject({ kind: 'analysisFailure', error: { code: 'cancelled' } });
    const bad = h.client.analyze(h.catalog, h.req);
    await until(() => h.workers.length === 2);
    h.workers[1].reply({
      ok: true,
      operationId: h.workers[1].message!.operationId,
      buffer: new ArrayBuffer(1),
      catalogJson: 'untrusted',
    });
    expect(await bad).toMatchObject({ kind: 'analysisFailure', error: { code: 'response' } });
    expect(h.decode).not.toHaveBeenCalled();
  });
  it('checks deadline again after decode rather than accepting a late validated result', async () => {
    const h = setup();
    h.decode.mockImplementationOnce(async (_bytes, req) => {
      h.now.mockReturnValue(1000);
      return {
        kind: 'analysisFailure',
        analysisVersion: '1.0.0',
        identity: req.identity,
        refs: req.refs,
        error: { code: 'response' },
      };
    });
    const result = h.client.analyze(h.catalog, h.req);
    await until(() => h.workers.length === 1);
    h.workers[0].reply({
      ok: true,
      operationId: h.workers[0].message!.operationId,
      buffer: new ArrayBuffer(1),
    });
    expect(await result).toMatchObject({ kind: 'analysisFailure', error: { code: 'budget' } });
  });
});
