import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { execute_c6 } from '../../web/src/generated/c6-teaching/c_viz_c6';
import { engineBuild } from '../../web/src/generated/c6-teaching/engine-build';
import { c6RunRequest } from '../../web/src/engine/c6-client';
import { canonicalC6Json, decodeC6Response, type C6Result } from '../../web/src/engine/c6-protocol';
import { C6Player } from '../../web/src/engine/c6-player';

interface Fixture {
  id: string;
  mode: 'execute' | 'diagnostic' | 'reading';
  files: { name: string; source: string }[];
  input: string;
  expectedStdout: string;
  expectedReturn: number;
  expectedCode?: string | null;
  businessExpectedStdout?: string;
}
beforeAll(async () => {
  await init({ module_or_path: readFileSync('web/src/generated/c6-teaching/c_viz_c6_bg.wasm') });
});
describe('real reviewed C6 build regressions through the strict frontend protocol', () => {
  it.each([
    ['type-qualifier-collision', 7],
    ['structure-initialization', 8],
    ['fixed-character-parameters', 37],
  ] as const)('executes %s and restores every real prefix', async (name, count) => {
    const fixtures = JSON.parse(readFileSync(`tests/fixtures/c6/${name}.json`, 'utf8')) as {
      programs: Fixture[];
    };
    expect(fixtures.programs).toHaveLength(count);
    const failures: string[] = [];
    for (const fixture of fixtures.programs) {
      try {
        const began = performance.now();
        const request = await c6RunRequest(fixture.files[0].source, fixture.input);
        const guard = () => expect(performance.now() - began).toBeLessThan(1000);
        const raw = execute_c6(
          new TextEncoder().encode(canonicalC6Json(request)),
          engineBuild.wasmSha256,
          Math.max(0, 1000 - Math.ceil(performance.now() - began)),
        ).slice();
        const result = (await decodeC6Response(
          raw.buffer,
          request,
          engineBuild.wasmSha256,
          guard,
        )) as C6Result;
        if (fixture.mode === 'reading') {
          expect(result.terminal.code).not.toBeNull();
          expect(result.trace).toBeNull();
          guard();
          continue;
        }
        expect(result.terminal.code).toBe(
          fixture.mode === 'diagnostic' ? fixture.expectedCode : null,
        );
        if (result.terminal.code === null) {
          expect(result.terminal.status).toBe('completed');
          expect(result.terminal.returnValue).toBe(fixture.expectedReturn);
        }
        if (result.trace === null) {
          expect(fixture.mode).toBe('diagnostic');
          expect(fixture.expectedStdout).toBe('');
          guard();
          continue;
        }
        const player = new C6Player(result);
        const snapshots = [canonicalC6Json(player.state)];
        for (let cursor = 1; cursor <= result.trace.steps.length; ++cursor) {
          player.seek(cursor);
          snapshots.push(canonicalC6Json(player.state));
        }
        expect(player.state.output).toBe(fixture.expectedStdout);
        if (fixture.businessExpectedStdout !== undefined)
          expect(player.state.output).not.toBe(fixture.businessExpectedStdout);
        for (let cursor = result.trace.steps.length; cursor >= 0; --cursor) {
          player.seek(cursor);
          expect(canonicalC6Json(player.state)).toBe(snapshots[cursor]);
        }
        guard();
      } catch (error) {
        failures.push(`${fixture.id}: ${String(error)}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
