import { expect, test } from 'vitest';
import { AlgorithmPlayer } from '../../web/src/engine/algorithm-player';
import {
  canonicalAlgorithmJson,
  decodeAlgorithmResult,
  encodeAlgorithmRequest,
  type AlgorithmResult,
} from '../../web/src/engine/algorithm-protocol';
import { fixture, request } from './algorithm-fixture';

const bytes = (value: unknown) => new TextEncoder().encode(canonicalAlgorithmJson(value)).buffer;
const decode = (value: unknown) => decodeAlgorithmResult(bytes(value), request, 'f'.repeat(64));
test('closed branch accepts canonical synthetic deltas and restores returned objects', async () => {
  const value = await decode(fixture());
  const player = new AlgorithmPlayer();
  player.accept(value);
  const initial = player.snapshot();
  expect(player.seek(4)).toBe(true);
  expect(player.snapshot().state?.frames).toEqual([]);
  expect(player.seek(3)).toBe(true);
  expect(player.snapshot().state?.objects[0].cells).toEqual([{ index: 0, value: 7 }]);
  for (let cursor = 2; cursor >= 0; cursor--) expect(player.seek(cursor)).toBe(true);
  expect(player.snapshot().state).toEqual(initial.state);
  player.play();
  player.tick();
  player.pause();
  const paused = player.snapshot();
  expect(player.tick()).toBe(false);
  expect(player.snapshot()).toEqual(paused);
  expect(player.seek(0)).toBe(true);
  player.invalidate();
  expect(player.seek(1)).toBe(false);
});
test.each([
  [
    'unknown version',
    (v: AlgorithmResult) => {
      v.execVersion = '2.0.0' as '1.2.0';
    },
  ],
  [
    'language mismatch',
    (v: AlgorithmResult) => {
      v.language = 'cpp';
    },
  ],
  [
    'build mismatch',
    (v: AlgorithmResult) => {
      v.engine.buildId = 'a'.repeat(64);
    },
  ],
  [
    'identity mismatch',
    (v: AlgorithmResult) => {
      v.identity.sourceRevision = 'stale';
    },
  ],
  [
    'unknown node kind',
    (v: AlgorithmResult) => {
      v.nodeMap[0].kind = 'future';
    },
  ],
  [
    'unknown event',
    (v: AlgorithmResult) => {
      v.trace!.steps[0].kind = 'future';
    },
  ],
  [
    'wrong before',
    (v: AlgorithmResult) => {
      const c = v.trace!.steps[2].changes[0];
      if (c.op === 'cell') c.before = 6;
    },
  ],
  [
    'wrong checkpoint',
    (v: AlgorithmResult) => {
      v.trace!.checkpoints[0].state.allocator.nextFrame = 2;
    },
  ],
  [
    'dangling frame',
    (v: AlgorithmResult) => {
      const c = v.trace!.steps[0].changes[0];
      if (c.op === 'record' && c.after && 'parentFrameId' in c.after) c.after.parentFrameId = 'f5';
    },
  ],
  [
    'unknown field',
    (v: AlgorithmResult) => {
      Object.assign(v.trace!.initialState, { future: true });
    },
  ],
  [
    'false terminal',
    (v: AlgorithmResult) => {
      v.terminal.returnValue = 6;
    },
  ],
  [
    'partial success',
    (v: AlgorithmResult) => {
      v.trace!.completeness = 'prefix';
    },
  ],
  [
    'invalid source boundary',
    (v: AlgorithmResult) => {
      v.nodeMap[0].byteRange.end = 100;
    },
  ],
  [
    'extra checkpoint',
    (v: AlgorithmResult) => {
      v.trace!.checkpoints.push(structuredClone(v.trace!.checkpoints[0]));
    },
  ],
] as const)('rejects %s', async (_name, mutate) => {
  const value = fixture();
  mutate(value);
  await expect(decode(value)).rejects.toThrow('E_PROTOCOL_INVALID');
});
test('duplicate keys, trailing input and noncanonical integers are rejected before native parsing', async () => {
  const text = canonicalAlgorithmJson(fixture());
  for (const invalid of [
    text.replace('"execVersion":', '"execVersion":"1.2.0","execVersion":'),
    `${text} `,
    text.replace('"fuelUsed":100', '"fuelUsed":1e2'),
  ]) {
    await expect(
      decodeAlgorithmResult(new TextEncoder().encode(invalid).buffer, request, 'f'.repeat(64)),
    ).rejects.toThrow('E_PROTOCOL_INVALID');
  }
});
test('source Unicode scalar and CRLF boundaries are checked without normalization', async () => {
  const req = { ...request, source: '//😀\r\nint main(){return 0;}' };
  const value = fixture();
  value.trace = null;
  value.terminal = {
    status: 'error',
    code: 'E_PARSE_INVALID',
    byteRange: { start: 3, end: 3 },
    cursor: 0,
    returnValue: null,
  };
  value.nodeMap = [];
  await expect(decodeAlgorithmResult(bytes(value), req, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
  value.terminal.byteRange = { start: 7, end: 7 };
  await expect(decodeAlgorithmResult(bytes(value), req, 'f'.repeat(64))).rejects.toThrow(
    'E_PROTOCOL_INVALID',
  );
  value.terminal.byteRange = { start: 8, end: 8 };
  await expect(decodeAlgorithmResult(bytes(value), req, 'f'.repeat(64))).resolves.toMatchObject({
    terminal: { status: 'error' },
  });
});
test('request snapshots have exact versions, no extensions and bounded integers', () => {
  expect(new TextDecoder().decode(encodeAlgorithmRequest(request))).toBe(
    canonicalAlgorithmJson(request),
  );
  expect(() => encodeAlgorithmRequest({ ...request, input: [2147483648] })).toThrow();
  expect(() => encodeAlgorithmRequest({ ...request, source: 'x'.repeat(32769) })).toThrow();
  expect(() => encodeAlgorithmRequest({ ...request, source: '\ud800' })).toThrow();
  expect(() => encodeAlgorithmRequest({ ...request, input: [1000] })).toThrow();
  expect(() => encodeAlgorithmRequest(Object.assign({ ...request }, { unknown: true }))).toThrow();
});
