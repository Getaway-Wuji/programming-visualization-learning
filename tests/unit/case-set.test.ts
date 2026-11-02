import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { caseSetIds, caseSetSamples } from '../fixtures/case-set';
import type { CaseSetSample } from '../fixtures/case-set';
import {
  CASE_ARCHIVE_BUILD_ID,
  readCasePacket,
  sha256,
  verifyCaseExecution,
  verifyCasePacket,
  verifyCaseRepresentatives,
} from '../../scripts/verify-case-set.mjs';
import type { CaseCatalog, CasePacket } from '../../scripts/verify-case-set.mjs';
import type { ContentPackage } from '../../web/src/content/types';
import { decodeResult, encodeRequest } from '../../web/src/engine/protocol';
import type { ExecuteRequest, ExecuteResult } from '../../web/src/engine/protocol';
import { initSync, prepare_input, execute_request } from '../../web/src/generated/c_viz_wasm';
import { engineBuild } from '../../web/src/generated/engine-build';
import { PlayerModel } from '../../web/src/player/model';
import { presentTrace } from '../../web/src/player/presentation';
import { createSourceIndex, mapSourceLocation } from '../../web/src/player/source-location';

const content = JSON.parse(
  readFileSync(new URL('../../shared/contracts/02.1-内容样例.json', import.meta.url), 'utf8'),
) as ContentPackage;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
interface Execution {
  request: ExecuteRequest;
  result: ExecuteResult;
  catalog: CaseCatalog;
}
const runs = new Map<string, Promise<Execution>>();
function execute(sample: CaseSetSample): Promise<Execution> {
  if (!runs.has(sample.key))
    runs.set(
      sample.key,
      (async () => {
        const subject = content.cases.find((item) => item.id === sample.caseId)!;
        const program = content.programs.find((item) => item.id === subject.programRef.id)!;
        const catalog: CaseCatalog = {
          packageRef: { id: content.packageId, version: content.packageVersion },
          subject,
          program,
          inputSpec: content.inputSpecs.find((item) => item.id === program.inputRef.id)!,
        };
        const original = JSON.stringify(catalog);
        const prepared = JSON.parse(
          decoder.decode(prepare_input(original, encoder.encode(canonical(sample.values)), 1000)),
        ) as { source: ExecuteRequest['source'] };
        const request: ExecuteRequest = {
          kind: 'execute',
          protocolVersion: '1.0.0',
          traceVersion: '1.0.0',
          diagnosticVersion: '1.0.0',
          judgeVersion: '1.0.0',
          encodingVersion: '1.0.0',
          identity: {
            contextId: `case-set-${sample.key}`,
            contextRevision: 1,
            sourceRevision: 1,
            submissionId: `submit-${sample.key}`,
            runId: `run-${sample.key}`,
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
          input: { specRef: program.inputRef, values: sample.values, random: null },
          judge: null,
          budgetRef: { id: 'budget.p0', version: '1.0.0' },
          remainingMs: 1000,
        };
        const bytes = execute_request(
          encodeRequest(request),
          original,
          engineBuild.wasmSha256,
          1000,
        ).slice();
        const result = await decodeResult(bytes.buffer, request);
        expect(JSON.stringify(catalog)).toBe(original);
        return { request, result, catalog };
      })(),
    );
  return runs.get(sample.key)!;
}
function load(result: ExecuteResult) {
  const model = new PlayerModel();
  expect(model.acceptValidated(model.begin(result.identity), result)).toBe(true);
  return model;
}

describe('08.4 seven public cases through the unchanged real Rust/WASM execution boundary', () => {
  beforeAll(() =>
    initSync({
      module: readFileSync(new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url)),
    }),
  );

  it('fixes 42 distinct public inputs, seven cases and one complete walk representative each', () => {
    expect(caseSetSamples).toHaveLength(42);
    expect(new Set(caseSetSamples.map((item) => item.key)).size).toBe(42);
    expect([...new Set(caseSetSamples.map((item) => item.caseId))]).toEqual(caseSetIds);
    expect(caseSetSamples.filter((item) => item.walk).map((item) => item.caseId)).toEqual(
      caseSetIds,
    );
  });

  it.each(caseSetSamples)(
    'accepts the original public template and known trace semantics: $key',
    async (sample) => {
      const { request, result, catalog } = await execute(sample);
      const verified = verifyCaseExecution(request, result, catalog, sample);
      expect(verified.stdout).toBe(sample.stdout);
      expect(verified.steps).toBeGreaterThan(1);
      const model = load(result);
      for (const checkpoint of [...result.trace!.checkpoints].reverse()) {
        expect(model.seek(checkpoint.cursor)).toBe(true);
        expect(model.snapshot().state).toEqual(checkpoint.state);
      }
      model.seek(result.trace!.steps.length);
      expect(model.snapshot()).toMatchObject({
        status: 'ended',
        state: {
          output: sample.stdout,
          objects: [],
          frames: [],
          scopes: [],
          control: { returnValue: 0 },
          allocator: { liveBytes: 0 },
        },
      });
      model.seek(0);
      expect(model.snapshot().state).toEqual(result.trace!.initialState);
    },
  );

  it.each(caseSetSamples.filter((item) => item.walk))(
    'restores every view, source and full state forward/reverse/arbitrarily: $key',
    async (sample) => {
      const { request, result, catalog } = await execute(sample);
      const original = JSON.stringify(result);
      const model = load(result);
      const sourceIndex = createSourceIndex(request.source.text);
      const frame = () => {
        const view = model.snapshot();
        const presentation = presentTrace(view, result, sample.values, catalog.program.bindings)!;
        const mapped = mapSourceLocation(
          request.source.text,
          result.nodeMap,
          view.location,
          sourceIndex,
        );
        expect(presentation.output).toBe(view.state!.output);
        expect(presentation.counters).toEqual(view.state!.counters);
        for (const object of presentation.objects) {
          const actual = view.state!.objects.find((item) => item.id === object.id)!;
          expect(actual).toMatchObject({ name: object.name, scopeId: object.scopeId });
          for (const cell of object.cells) {
            expect(cell.value).toBe(
              actual.cells.find((item) => item.index === cell.index)?.value ?? actual.defaultValue,
            );
            expect(cell.read).toBe(
              view.observations.some(
                (item) =>
                  item.kind === 'read' && item.objectId === object.id && item.index === cell.index,
              ),
            );
            const step = view.cursor ? result.trace!.steps[view.cursor - 1] : null;
            const initialized =
              step?.kind === 'value.initialize' &&
              step.changes.some(
                (item) =>
                  item.op === 'record' &&
                  item.table === 'objects' &&
                  item.id === object.id &&
                  item.after !== null,
              );
            const changed =
              step?.changes.some(
                (item) =>
                  item.op === 'cell' && item.objectId === object.id && item.index === cell.index,
              ) ?? false;
            expect(cell.written).toBe(!!initialized || changed);
          }
        }
        if (view.cursor === 0) expect(mapped.range).toBeNull();
        else {
          expect(view.location!.kind).toBe('source');
          expect(mapped.range).not.toBeNull();
          const range = mapped.range!;
          expect(request.source.text.slice(range.utf16Range.start, range.utf16Range.end)).toBe(
            Buffer.from(request.source.text)
              .subarray(range.byteRange.start, range.byteRange.end)
              .toString(),
          );
          expect(range.start.line).toBe(
            request.source.text.slice(0, range.utf16Range.start).split('\n').length,
          );
          expect(range.byteRange.start).toBeLessThan(range.byteRange.end);
        }
        return {
          state: view.state,
          cursor: view.cursor,
          location: view.location,
          observations: view.observations,
          terminal: view.terminal,
          presentation,
          mapped,
        };
      };
      const states = [frame()];
      const token = model.play()!;
      for (let cursor = 1; cursor <= result.trace!.steps.length; cursor++) {
        expect(model.tick(token)).toBe(true);
        states.push(frame());
      }
      for (let cursor = states.length - 1; cursor >= 0; cursor--) {
        model.seek(cursor);
        expect(frame()).toEqual(states[cursor]);
      }
      for (let index = 0; index < states.length; index++) {
        const cursor = (index * 37) % states.length;
        model.seek(cursor);
        expect(frame()).toEqual(states[cursor]);
      }
      model.seek(0);
      expect(frame()).toEqual(states[0]);
      expect(JSON.stringify(result)).toBe(original);
    },
  );

  it('rejects a different bound input and altered template instead of trusting expected metadata', async () => {
    const sample = caseSetSamples[0];
    const { request, result, catalog } = structuredClone(await execute(sample));
    request.input.values = { x: 123 };
    expect(() => verifyCaseExecution(request, result, catalog, sample)).toThrow();
    request.input.values = sample.values;
    catalog.program = {
      ...catalog.program,
      sourceExample: catalog.program.sourceExample.replace('x + 2', 'x + 3'),
    };
    expect(() => verifyCaseExecution(request, result, catalog, sample)).toThrow();
  });

  it('rejects a changed output delta even when a captured UI could claim the same changed output', async () => {
    const sample = caseSetSamples[0];
    const { request, result, catalog } = structuredClone(await execute(sample));
    const output = result
      .trace!.steps.flatMap((step) => step.changes)
      .find((change) => change.op === 'output')!;
    if (output.op === 'output') output.append = '999\n';
    expect(() => verifyCaseExecution(request, result, catalog, sample)).toThrow();
  });

  it('requires the true array before scope destruction, separately from the known stdout', async () => {
    const sample = caseSetSamples.find((item) => item.key === 'selection-sort-mixed')!;
    const { request, result, catalog } = structuredClone(await execute(sample));
    const destruction = result
      .trace!.steps.flatMap((step) => step.changes)
      .find(
        (change) =>
          change.op === 'record' &&
          change.table === 'objects' &&
          change.after === null &&
          change.before &&
          'name' in change.before &&
          change.before.name === 'values',
      )!;
    if (destruction.op === 'record' && destruction.before && 'cells' in destruction.before)
      destruction.before.cells[0].value = 999;
    expect(() => verifyCaseExecution(request, result, catalog, sample)).toThrow();
  });
});

