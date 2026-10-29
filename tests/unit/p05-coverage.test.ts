// Real Rust output supplies the baseline. Mutations exercise the browser relationship validator.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContentPackage } from '../../web/src/content/types';
import { exerciseCatalog, type CoursePractice } from '../../web/src/content/practice';
import { exerciseRequest } from '../../web/src/practice/submission';
import {
  decodeResult,
  encodeRequest,
  type ExecuteRequest,
  type ExecuteResult,
} from '../../web/src/engine/protocol';
import type { PreparedSource } from '../../web/src/engine/execution-client';
import { engineBuild } from '../../web/src/generated/engine-build';
import * as wasm from '../../web/src/generated/c_viz_wasm';

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
const catalog = exerciseCatalog(practice, 'exercise.c.sign-classification');
const encoder = new TextEncoder();
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
let request: ExecuteRequest;
let result: ExecuteResult;
const buffer = (value: ExecuteResult) => encoder.encode(canonical(value)).buffer;

describe('P0.5 structural if ordinal coverage relationship', () => {
  beforeAll(async () => {
    wasm.initSync({ module: readFileSync('web/src/generated/c_viz_wasm_bg.wasm') });
    const test = catalog.subject.tests[0];
    const prepared = JSON.parse(
      new TextDecoder().decode(
        wasm.prepare_input(JSON.stringify(catalog), encoder.encode(canonical(test.input)), 1000),
      ),
    ) as { source: PreparedSource };
    request = exerciseRequest(
      catalog,
      prepared.source,
      {
        contextId: 'p05.coverage',
        contextRevision: 1,
        sourceRevision: 1,
      },
      'p05.coverage.submission',
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
    result = await decodeResult(bytes.buffer, request);
    expect(result.judgeResult?.status).toBe('met');
    expect(result.judgeResult!.coverage).toHaveLength(4);
  });

  it('accepts actual 1.1 coverage keyed to its structural if ordinal without Blockly identities', async () => {
    expect(request.protocolVersion).toBe('1.1.0');
    const ifs = result.nodeMap.filter((node) => node.kind === 'if');
    expect(ifs).toHaveLength(2);
    for (const coverage of result.judgeResult!.coverage) {
      expect(coverage.siteKey).toBe(
        `if.${ifs.findIndex((node) => node.nodeId === coverage.nodeId)}`,
      );
      expect(['then', 'else']).toContain(coverage.branch);
    }
    await expect(decodeResult(buffer(result), request)).resolves.toMatchObject({
      judgeResult: { status: 'met' },
    });
  });

  it.each([
    'unknown-ordinal',
    'swapped-valid-node',
    'non-if-node',
    'unknown-node',
    'legacy-block-site',
    'loop-branch',
    'duplicate-branch',
    'duplicate-valid-site',
  ])('rejects forged 1.1 coverage %s', async (kind) => {
    const changed = structuredClone(result);
    const coverage = changed.judgeResult!.coverage;
    const ifs = changed.nodeMap.filter((node) => node.kind === 'if');
    if (kind === 'unknown-ordinal') coverage[0].siteKey = 'if.999';
    if (kind === 'swapped-valid-node') coverage[0].nodeId = ifs[1].nodeId;
    if (kind === 'non-if-node')
      coverage[0].nodeId = changed.nodeMap.find((node) => node.kind === 'declaration')!.nodeId;
    if (kind === 'unknown-node') coverage[0].nodeId = 'n99999';
    if (kind === 'legacy-block-site')
      coverage[0].siteKey = request.source.blockMap.find((mapping) =>
        mapping.blockId.startsWith('control-if-'),
      )!.blockId;
    if (kind === 'loop-branch') coverage[0].branch = 'while';
    if (kind === 'duplicate-branch') coverage.push(structuredClone(coverage[0]));
    if (kind === 'duplicate-valid-site') {
      coverage[0].siteKey = 'if.1';
      coverage[0].nodeId = ifs[1].nodeId;
    }
    await expect(decodeResult(buffer(changed), request)).rejects.toMatchObject({
      code: 'E_TRACE_INVALID',
    });
  });
});
