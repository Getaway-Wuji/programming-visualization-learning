import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readVerticalPacket,
  sha256,
  verifyVerticalEvidence,
  verifyVerticalPacket,
  verticalKeys,
} from '../../scripts/verify-vertical-evidence.mjs';
import type { VerticalKey, VerticalPacket } from '../../scripts/verify-vertical-evidence.mjs';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';

const archive = fileURLToPath(new URL('../../项目文档/验收/07.3-真实轨迹/', import.meta.url));
const packet = (key: VerticalKey = 'assignment') => readVerticalPacket(join(archive, key));
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
// Deliberately invalid public copies test rejection, never evidence of execution.
function alterResult(item: VerticalPacket, mutate: (result: ExecuteResult) => void) {
  const result = JSON.parse(new TextDecoder().decode(item.resultBytes)) as ExecuteResult;
  mutate(result);
  item.resultBytes = new TextEncoder().encode(canonical(result));
  item.capture.resultSha256 = sha256(item.resultBytes);
  item.capture.resultByteLength = item.resultBytes.length;
}

describe('07.3 archived public production-UI evidence (no C rerun)', () => {
  it.each(verticalKeys)('independently verifies real source/input/trace/UI for %s', async (key) => {
    const verified = await verifyVerticalPacket(packet(key), key);
    expect(verified.producer).toBe('rust');
    expect(Object.values(verified.checks).every(Boolean)).toBe(true);
  });
  it('requires all six archived samples and keeps their real identities distinct', async () => {
    const result = await verifyVerticalEvidence(archive);
    expect(result.sampleCount).toBe(6);
    expect(result.recoveryCount).toBe(2);
    expect(result.recoveries.map((sample) => sample.status)).toEqual(['completed', 'completed']);
    expect(new Set(result.samples.map((sample) => sample.runId)).size).toBe(6);
    expect(result.samples.map((sample) => sample.steps)).toEqual([6, 34, 125, 14, 4, 33]);
  });
  it('rejects altered UI output even when capture.expected was altered to agree', async () => {
    const item = packet();
    item.ui.stdout = '999\n';
    Object.assign(item.capture, { expected: { stdout: '999\n', status: 'completed' } });
    await expect(verifyVerticalPacket(item, 'assignment')).rejects.toThrow();
  });
  it('rejects a stale UI identity rather than treating the raw Worker result as accepted', async () => {
    const item = packet();
    item.ui.runId += '-stale';
    await expect(verifyVerticalPacket(item, 'assignment')).rejects.toThrow();
  });
  it('rejects displayed source which differs from the actual request', async () => {
    const item = packet();
    item.ui.displayedSource = item.ui.displayedSource.replace('int x = -7;', 'int x = 3;');
    await expect(verifyVerticalPacket(item, 'assignment')).rejects.toThrow();
  });
  it('rejects unaccepted terminal and an incorrect displayed step count', async () => {
    const pending = packet();
    pending.ui.status = 'running';
    await expect(verifyVerticalPacket(pending, 'assignment')).rejects.toThrow();
    const wrongCount = packet();
    wrongCount.ui.stepCount++;
    await expect(verifyVerticalPacket(wrongCount, 'assignment')).rejects.toThrow();
  });
  it('rejects canonical request bytes whose binding range no longer matches the declaration', async () => {
    const item = packet();
    const request = JSON.parse(new TextDecoder().decode(item.requestBytes)) as ExecuteRequest;
    request.source.bindingMap[0].byteRange.end--;
    item.requestBytes = new TextEncoder().encode(canonical(request));
    item.capture.requestSha256 = sha256(item.requestBytes);
    item.capture.requestByteLength = item.requestBytes.length;
    await expect(verifyVerticalPacket(item, 'assignment')).rejects.toThrow();
  });
  it('rejects noncanonical result whitespace even with matching file hashes', async () => {
    const item = packet();
    item.resultBytes = new TextEncoder().encode(' ' + new TextDecoder().decode(item.resultBytes));
    item.capture.resultSha256 = sha256(item.resultBytes);
    item.capture.resultByteLength = item.resultBytes.length;
    await expect(verifyVerticalPacket(item, 'assignment')).rejects.toThrow();
  });
  it('validates the final inverse delta rather than checking only output and terminal', async () => {
    const item = packet();
    alterResult(item, (result) => {
      const control = result
        .trace!.steps.at(-1)!
        .changes.find((change) => change.op === 'control')!;
      if (control.op === 'control') control.before.activeFrameId = 'f999';
    });
    await expect(verifyVerticalPacket(item, 'assignment')).rejects.toThrow();
  });
  it('rejects a response from another execution even when the output is unchanged', async () => {
    const item = packet();
    alterResult(item, (result) => {
      result.identity.runId += '-other';
    });
    await expect(verifyVerticalPacket(item, 'assignment')).rejects.toThrow();
  });
  it('rejects a fault copy presented as unchanged public content', async () => {
    const item = packet('assignment-div-zero');
    item.capture.provenance = 'public-developer-test/original-content';
    await expect(verifyVerticalPacket(item, 'assignment-div-zero')).rejects.toThrow();
  });
  it('requires a Rust execute diagnostic at the actual failing expression', async () => {
    for (const field of ['origin', 'stage', 'location'] as const) {
      const item = packet('assignment-div-zero');
      alterResult(item, (result) => {
        const diagnostic = result.terminal.diagnostics[0];
        if (field === 'origin') diagnostic.origin = 'adapter';
        if (field === 'stage') diagnostic.stage = 'parse';
        if (field === 'location')
          diagnostic.location = { kind: 'source', byteRange: { start: 0, end: 1 } };
      });
      await expect(verifyVerticalPacket(item, 'assignment-div-zero')).rejects.toThrow();
    }
  });
  it('checks the actual array initialization independently of the expected-output metadata', async () => {
    const item = packet('array-traversal');
    alterResult(item, (result) => {
      const initialize = result.trace!.steps.find(
        (step) =>
          step.kind === 'value.initialize' &&
          step.changes.some((change) => change.op === 'record' && change.table === 'objects'),
      )!;
      const record = initialize.changes.find(
        (change) => change.op === 'record' && change.table === 'objects',
      )!;
      if (record.op === 'record' && record.after && 'cells' in record.after)
        record.after.cells[0].value = 123;
    });
    await expect(verifyVerticalPacket(item, 'array-traversal')).rejects.toThrow();
  });
  it('rejects checkpoint state which differs from the complete state projection', async () => {
    const item = packet('bubble-sort');
    alterResult(item, (result) => {
      result.trace!.checkpoints[0].state.allocator.nextObject++;
    });
    await expect(verifyVerticalPacket(item, 'bubble-sort')).rejects.toThrow();
  });
});
