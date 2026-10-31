import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  decodeResult,
  encodeRequest,
  makeAdapterResult,
  ProtocolFailure,
} from '../../web/src/engine/protocol';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';
import { precheckJson, parseChunked } from '../../web/src/engine/execution-json';

interface Fixture {
  id: string;
  request: ExecuteRequest;
  result: ExecuteResult;
}
const fixtures = ['02.2-正常轨迹样例.json', '02.2-失败与超限轨迹样例.json'].flatMap(
  (name) =>
    (
      JSON.parse(readFileSync(new URL(`../../项目文档/契约/${name}`, import.meta.url), 'utf8')) as {
        fixtures: Fixture[];
      }
    ).fixtures,
);
// These authored fixtures test the wire boundary and reversible projections.
// Changing the producer here deliberately does NOT prove real Rust execution.
function pair(id = 'fixture.trace.scope-array') {
  const fixture = structuredClone(fixtures.find((fixture) => fixture.id === id)!);
  if ((fixture.result.producer as string) === 'fixture') {
    if (
      fixture.result.trace ||
      ['completed', 'program-error'].includes(fixture.result.terminal.status)
    ) {
      fixture.result.producer = 'rust';
      let peak = 0;
      for (const step of fixture.result.trace?.steps ?? [])
        for (const change of step.changes)
          if (change.op === 'allocator') peak = Math.max(peak, change.after.liveBytes);
      fixture.result.stats = {
        fuelUsed: 1,
        peakVirtualBytes: peak,
        maxSyntaxDepth: 1,
        maxAstDepth: 1,
        rustMicros: 0,
      };
    } else fixture.result.producer = 'adapter';
  }
  return fixture;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}
const wire = (value: unknown) => new TextEncoder().encode(canonical(value)).buffer;
const raw = (text: string) => new TextEncoder().encode(text).buffer;
function request() {
  return pair().request;
}