const archive = fileURLToPath(new URL('../../tests/fixtures/cases/', import.meta.url));
const representative = () => readCasePacket(join(archive, 'assignment-negative'));
// Intentionally invalid public test copies, never replacement execution evidence.
function alterCapturedResult(packet: CasePacket, mutate: (result: ExecuteResult) => void) {
  const result = JSON.parse(decoder.decode(packet.resultBytes)) as ExecuteResult;
  mutate(result);
  packet.resultBytes = encoder.encode(canonical(result));
  packet.ui.resultSha256 = sha256(packet.resultBytes);
  packet.ui.resultByteLength = packet.resultBytes.byteLength;
}
describe('08.4 permanent public UI representatives (offline, no C rerun)', () => {
  it('verifies all seven complete UI representatives while explicitly retaining subset status', async () => {
    const report = await verifyCaseRepresentatives(archive);
    expect(report.passed).toBe(true);
    expect(report.sampleCount).toBe(7);
    expect(report.fullUiWalkCount).toBe(7);
    expect(report.completeMatrix).toBe(false);
    expect(report.projects).toEqual(['chrome']);
    expect(report.historicalEngineBuildId).toBe(CASE_ARCHIVE_BUILD_ID);
    if (String(engineBuild.wasmSha256) !== String(CASE_ARCHIVE_BUILD_ID))
      await expect(
        verifyCasePacket(representative(), 'assignment-negative', 'chrome'),
      ).rejects.toThrow();
  });

  it('rejects altered displayed source, stale UI identity and a changed initial view', async () => {
    for (const mutate of [
      (packet: CasePacket) => {
        packet.ui.displayedSource += '\n';
      },
      (packet: CasePacket) => {
        packet.ui.identity.runId += '-stale';
      },
      (packet: CasePacket) => {
        packet.ui.initialView.counters.scalarWrites = '1';
      },
    ]) {
      const packet = representative();
      mutate(packet);
      await expect(
        verifyCasePacket(packet, 'assignment-negative', 'chrome', CASE_ARCHIVE_BUILD_ID),
      ).rejects.toThrow();
    }
  });

  it('checks the final inverse and checkpoint even when altered bytes have matching evidence hashes', async () => {
    for (const mutate of [
      (result: ExecuteResult) => {
        const control = result
          .trace!.steps.at(-1)!
          .changes.find((change) => change.op === 'control')!;
        if (control.op === 'control') control.before.activeFrameId = 'f999';
      },
      (result: ExecuteResult) => {
        result.trace!.checkpoints[0].state.allocator.nextObject++;
      },
    ]) {
      const packet = representative();
      alterCapturedResult(packet, mutate);
      await expect(
        verifyCasePacket(packet, 'assignment-negative', 'chrome', CASE_ARCHIVE_BUILD_ID),
      ).rejects.toThrow();
    }
  });

  it('rejects noncanonical bytes and missing playback coverage rather than trusting success flags', async () => {
    const noncanonical = representative();
    noncanonical.resultBytes = encoder.encode(' ' + decoder.decode(noncanonical.resultBytes));
    noncanonical.ui.resultSha256 = sha256(noncanonical.resultBytes);
    noncanonical.ui.resultByteLength = noncanonical.resultBytes.byteLength;
    await expect(
      verifyCasePacket(noncanonical, 'assignment-negative', 'chrome', CASE_ARCHIVE_BUILD_ID),
    ).rejects.toThrow();
    const missingStep = representative();
    missingStep.ui.rates[0].cursors.splice(2, 1);
    await expect(
      verifyCasePacket(missingStep, 'assignment-negative', 'chrome', CASE_ARCHIVE_BUILD_ID),
    ).rejects.toThrow();
  });
});
