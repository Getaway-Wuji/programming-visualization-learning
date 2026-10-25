import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { ContentPackage } from '../../web/src/content/types';
import { caseRequest } from '../../web/src/engine/execution-client';
import { parseChunked, precheckJson } from '../../web/src/engine/execution-json';
import { validateResultSchema } from '../../web/src/engine/execution-schema.generated';
import type { SchemaValue } from '../../web/src/engine/execution-schema.generated';
import { decodeResult, encodeRequest, ProtocolFailure } from '../../web/src/engine/protocol';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';
import { validateTraceRelationships } from '../../web/src/engine/trace-validation';
import { engineBuild } from '../../web/src/generated/engine-build';
import { execute_request, initSync, prepare_input } from '../../web/src/generated/c_viz_wasm';
import { precheckJson as beforeStringScan } from '../fixtures/execution-json-before-11.4';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let request: ExecuteRequest;
let packet: Uint8Array<ArrayBuffer>;
let rustExternalMs = 0;
function finish<T>(work: Generator<void, T, unknown>): T {
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
}
function measure<T>(work: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = work();
  return { value, ms: performance.now() - start };
}

beforeAll(() => {
  const content = JSON.parse(
    readFileSync(new URL('../../项目文档/契约/02.1-内容样例.json', import.meta.url), 'utf8'),
  ) as ContentPackage;
  const subject = content.cases.find((item) => item.id === 'case.c.bubble-sort')!;
  const program = content.programs.find((item) => item.id === subject.programRef.id)!;
  const catalog = {
    packageRef: { id: content.packageId, version: content.packageVersion },
    subject,
    program,
    inputSpec: content.inputSpecs.find((item) => item.id === program.inputRef.id)!,
  };
  const values = { values: Array.from({ length: 30 }, (_, index) => 30 - index) };
  initSync({
    module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
  });
  const prepared = JSON.parse(
    decoder.decode(
      prepare_input(JSON.stringify(catalog), encoder.encode(JSON.stringify(values)), 1000),
    ),
  ) as { source: ExecuteRequest['source'] };
  request = caseRequest(
    catalog,
    prepared.source,
    { contextId: 'performance-11.4', contextRevision: 1, sourceRevision: 1 },
    { values, random: null },
  );
  const encoded = encodeRequest(request);
  const start = performance.now();
  packet = execute_request(encoded, JSON.stringify(catalog), engineBuild.wasmSha256, 1000).slice();
  rustExternalMs = performance.now() - start;
});