describe('EXEC canonical bounded browser protocol (authored protocol data only)', () => {
  it('strict lexical proof preserves exact canonical bytes in native and chunked parsing', () => {
    const finish = <T>(work: Generator<void, T, unknown>) => {
      let next = work.next();
      while (!next.done) next = work.next();
      return next.value;
    };
    const scalars = [
      null,
      true,
      false,
      0,
      -1,
      2147483647,
      -2147483648,
      9007199254740991,
      '',
      '中😀',
      '\u2028\u2029',
      '\0\b\t\n\f\r"\\/',
    ];
    const texts = [
      ...fixtures.map((f) => canonical(pair(f.id).result)),
      ...scalars.flatMap((a) => scalars.map((b) => canonical({ a: [a, { b }], z: b }))),
      canonical(Array.from({ length: 250001 }, (_, i) => ({ a: i, b: i % 2 ? '中😀' : null }))),
    ];
    for (const text of texts) {
      finish(precheckJson(text));
      expect(JSON.stringify(JSON.parse(text))).toBe(text);
      expect(JSON.stringify(finish(parseChunked(text)))).toBe(text);
    }
    for (const text of [
      '{"a":-0}',
      '{"a":1e0}',
      '{"a":1.0}',
      '{"a":01}',
      '{"a":"\\u0061"}',
      '{"a":"\\/"}',
      '{"a":1,"a":2}',
      '{"b":1,"a":2}',
      '{"1":0}',
      '{"__proto__":0,"a":1}',
      '{"a":9007199254740992}',
    ]) {
      if (text.includes('__proto__')) {
        // This legal identifier remains an own key in both parser paths.
        finish(precheckJson(text));
        expect(JSON.stringify(finish(parseChunked(text)))).toBe(text);
      } else expect(() => finish(precheckJson(text))).toThrow(ProtocolFailure);
    }
  });
  it('encodes all frozen legal request shapes into canonical exact bytes', () => {
    for (const fixture of fixtures)
      expect(new TextDecoder().decode(encodeRequest(fixture.request))).toBe(
        canonical(fixture.request),
      );
  });
  it('validates complete scope/array/Unicode/checkpoint traces and exact inverse restoration', async () => {
    for (const id of [
      'fixture.trace.scope-array',
      'fixture.trace.checkpoint-128',
      'fixture.trace.array-before-return',
      'fixture.trace.array-31',
      'fixture.trace.unicode-output',
    ]) {
      const fixture = pair(id);
      expect(await decodeResult(wire(fixture.result), fixture.request)).toEqual(fixture.result);
    }
  });
  it('validates real-shaped program failure prefixes and adapter no-trace failures', async () => {
    for (const fixture of fixtures.filter(
      (fixture) => fixture.result.terminal.status !== 'completed',
    )) {
      const item = pair(fixture.id);
      expect(await decodeResult(wire(item.result), item.request)).toEqual(item.result);
    }
  });
  it('rejects fixture provenance even when all other fields and reversible content are legal', async () => {
    const fixture = structuredClone(fixtures[0]);
    await expect(decodeResult(wire(fixture.result), fixture.request)).rejects.toMatchObject({
      code: 'E_PROTOCOL_INVALID',
    });
  });
  it('preserves frozen unknown step/op/completeness and DSL version failure categories', async () => {
    for (const kind of ['step', 'op', 'completeness', 'dsl'] as const) {
      const item = pair();
      if (kind === 'step')
        (item.result.trace!.steps[0] as unknown as Record<string, unknown>).kind = 'unknown.event';
      if (kind === 'op')
        (item.result.trace!.steps[2].changes[0] as unknown as Record<string, unknown>).op =
          'unknown.op';
      if (kind === 'completeness') item.result.trace!.completeness = 'prefix';
      if (kind === 'dsl')
        (item.result.trace! as unknown as Record<string, unknown>).dslVersion = '2.0.0';
      await expect(decodeResult(wire(item.result), item.request)).rejects.toMatchObject({
        code: kind === 'dsl' ? 'E_PROTOCOL_VERSION' : 'E_TRACE_INVALID',
      });
    }
  });
  it('rejects missing array expectations/evidence and a mismatched met stdout as protocol faults', async () => {
    for (const kind of ['expectation', 'evidence', 'stdout'] as const) {
      const item = pair('fixture.trace.array-before-return');
      if (kind === 'expectation') delete item.request.judge!.expectedArray;
      if (kind === 'evidence') item.result.judgeResult!.observations = [];
      if (kind === 'stdout') item.request.judge!.expectedStdout = '99\n';
      await expect(decodeResult(wire(item.result), item.request)).rejects.toMatchObject({
        code: 'E_PROTOCOL_INVALID',
      });
    }
  });
  it.each([
    'identity',
    'engineRef',
    'packageRef',
    'languageRef',
    'subsetRef',
    'programRef',
    'subjectRef',
    'learningRevision',
    'budgetRef',
  ])('rejects a mismatched %s', async (key) => {
    const fixture = pair();
    const result = fixture.result as unknown as Record<string, unknown>;
    if (key === 'identity') fixture.result.identity.sourceRevision++;
    else if (key === 'engineRef') fixture.result.engineRef.buildId += '-stale';
    else if (key === 'learningRevision') result[key] = 9;
    else result[key] = { id: 'unknown.reference', version: '1.0.0' };
    await expect(decodeResult(wire(result), fixture.request)).rejects.toBeInstanceOf(
      ProtocolFailure,
    );
  });
  it.each([
    'protocolVersion',
    'traceVersion',
    'diagnosticVersion',
    'judgeVersion',
    'encodingVersion',
  ])('rejects unsupported %s before trace use', async (key) => {
    const fixture = pair();
    (fixture.result as unknown as Record<string, unknown>)[key] = '2.0.0';
    await expect(decodeResult(wire(fixture.result), fixture.request)).rejects.toMatchObject({
      code: 'E_PROTOCOL_VERSION',
    });
  });
  it('rejects unknown fields at every nested record category', async () => {
    const paths = [
      'root',
      'identity',
      'trace',
      'trace.initialState',
      'trace.initialState.control',
      'trace.initialState.allocator',
      'trace.steps.0',
      'trace.steps.0.changes.0',
      'nodeMap.0',
      'terminal',
      'terminal.location',
      'stats',
    ];
    for (const path of paths) {
      const fixture = pair();
      let target: unknown = fixture.result;
      if (path !== 'root')
        for (const key of path.split('.')) target = (target as Record<string, unknown>)[key];
      (target as Record<string, unknown>).unexpected = true;
      await expect(decodeResult(wire(fixture.result), fixture.request)).rejects.toBeInstanceOf(
        ProtocolFailure,
      );
    }
  });
  it('rejects duplicate/unsorted/non-ASCII keys, whitespace, BOM, exponent, decimals and noncanonical strings', async () => {
    const item = makeAdapterResult(request(), 'cancelled', 'E_CANCELLED'),
      text = canonical(item);
    const variants = [
      text.replace('{', '{"kind":"result",'),
      text.replace('{', '{"z":0,"a":0,'),
      text.replace('{', '{"é":0,'),
      ` ${text}`,
      `\ufeff${text}`,
      text.replace('"contextRevision":1', '"contextRevision":1e0'),
      text.replace('"contextRevision":1', '"contextRevision":1.0'),
      text.replace('"contextRevision":1', '"contextRevision":01'),
      text.replace('"kind":"result"', '"kind":"\\u0072esult"'),
      text.replace('"kind":"result"', '"kind":"resu\\/lt"'),
    ];
    for (const variant of variants)
      await expect(decodeResult(raw(variant), request())).rejects.toBeInstanceOf(ProtocolFailure);
  });
  it('rejects invalid UTF-8, unpaired surrogates, unsafe integers, negative zero and JSON nesting before schema', async () => {
    const invalidBytes = new Uint8Array([0xc0, 0x80]).buffer;
    await expect(decodeResult(invalidBytes, request())).rejects.toBeInstanceOf(ProtocolFailure);
    for (const text of [
      '"\\ud800"',
      '-0',
      '9007199254740992',
      '['.repeat(33) + '0' + ']'.repeat(33),
    ])
      await expect(decodeResult(raw(text), request())).rejects.toBeInstanceOf(ProtocolFailure);
  });
  it('checks ArrayBuffer length before decoding and request size before object validation', async () => {
    await expect(decodeResult(new ArrayBuffer(16777217), request())).rejects.toBeInstanceOf(
      ProtocolFailure,
    );
    await expect(decodeResult(new ArrayBuffer(0), request())).rejects.toBeInstanceOf(
      ProtocolFailure,
    );
    const input = request();
    input.source.text = 'a'.repeat(32769);
    expect(() => encodeRequest(input)).toThrow(ProtocolFailure);
    const overflow = request();
    overflow.source.blockMap = Array.from({ length: 1000 }, (_, i) => ({
      blockId: 'block-' + i + '-'.repeat(70),
      byteRange: { start: 0, end: 0 },
    }));
    expect(() => encodeRequest(overflow)).toThrow(ProtocolFailure);
  });
  it('rejects unknown request keys, bad source ranges, duplicate mappings and scalar-boundary splits', () => {
    const input = request();
    (input.source as unknown as Record<string, unknown>).other = null;
    expect(() => encodeRequest(input)).toThrow(ProtocolFailure);
    const input2 = request();
    input2.source.blockMap = [
      { blockId: 'same', byteRange: { start: 0, end: 0 } },
      { blockId: 'same', byteRange: { start: 0, end: 0 } },
    ];
    expect(() => encodeRequest(input2)).toThrow(ProtocolFailure);
    for (const [source, offset] of [
      ['中', 1],
      ['\r\n', 1],
      ['😀', 2],
    ] as const) {
      const input = request();
      input.source.text = source;
      input.source.blockMap = [{ blockId: 'split', byteRange: { start: 0, end: offset } }];
      expect(() => encodeRequest(input)).toThrow(ProtocolFailure);
    }
  });
  it('rejects wrong inverse preconditions, checkpoint, node references and sparse cells', async () => {
    const item = pair();
    const variants = [
      (result: ExecuteResult) => {
        result.trace!.steps[0].seq = 2;
      },
      (result: ExecuteResult) => {
        result.trace!.checkpoints[0].state.allocator.nextObject = 2;
      },
      (result: ExecuteResult) => {
        result.nodeMap[1].parentId = 'n9999';
      },
      (result: ExecuteResult) => {
        result.nodeMap[0].byteRange.end = 32768;
      },
      (result: ExecuteResult) => {
        result.trace!.steps[0].location = { kind: 'source', nodeId: 'n9999', edge: 'whole' };
      },
      (result: ExecuteResult) => {
        const change = result
          .trace!.steps.flatMap((step) => step.changes)
          .find((change) => change.op === 'cell')!;
        if (change.op === 'cell') change.before = 1999;
      },
      (result: ExecuteResult) => {
        const change = result
          .trace!.steps.flatMap((step) => step.changes)
          .find((change) => change.op === 'record' && change.table === 'objects' && change.after)!;
        if (change.op === 'record' && change.after && 'cells' in change.after)
          change.after.cells = [{ index: change.after.length, value: 0 }];
      },
      (result: ExecuteResult) => {
        result.stats!.peakVirtualBytes++;
      },
    ];
    for (const mutate of variants) {
      const result = structuredClone(item.result);
      mutate(result);
      await expect(decodeResult(wire(result), item.request)).rejects.toBeInstanceOf(
        ProtocolFailure,
      );
    }
  });
  it('requires completed return and exact diagnostic-free success, without accepting adapter traces', async () => {
    const fixture = pair();
    const result = structuredClone(fixture.result);
    result.producer = 'adapter';
    result.stats = null;
    await expect(decodeResult(wire(result), fixture.request)).rejects.toBeInstanceOf(
      ProtocolFailure,
    );
    const result2 = structuredClone(fixture.result);
    result2.terminal.exitCode = 999;
    await expect(decodeResult(wire(result2), fixture.request)).rejects.toBeInstanceOf(
      ProtocolFailure,
    );
    const result3 = structuredClone(fixture.result);
    result3.trace!.completeness = 'prefix';
    await expect(decodeResult(wire(result3), fixture.request)).rejects.toBeInstanceOf(
      ProtocolFailure,
    );
  });
  it('uses trusted request identity and no fabricated trace/statistics in adapter terminal results', async () => {
    for (const [status, code] of [
      ['cancelled', 'E_CANCELLED'],
      ['resource-limit', 'E_DEADLINE'],
      ['infrastructure-failure', 'E_MODULE_LOAD'],
      ['infrastructure-failure', 'E_TRACE_INVALID'],
    ] as const) {
      const req = request(),
        result = makeAdapterResult(req, status, code);
      expect(await decodeResult(wire(result), req)).toEqual(result);
      expect(result.identity).toEqual(req.identity);
      expect(result.trace).toBeNull();
      expect(result.stats).toBeNull();
      expect(result.judgeResult).toBeNull();
    }
  });
  it('rechecks guard throughout asynchronous validation and yields so cancellation can interrupt', async () => {
    const item = pair('fixture.trace.checkpoint-128');
    // The optimized 132-step packet can now complete before a queued timer.
    // A bounded large hostile field keeps validation pending long enough to
    // verify that the owner can cancel before any malformed result is accepted.
    (item.result as unknown as Record<string, unknown>).pendingPayload = Array(1_000_000).fill(0);
    let guards = 0,
      interrupted = false;
    const done = decodeResult(wire(item.result), item.request, () => {
      guards++;
      if (interrupted) throw new Error('cancelled by owner');
    });
    setTimeout(() => {
      interrupted = true;
    }, 0);
    await expect(done).rejects.toThrow('cancelled by owner');
    expect(guards).toBeGreaterThan(1);
  });
});
