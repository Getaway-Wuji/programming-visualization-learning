import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContentPackage } from '../../web/src/content/types';
import { engineBuild } from '../../web/src/generated/engine-build';
import { initSync, prepare_input, execute_request } from '../../web/src/generated/c_viz_wasm';
import { decodeResult, encodeRequest, ProtocolFailure } from '../../web/src/engine/protocol';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';
import {
  FROZEN_EXEC_SCHEMA_SHA256,
  validateResultSchema,
} from '../../web/src/engine/execution-schema.generated';
import type { SchemaValue } from '../../web/src/engine/execution-schema.generated';
import { parseChunked, precheckJson } from '../../web/src/engine/execution-json';
import { withSemanticWasmClock } from '../fixtures/semantic-wasm-clock';

const encoder = new TextEncoder(),
  decoder = new TextDecoder();
let request: ExecuteRequest,
  packet: Uint8Array<ArrayBuffer>,
  rustMs = 0;
const evidence = fileURLToPath(
  new URL(
    `../../.artifacts/${process.env.TASK_EVIDENCE_TASK ? `${process.env.TASK_EVIDENCE_TASK}/regression/execution-performance/${process.env.TASK_EVIDENCE_LABEL ?? Date.now()}` : `07.2/local-${Date.now()}`}/`,
    import.meta.url,
  ),
);
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
function altered(mutator: (value: ExecuteResult) => void): ArrayBuffer {
  const value = JSON.parse(decoder.decode(packet)) as ExecuteResult;
  mutator(value);
  return encoder.encode(canonical(value)).buffer;
}
function finish<T>(generator: Generator<void, T, unknown>): T {
  let next = generator.next();
  while (!next.done) next = generator.next();
  return next.value;
}

