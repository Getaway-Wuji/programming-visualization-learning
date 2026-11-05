// Public authored C fixtures go through the actual current Rust/WASM producer.
// These checks exercise the canonical wire boundary, never synthetic success.
// Fixture generation uses a controlled producer clock; receive scheduling and
// cancellation retain their own clocks, with real deadlines covered in browsers.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ContentPackage } from '../../web/src/content/types';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { parseChunked, precheckJson } from '../../web/src/engine/execution-json';
import {
  decodeResult,
  encodeRequest,
  ProtocolFailure,
  RESULT_BYTES_LIMIT,
  sourceByteBoundaries,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';
import { engineBuild } from '../../web/src/generated/engine-build';
import { exerciseRequest } from '../../web/src/practice/submission';
import * as wasm from '../../web/src/generated/c_viz_wasm';
import { withSemanticWasmClock } from '../fixtures/semantic-wasm-clock';

const content = JSON.parse(
  readFileSync('content/c/p05/course-1.0.0.json', 'utf8'),
) as ContentPackage;
const practice: CoursePractice = {
  practiceVersion: '1.0.0',
  sourceSha256: '',
  packageRef: { id: content.packageId, version: content.packageVersion },
  exercises: content.exercises,
  programs: content.programs,
  inputSpecs: content.inputSpecs,
  judgeProfiles: content.judgeProfiles,
};
const references = JSON.parse(
  readFileSync('tests/fixtures/p05-reference-solutions.json', 'utf8'),
) as {
  solutions: { exerciseRef: { id: string }; source: string }[];
};
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
type Packet = {
  request: ExecuteRequest;
  bytes: Uint8Array<ArrayBuffer>;
  text: string;
  result: ExecuteResult;
};
let ordinary: Packet;
let special: Packet;
let boundary: Packet;
let maximum: Packet;

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : item,
  );
function finish<T>(work: Generator<void, T, unknown>): T {
  let next = work.next();
  while (!next.done) next = work.next();
  return next.value;
}
function produce(id: string, testIndex = 0, sourceText?: string, revision = 1): Packet {
  const catalog = exerciseCatalog(practice, id);
  const test = catalog.subject.tests[testIndex];
  const reference =
    sourceText ?? references.solutions.find((entry) => entry.exerciseRef.id === id)!.source;
  const preparation = { ...catalog, program: { ...catalog.program, sourceExample: reference } };
  const source = JSON.parse(
    decoder.decode(
      wasm.prepare_input(JSON.stringify(preparation), encoder.encode(canonical(test.input)), 1000),
    ),
  ) as { source: PreparedSource };
  const request = exerciseRequest(
    catalog,
    source.source,
    {
      contextId: 'p05.encoding',
      contextRevision: revision,
      sourceRevision: revision,
    },
    'p05.encoding.submission',
    test,
  );
  const bytes = withSemanticWasmClock(() =>
    wasm
      .execute_request(
        encodeRequest(request),
        JSON.stringify(catalog),
        engineBuild.wasmSha256,
        1000,
      )
      .slice(),
  );
  const text = decoder.decode(bytes);
  const result = JSON.parse(text) as ExecuteResult;
  expect(request.protocolVersion).toBe('1.1.0');
  expect(result.producer).toBe('rust');
  expect(result.terminal.status).toBe('completed');
  return { request, bytes, text, result };
}
const decodeText = (text: string, request = ordinary.request) =>
  decodeResult(encoder.encode(text).buffer, request);
const changed = (text: string, before: string, after: string) => {
  expect(text).toContain(before);
  const value = text.replace(before, after);
  expect(value).not.toBe(text);
  return value;
};

/** Call through to the native decoder and task queue. The simulated work clock
 * controls only this unit's UTF-8 scheduling phase; it does not replace an
 * ExecutionClient deadline or supply an accepted execution result. */