test('records separate complete maximum-packet receive costs without changing acceptance budgets', async () => {
  const samples: Record<string, number>[] = [];
  let lastResult: ExecuteResult | undefined;
  for (let sample = 0; sample < 3; sample++) {
    const decode = measure(() => decoder.decode(packet));
    const text = decode.value;
    const lexicalBefore = measure(() => finish(beforeStringScan(text)));
    const lexical = measure(() => finish(precheckJson(text)));
    expect(lexical.value).toEqual(lexicalBefore.value);
    const parse = measure(() => JSON.parse(text) as SchemaValue);
    const schema = measure(() => finish(validateResultSchema(parse.value, () => {})));
    expect(schema.value).toBe(true);
    const canonical = measure(() => JSON.stringify(parse.value) === text);
    expect(canonical.value).toBe(true);
    const relationship = measure(() =>
      finish(validateTraceRelationships(parse.value as unknown as ExecuteResult, request)),
    );
    let calls = 0;
    let last = performance.now();
    let maxGuardGapMs = 0;
    const start = last;
    lastResult = await decodeResult(packet.slice().buffer, request, () => {
      const now = performance.now();
      maxGuardGapMs = Math.max(maxGuardGapMs, now - last);
      last = now;
      calls++;
    });
    samples.push({
      utf8Ms: decode.ms,
      lexicalMs: lexical.ms,
      lexicalBeforeStringScanMs: lexicalBefore.ms,
      containers: lexical.value.containers,
      parseMs: parse.ms,
      schemaMs: schema.ms,
      canonicalMs: canonical.ms,
      relationshipsMs: relationship.ms,
      completeAsyncDecodeMs: performance.now() - start,
      guardCalls: calls,
      maxGuardGapMs,
    });
  }
  expect(lastResult!.terminal.status).toBe('completed');
  expect(lastResult!.trace!.steps).toHaveLength(5330);
  expect(lastResult!.trace!.checkpoints).toHaveLength(42);
  expect(lastResult!.stats!.fuelUsed).toBeLessThanOrEqual(1_000_000);
  const directory = new URL('../../.artifacts/11.4/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  const phase = process.env.TASK_EXECUTION_PERF_PHASE ?? 'current';
  expect(phase).toMatch(/^[a-z0-9-]+$/);
  writeFileSync(
    new URL(`receive-micro-${phase}.json`, directory),
    JSON.stringify(
      {
        note: 'Isolated Node technical measurements only. Phase runs omit cooperative scheduling; complete decode retains every production check. No browser 500ms/1000ms acceptance claim.',
        buildId: engineBuild.wasmSha256,
        packetSha256: createHash('sha256').update(packet).digest('hex'),
        bytes: packet.byteLength,
        steps: lastResult!.trace!.steps.length,
        rustExternalMs,
        rustReportedMicros: lastResult!.stats!.rustMicros,
        samples,
      },
      null,
      2,
    ),
  );
});

test('retains the complete canonical integer domain and rejects ambiguous numeric spellings', () => {
  for (const number of [
    -9_007_199_254_740_991, -1_000_000_000_000_000, -999_999_999_999_999, -2_147_483_648, 0,
    2_147_483_647, 999_999_999_999_999, 1_000_000_000_000_000, 9_007_199_254_740_991,
  ]) {
    const text = JSON.stringify({ a: [number], b: number });
    expect(finish(precheckJson(text)).containers).toBe(2);
    expect(finish(parseChunked(text))).toEqual(JSON.parse(text));
  }
  for (const number of [
    '-0',
    '-00',
    '00',
    '01',
    '-01',
    '+1',
    '1.0',
    '1e0',
    '1E+1',
    '.',
    '-',
    'NaN',
    'Infinity',
    '9007199254740992',
    '-9007199254740992',
    '10000000000000000',
    '-10000000000000000',
    '9'.repeat(100_000),
  ])
    for (const text of [number, `{"a":${number}}`, `[${number}]`])
      expect(() => finish(precheckJson(text))).toThrow(ProtocolFailure);
});

test('keeps Unicode, canonical escapes, duplicate keys and bounded containers independently checked', () => {
  const text = JSON.stringify({
    a: ['中😀', '\u0000\u0001\u001f\b\t\n\f\r"\\/', '\u2028\u2029'],
    b: { a: -9_007_199_254_740_991, b: 9_007_199_254_740_991 },
  });
  expect(() => finish(precheckJson(text))).not.toThrow();
  expect(finish(parseChunked(text))).toEqual(JSON.parse(text));
  for (const invalid of [
    '{"a":0,"a":1}',
    '{"b":0,"a":1}',
    '{"é":1}',
    ' {"a":1}',
    '\ufeff{"a":1}',
    '{"a":1}\n',
    '"\\/"',
    '"\\u0061"',
    '"\\u000a"',
    '"\\u001F"',
    '"\\ud800"',
    '"\ud800"',
    '"\udc00"',
    '"\n"',
    '['.repeat(33) + '0' + ']'.repeat(33),
    '[0,]',
    '{"a":0,}',
  ])
    expect(() => finish(precheckJson(invalid))).toThrow(ProtocolFailure);
  expect(() => finish(precheckJson('['.repeat(32) + '0' + ']'.repeat(32)))).not.toThrow();
});

test('cancellation still interrupts complete real maximum-packet validation before acceptance', async () => {
  let calls = 0;
  let scheduled = false;
  let cancelled = false;
  let cancelledAt = 0;
  const done = decodeResult(packet.slice().buffer, request, () => {
    if (cancelled) throw new Error('owner-stopped-11.4');
    if (++calls === 2000) {
      scheduled = true;
      setTimeout(() => {
        cancelled = true;
        cancelledAt = performance.now();
      }, 0);
    }
  });
  await expect(done).rejects.toThrow('owner-stopped-11.4');
  expect(scheduled && cancelled).toBe(true);
  expect(performance.now() - cancelledAt).toBeLessThan(100);
});