describe('specialized protocol validation with real maximum-input Rust packets', () => {
  beforeAll(() => {
    const content = JSON.parse(
      readFileSync(new URL('../../shared/contracts/02.1-内容样例.json', import.meta.url), 'utf8'),
    ) as ContentPackage;
    const subject = content.cases.find((value) => value.id === 'case.c.bubble-sort')!;
    const program = content.programs.find((value) => value.id === subject.programRef.id)!;
    const inputSpec = content.inputSpecs.find((value) => value.id === program.inputRef.id)!;
    const catalog = {
      packageRef: { id: content.packageId, version: content.packageVersion },
      subject,
      program,
      inputSpec,
    };
    const original = JSON.stringify(program),
      values = { values: Array.from({ length: 30 }, (_, index) => 30 - index) };
    initSync({
      module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
    });
    const prepared = JSON.parse(
      decoder.decode(
        prepare_input(JSON.stringify(catalog), encoder.encode(canonical(values)), 1000),
      ),
    ) as { source: ExecuteRequest['source'] };
    expect(JSON.stringify(program)).toBe(original);
    expect(program.exampleInput.values).toEqual([3, 1, 2]);
    request = {
      kind: 'execute',
      protocolVersion: '1.0.0',
      traceVersion: '1.0.0',
      diagnosticVersion: '1.0.0',
      judgeVersion: '1.0.0',
      encodingVersion: '1.0.0',
      identity: {
        contextId: 'protocol-performance',
        contextRevision: 1,
        sourceRevision: 1,
        submissionId: 'submission-30',
        runId: 'run-30',
        testCaseKey: null,
      },
      mode: 'case',
      packageRef: catalog.packageRef,
      languageRef: program.languageRef,
      subsetRef: program.subsetRef,
      programRef: subject.programRef,
      subjectRef: { id: subject.id, version: subject.version },
      learningRevision: subject.learningRevision,
      engineRef: { id: 'engine.c.p0', version: '1.0.0', buildId: engineBuild.wasmSha256 },
      source: prepared.source,
      input: { specRef: program.inputRef, values, random: null },
      judge: null,
      budgetRef: { id: 'budget.p0', version: '1.0.0' },
      remainingMs: 1000,
    };
    const start = performance.now();
    packet = withSemanticWasmClock(() =>
      execute_request(
        encodeRequest(request),
        JSON.stringify(catalog),
        engineBuild.wasmSha256,
        1000,
      ).slice(),
    );
    rustMs = performance.now() - start;
  });
  it('keeps the generated validator exactly reproducible from the frozen schema', () => {
    const frozen = readFileSync(
      new URL('../../shared/contracts/02.2-执行与轨迹.schema.json', import.meta.url),
      'utf8',
    );
    expect(createHash('sha256').update(frozen).digest('hex')).toBe(FROZEN_EXEC_SCHEMA_SHA256);
    const checked = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../scripts/generate-execution-schema.mjs', import.meta.url)),
        '--check',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    expect(checked.stderr).toBe('');
    expect(checked.status).toBe(0);
  });
  it('accepts the complete 5330-step n30 packet with full schema, checkpoints and inverse checks', async () => {
    const start = performance.now();
    let last = start,
      maxGap = 0,
      guards = 0;
    const result = await decodeResult(packet.slice().buffer, request, () => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
      guards++;
    });
    const decodeMs = performance.now() - start;
    expect(result.producer).toBe('rust');
    expect(result.terminal.status).toBe('completed');
    expect(result.trace!.steps).toHaveLength(5330);
    expect(result.trace!.checkpoints).toHaveLength(42);
    expect(
      result
        .trace!.steps.flatMap((step) => step.changes)
        .filter((change) => change.op === 'output')
        .map((change) => change.append)
        .join(''),
    ).toBe('1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30\n');
    expect(guards).toBeGreaterThan(100);
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      evidence + 'performance-unit.json',
      JSON.stringify(
        {
          note: 'Real current Rust/WASM fixture with a controlled producer clock; external generation and receive timings are technical observations, not original-deadline acceptance. Browser deadlines use real clocks.',
          buildId: engineBuild.wasmSha256,
          bytes: packet.length,
          steps: 5330,
          rustMs,
          decodeMs,
          maxGuardGapMs: maxGap,
          guards,
        },
        null,
        2,
      ),
    );
  });
  it('still validates the final step and final checkpoint after deferred schema batches', async () => {
    const badStep = altered((result) => {
      (result.trace!.steps.at(-1)! as unknown as Record<string, unknown>).extra = true;
    });
    await expect(decodeResult(badStep, request)).rejects.toMatchObject({ code: 'E_TRACE_INVALID' });
    const badCheckpoint = altered((result) => {
      result.trace!.checkpoints.at(-1)!.state.allocator.nextObject++;
    });
    await expect(decodeResult(badCheckpoint, request)).rejects.toBeInstanceOf(ProtocolFailure);
    const badInverse = altered((result) => {
      const change = result.trace!.steps.at(-1)!.changes.find((change) => change.op === 'control')!;
      if (change.op === 'control') change.before.activeFrameId = 'f999';
    });
    await expect(decodeResult(badInverse, request)).rejects.toBeInstanceOf(ProtocolFailure);
  });
  it('lets an owner cancel while the real multi-megabyte schema is pending', async () => {
    let calls = 0,
      scheduled = false,
      cancelled = false,
      cancelledAt = 0;
    const accepted = decodeResult(packet.slice().buffer, request, () => {
      if (cancelled) throw new Error('owner-cancelled');
      if (++calls >= 2000 && !scheduled) {
        scheduled = true;
        setTimeout(() => {
          cancelled = true;
          cancelledAt = performance.now();
        }, 0);
      }
    });
    await expect(accepted).rejects.toThrow('owner-cancelled');
    expect(scheduled && cancelled).toBe(true);
    expect(performance.now() - cancelledAt).toBeLessThan(100);
  });
  it('carries all frozen legal fixture shapes through the generated schema without production provenance promotion', () => {
    for (const name of ['02.2-正常轨迹样例.json', '02.2-失败与超限轨迹样例.json']) {
      const value = JSON.parse(
        readFileSync(new URL(`../../shared/contracts/${name}`, import.meta.url), 'utf8'),
      ) as { fixtures: { result: SchemaValue }[] };
      for (const fixture of value.fixtures)
        expect(finish(validateResultSchema(fixture.result, () => {}))).toBe(true);
    }
  });
  it('keeps native and chunked allocation identical for Unicode, escapes and nested values', () => {
    const value = {
      a: [null, true, false, -2147483648, 2147483647, '中😀\u0000\b\t\n\f\r"\\'],
      b: { before: { kind: 'source', nodeId: 'n1' }, cells: [{ index: 0, value: 9 }] },
    };
    const text = canonical(value);
    expect(finish(precheckJson(text)).containers).toBeGreaterThan(1);
    expect(finish(parseChunked(text))).toEqual(JSON.parse(text));
  });
  it('uses cancellable allocation for a very broad hostile packet rather than one blocking parse', async () => {
    const text = '{"a":[' + '{},'.repeat(300_000) + '{}]}';
    expect(finish(precheckJson(text)).containers).toBeGreaterThan(250_000);
    let calls = 0;
    await expect(
      decodeResult(encoder.encode(text).buffer, request, () => {
        if (++calls === 100) throw new Error('owner-stopped-wide-packet');
      }),
    ).rejects.toThrow('owner-stopped-wide-packet');
    expect(calls).toBe(100);
  });
});
