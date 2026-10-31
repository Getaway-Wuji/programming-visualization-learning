import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { inspectContentDraft } from '../../web/src/content/validator.mjs';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import {
  caseSummary,
  exerciseRequest,
  submissionMet,
  type CaseSummary,
} from '../../web/src/practice/submission';
import { decodeResult, encodeRequest } from '../../web/src/engine/protocol';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { engineBuild } from '../../web/src/generated/engine-build';
import * as wasm from '../../web/src/generated/c_viz_wasm';

const content = inspectContentDraft(readFileSync('content/c/p05/course-1.0.0.json'));
const course: CoursePractice = {
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
) as { solutions: { exerciseRef: { id: string }; source: string }[] };
const guides = JSON.parse(readFileSync('content/c/p05/practice-guidance-1.0.0.json', 'utf8')) as {
  entries: { exerciseRef: { id: string }; correctionSource: string }[];
};
const encoder = new TextEncoder();
const records: unknown[] = [];
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

async function run(id: string, sourceText: string, stop = false): Promise<CaseSummary[]> {
  const catalog = exerciseCatalog(course, id),
    summaries: CaseSummary[] = [];
  const submissionId = crypto.randomUUID(),
    contextId = crypto.randomUUID();
  for (const [index, test] of catalog.subject.tests.entries()) {
    // Prepare public declarations using the actual answer source; execution still
    // validates against the original reviewed catalog selected independently.
    const preparation = { ...catalog, program: { ...catalog.program, sourceExample: sourceText } };
    const prepared = JSON.parse(
      new TextDecoder().decode(
        wasm.prepare_input(
          JSON.stringify(preparation),
          encoder.encode(canonical(test.input)),
          1000,
        ),
      ),
    ) as { source: PreparedSource };
    const request = exerciseRequest(
      catalog,
      prepared.source,
      { contextId, contextRevision: 1, sourceRevision: index + 1 },
      submissionId,
      test,
    );
    const bytes = wasm
      .execute_request(
        encodeRequest(request),
        JSON.stringify(catalog),
        engineBuild.wasmSha256,
        1000,
      )
      .slice();
    const result = await decodeResult(bytes.buffer, request);
    const summary = caseSummary(request, result);
    summaries.push(summary);
    records.push({
      exerciseId: id,
      correction: stop,
      caseKey: test.caseKey,
      protocolVersion: result.protocolVersion,
      judgeVersion: result.judgeVersion,
      terminal: result.terminal.status,
      met: summary.met,
      checks: summary.checks,
      coverage: summary.coverage,
      stats: result.stats,
    });
    if (stop && !summary.met) break;
  }
  return summaries;
}
describe('P0.5 real WASM producer and closed browser protocol consumer', () => {
  beforeAll(() => {
    wasm.initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') });
  });
  it.each(content.exercises.map((entry) => entry.id))(
    'accepts every fixed group and branch aggregation of %s',
    async (id) => {
      const source = references.solutions.find((entry) => entry.exerciseRef.id === id)!.source;
      const summaries = await run(id, source);
      expect(summaries.every((entry) => entry.met)).toBe(true);
      expect(submissionMet(exerciseCatalog(course, id), summaries)).toBe(true);
    },
    30000,
  );
  it.each(content.exercises.map((entry) => entry.id))(
    'rejects the real correction draft of %s',
    async (id) => {
      const source = guides.entries.find((entry) => entry.exerciseRef.id === id)!.correctionSource;
      const summaries = await run(id, source, true);
      expect(submissionMet(exerciseCatalog(course, id), summaries)).toBe(false);
    },
    30000,
  );
  it('writes a public-fixture-only receipt of all actual producer/consumer checks', () => {
    const directory = `.artifacts/${process.env.TASK_EVIDENCE_TASK ?? 'P0.5-09'}`;
    mkdirSync(directory, { recursive: true });
    const receipt = process.env.TASK_EVIDENCE_TASK
      ? `${directory}/course-wasm-execution-${process.env.TASK_EVIDENCE_LABEL ?? Date.now()}.json`
      : `${directory}/course-wasm-execution.json`;
    writeFileSync(
      receipt,
      JSON.stringify({ producer: 'actual-rust-wasm', userData: false, records }, null, 2) + '\n',
    );
    expect(records.length).toBeGreaterThanOrEqual(172);
  });
});