function observeUtf8Scheduling(workPerChunk: number) {
  const NativeDecoder = globalThis.TextDecoder;
  const NativeChannel = globalThis.MessageChannel;
  const nativeNow = performance.now.bind(performance);
  const observation = {
    decoding: true,
    decoders: 0,
    chunks: 0,
    tasks: 0,
    flushed: false,
  };
  vi.spyOn(performance, 'now').mockImplementation(() =>
    observation.decoding ? observation.chunks * workPerChunk : nativeNow(),
  );
  vi.stubGlobal(
    'TextDecoder',
    new Proxy(NativeDecoder, {
      construct(target, args) {
        observation.decoders++;
        const instance = Reflect.construct(target, args) as TextDecoder;
        const decode = instance.decode.bind(instance);
        instance.decode = (input, options) => {
          if (options?.stream) observation.chunks++;
          else {
            observation.flushed = true;
            observation.decoding = false;
          }
          return decode(input, options);
        };
        return instance;
      },
    }),
  );
  vi.stubGlobal(
    'MessageChannel',
    new Proxy(NativeChannel, {
      construct(target, args) {
        if (observation.decoding) observation.tasks++;
        return Reflect.construct(target, args);
      },
    }),
  );
  return observation;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('P0.5 1.1 canonical receive proof remains strict without duplicate tree encoding', () => {
  beforeAll(() => {
    wasm.initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') });
    ordinary = produce('exercise.c.first-output');
    const reference = references.solutions.find(
      (entry) => entry.exerciseRef.id === 'exercise.c.first-output',
    )!.source;
    // A deliberately different public output is a valid completed/unmet result;
    // it supplies genuine slash, astral Unicode and tab bytes to the wire codec.
    special = produce(
      'exercise.c.first-output',
      0,
      reference.replace('Hello, C!', 'Hello, C! /中😀\t'),
    );
    boundary = produce('exercise.c.first-output', 0, undefined, Number.MAX_SAFE_INTEGER);
    const catalog = exerciseCatalog(practice, 'exercise.c.bubble-sort');
    maximum = produce(
      'exercise.c.bubble-sort',
      catalog.subject.tests.findIndex((test) => test.caseKey === 'maximum'),
    );
  }, 30_000);

  it('accepts genuine met and Unicode/control-character unmet packets with their exact wire scalars', async () => {
    for (const packet of [ordinary, special, boundary]) {
      const parsed = finish(parseChunked(packet.text));
      expect(parsed).toEqual(packet.result);
      expect(canonical(parsed)).toBe(packet.text);
      await expect(decodeResult(packet.bytes.slice().buffer, packet.request)).resolves.toEqual(
        packet.result,
      );
    }
    expect(ordinary.result.judgeResult?.status).toBe('met');
    expect(special.result.judgeResult?.status).toBe('unmet');
    expect(special.text).toContain('/中😀\\t');
    expect(boundary.result.identity.contextRevision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    'reordered-object',
    'duplicate-key',
    'leading-whitespace',
    'internal-whitespace',
    'trailing-whitespace',
    'second-root',
  ])('rejects noncanonical actual-result spelling %s', async (kind) => {
    let text = ordinary.text;
    if (kind === 'reordered-object')
      text = JSON.stringify(Object.fromEntries(Object.entries(ordinary.result).reverse()));
    if (kind === 'duplicate-key')
      text = changed(text, '"kind":"result"', '"kind":"result","kind":"result"');
    if (kind === 'leading-whitespace') text = ` ${text}`;
    if (kind === 'internal-whitespace') text = changed(text, '"kind":"result"', '"kind": "result"');
    if (kind === 'trailing-whitespace') text += '\n';
    if (kind === 'second-root') text += '{}';
    if (kind !== 'second-root') expect(JSON.parse(text)).toEqual(ordinary.result);
    await expect(decodeText(text)).rejects.toBeInstanceOf(ProtocolFailure);
  });

  it.each([
    '-0',
    '00',
    '0.0',
    '0e0',
    '0E+0',
    '+0',
    '9007199254740992',
    '-9007199254740992',
    '10000000000000000',
  ])('rejects noncanonical or unsafe result integer %s', async (number) => {
    const text = changed(ordinary.text, '"peakVirtualBytes":0', `"peakVirtualBytes":${number}`);
    await expect(decodeText(text)).rejects.toBeInstanceOf(ProtocolFailure);
  });

  it.each([
    'escaped-solidus',
    'escaped-BMP',
    'escaped-astral',
    'long-tab-escape',
    'long-newline-escape',
  ])('rejects a semantically equal noncanonical string %s', async (kind) => {
    const replacements: Record<string, [string, string]> = {
      'escaped-solidus': ['/', '\\/'],
      'escaped-BMP': ['中', '\\u4e2d'],
      'escaped-astral': ['😀', '\\ud83d\\ude00'],
      'long-tab-escape': ['\\t', '\\u0009'],
      'long-newline-escape': ['\\n', '\\u000a'],
    };
    const text = changed(special.text, ...replacements[kind]);
    expect(JSON.parse(text)).toEqual(special.result);
    await expect(decodeText(text, special.request)).rejects.toBeInstanceOf(ProtocolFailure);
  });

  it.each(['\\ud800', '\\udc00', '\\ud800x', '\\ud800\\ud800', '\\u001F'])(
    'rejects an unpaired or noncanonical Unicode escape %s',
    async (spelling) => {
      const text = changed(ordinary.text, '"p05.encoding"', `"${spelling}"`);
      await expect(decodeText(text)).rejects.toBeInstanceOf(ProtocolFailure);
    },
  );

  it('rejects malformed surrogate UTF-8 and overlong UTF-8 instead of accepting replacement scalars', async () => {
    const marker = ordinary.text.indexOf('p05.encoding');
    const prefix = encoder.encode(ordinary.text.slice(0, marker));
    const suffix = encoder.encode(ordinary.text.slice(marker + 'p05.encoding'.length));
    for (const invalid of [
      [0xed, 0xa0, 0x80],
      [0xc0, 0x80],
    ]) {
      const bytes = new Uint8Array(prefix.length + invalid.length + suffix.length);
      bytes.set(prefix);
      bytes.set(invalid, prefix.length);
      bytes.set(suffix, prefix.length + invalid.length);
      await expect(decodeResult(bytes.buffer, ordinary.request)).rejects.toBeInstanceOf(
        ProtocolFailure,
      );
    }
  });

  it('retains exact JSON-INT and nesting boundaries in the lexical proof used by 1.1', async () => {
    const ints = canonical([Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER]);
    expect(finish(precheckJson(ints)).containers).toBe(1);
    expect(finish(parseChunked(ints))).toEqual(JSON.parse(ints));
    const supported = '['.repeat(32) + '0' + ']'.repeat(32);
    expect(finish(precheckJson(supported)).containers).toBe(32);
    expect(canonical(finish(parseChunked(supported)))).toBe(supported);
    const over = '['.repeat(33) + '0' + ']'.repeat(33);
    expect(() => finish(precheckJson(over))).toThrow(ProtocolFailure);
    await expect(
      decodeText(changed(ordinary.text, '"stats":{', `"stats":${over},"unused":{`)),
    ).rejects.toBeInstanceOf(ProtocolFailure);
  });

  it.each([
    [
      'ASCII with indivisible CRLF and separate lone line endings',
      'A\r\nB\nC\rD',
      [0, 1, 3, 4, 5, 6, 7, 8],
    ],
    ['two- and three-byte BMP characters', 'Aé中B', [0, 1, 3, 6, 7]],
    ['an astral scalar', 'A😀B', [0, 1, 5, 6]],
    ['isolated surrogates replaced by TextEncoder', '\ud800A\udc00😀\ud800', [0, 3, 4, 7, 11, 14]],
  ] as const)('keeps exact source byte boundaries for %s', (_name, source, expected) => {
    const points = sourceByteBoundaries(source);
    expect([...points]).toEqual(expected);
    expect(encoder.encode(source).byteLength).toBe(expected.at(-1));
  });

  it('accepts mixed sibling containers with independently ordered keys and empty values', () => {
    const text = '[{"z":0},{"a":1},[],{},[0,1],{"a":[],"b":[{},{"a":0}]}]';
    expect(finish(precheckJson(text)).containers).toBe(11);
    expect(finish(parseChunked(text))).toEqual(JSON.parse(text));
  });

  it.each(['[{"z":0},[],{"b":1,"a":2}]', '[{"z":0},{},{"a":1,"a":2}]'])(
    'still rejects bad key order or duplication after sibling reuse: %s',
    (text) => {
      expect(() => finish(precheckJson(text))).toThrow(ProtocolFailure);
    },
  );

  it('applies the lexical member limit independently to each sibling object', () => {
    const broad = Object.fromEntries(
      Array.from({ length: 32_768 }, (_, index) => [`k${String(index).padStart(5, '0')}`, 0]),
    );
    const text = `[${JSON.stringify(broad)},{"a":[]},[],{"a":0}]`;
    expect(finish(precheckJson(text)).containers).toBe(6);
    expect(() => finish(precheckJson(`[${JSON.stringify({ ...broad, k32768: 0 })}]`))).toThrow(
      ProtocolFailure,
    );
  });

  it('keeps independently paused lexical scans isolated while both reuse sibling depths', () => {
    const leftText = canonical(
      Array.from({ length: 4000 }, (_, index) =>
        index % 2 ? { a: [index, { z: '左中😀' }] } : [{ z: index }, { a: [] }],
      ),
    );
    const rightText = canonical({
      a: Array.from({ length: 4000 }, () => ({ a: [], z: 'right\\\t' })),
      z: [],
    });
    const left = precheckJson(leftText);
    const right = precheckJson(rightText);
    let leftNext = left.next();
    let rightNext = right.next();
    expect(leftNext.done).toBe(false);
    expect(rightNext.done).toBe(false);
    while (!leftNext.done || !rightNext.done) {
      if (!leftNext.done) leftNext = left.next();
      if (!rightNext.done) rightNext = right.next();
    }
    expect(leftNext.value.containers).toBe(14_001);
    expect(rightNext.value.containers).toBe(8003);
  });

  it('does not corrupt another paused scan when a sibling key error rejects one generator', () => {
    const goodText = canonical(
      Array.from({ length: 4000 }, (_, index) =>
        index % 2 ? { a: [index, { z: '中😀' }] } : [{ z: index }, { a: [] }],
      ),
    );
    const badText = `[${Array.from({ length: 4000 }, () => '{"a":[],"z":"sibling"}').join(',')},{"z":0,"a":1}]`;
    const good = precheckJson(goodText);
    const bad = precheckJson(badText);
    let next = good.next();
    expect(next.done).toBe(false);
    expect(bad.next().done).toBe(false);
    expect(() => finish(bad)).toThrow(ProtocolFailure);
    while (!next.done) next = good.next();
    expect(next.value.containers).toBe(14_001);
    expect(finish(precheckJson('[{"a":0},[]]')).containers).toBe(3);
  });

  it('fully consumes the actual maximum bubble packet through the 1.1 protocol boundary', async () => {
    expect(maximum.bytes.byteLength).toBeGreaterThan(1_000_000);
    const result = await decodeResult(maximum.bytes.slice().buffer, maximum.request);
    expect(result.trace?.steps).toHaveLength(5330);
    expect(result.judgeResult?.status).toBe('met');
    expect(result.stats!.fuelUsed).toBeLessThanOrEqual(1_000_000);
  }, 30_000);

  it('does not post byte-count scheduling tasks when genuine maximum-packet UTF-8 work is still fast', async () => {
    const observed = observeUtf8Scheduling(0);
    let streamingGuards = 0;
    const result = await decodeResult(maximum.bytes.slice().buffer, maximum.request, () => {
      if (observed.decoding) streamingGuards++;
    });
    expect(result).toEqual(maximum.result);
    expect(observed.chunks).toBeGreaterThan(16);
    expect(observed.flushed).toBe(true);
    expect(observed.tasks).toBe(0);
    expect(streamingGuards).toBeGreaterThanOrEqual(observed.chunks);
  }, 30_000);

  it('still lets an actual queued owner cancellation interrupt slow maximum-packet UTF-8 work', async () => {
    const observed = observeUtf8Scheduling(20);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = decodeResult(maximum.bytes.slice().buffer, maximum.request, () => {
        if (cancelled) throw new Error('p05-owner-cancelled-during-utf8');
        if (observed.chunks > 0 && timer === undefined)
          timer = setTimeout(() => {
            cancelled = true;
          }, 0);
      });
      await expect(pending).rejects.toThrow('p05-owner-cancelled-during-utf8');
      expect(cancelled).toBe(true);
      expect(observed.tasks).toBeGreaterThan(0);
      expect(observed.flushed).toBe(false);
      expect(observed.chunks).toBeLessThan(Math.ceil(maximum.bytes.byteLength / 65_536));
    } finally {
      clearTimeout(timer);
    }
  }, 30_000);

  it('checks the owner after each UTF-8 chunk even without posting a task', async () => {
    const observed = observeUtf8Scheduling(0);
    await expect(
      decodeResult(maximum.bytes.slice().buffer, maximum.request, () => {
        if (observed.chunks >= 2) throw new Error('p05-owner-replaced-during-utf8');
      }),
    ).rejects.toThrow('p05-owner-replaced-during-utf8');
    expect(observed.chunks).toBe(2);
    expect(observed.tasks).toBe(0);
    expect(observed.flushed).toBe(false);
  });

  it('rejects malformed UTF-8 spanning two native decode chunks before parsing the packet', async () => {
    const observed = observeUtf8Scheduling(0);
    const bytes = maximum.bytes.slice();
    // A four-byte scalar starts at the end of one chunk. Its invalid fourth
    // byte is only encountered in the following chunk by the native decoder.
    bytes.set([0xf0, 0x9f, 0x98, 0xff], 65_535);
    await expect(decodeResult(bytes.buffer, maximum.request)).rejects.toBeInstanceOf(
      ProtocolFailure,
    );
    expect(observed.chunks).toBe(2);
    expect(observed.flushed).toBe(false);
  });

  it('rejects an oversized response before native UTF-8 allocation or task scheduling', async () => {
    const observed = observeUtf8Scheduling(0);
    await expect(
      decodeResult(new ArrayBuffer(RESULT_BYTES_LIMIT + 1), maximum.request),
    ).rejects.toBeInstanceOf(ProtocolFailure);
    expect(observed.decoders).toBe(0);
    expect(observed.chunks).toBe(0);
    expect(observed.tasks).toBe(0);
  });

  it('still yields and rejects a real cancellation before accepting a maximum 1.1 packet', async () => {
    let calls = 0,
      scheduled = false,
      cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = decodeResult(maximum.bytes.slice().buffer, maximum.request, () => {
        if (cancelled) throw new Error('p05-owner-cancelled');
        if (++calls === 2000) {
          scheduled = true;
          timer = setTimeout(() => {
            cancelled = true;
          }, 0);
        }
      });
      await expect(pending).rejects.toThrow('p05-owner-cancelled');
      expect(scheduled && cancelled).toBe(true);
    } finally {
      clearTimeout(timer);
    }
  }, 30_000);
});
