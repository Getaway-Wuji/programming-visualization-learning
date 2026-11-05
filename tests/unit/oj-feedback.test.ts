import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { execute_c6 } from '../../web/src/generated/c6/c_viz_c6';
import advancedInit, { execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import { engineBuild } from '../../web/src/generated/c6/engine-build';
import { c6RunRequest } from '../../web/src/engine/c6-client';
import {
  decodeC6Response,
  encodeC6Request,
  type C6JudgeRequest,
} from '../../web/src/engine/c6-protocol';
import {
  decodeAdvancedResult,
  encodeAdvancedRequest,
  type AdvancedRequest,
} from '../../web/src/engine/advanced-protocol';
import { AdvancedPlayer } from '../../web/src/engine/advanced-player';
import { c6OutputVerdict } from '../../web/src/c6-learning/output-policy';
import { outputsMatch } from '../../web/src/practice/output-policy';
import { teachingStops, teachingSwapGroups } from '../../web/src/visual-lab/stops';
import samples from '../fixtures/visual-lab-cases.json' with { type: 'json' };
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { CompletionContext } from '@codemirror/autocomplete';
import { codeCompletions } from '../../web/src/components/code-completions';

beforeAll(async () => {
  await init({ module_or_path: readFileSync('web/src/generated/c6/c_viz_c6_bg.wasm') });
  await advancedInit({
    module_or_path: readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm'),
  });
});
describe('OJ output policy', () => {
  it.each([
    ['1 2 \n3  \n\n', '1 2\n3\n', true],
    ['1', '1\n', true],
    ['1\r\n2\t \r\n', '1\n2', true],
    ['1  2', '1 2', false],
    [' 1', '1', false],
    ['1\n\n2', '1\n2', false],
    ['12', '1 2', false],
    ['1\n3', '1\n2', false],
  ])('compares %j and %j as %s', (actual, expected, equal) =>
    expect(outputsMatch(actual, expected)).toBe(equal),
  );
  it.each(['%d', '%d ', '%d  \\n\\n', '%d\\n'])(
    'accepts actual Rust output format %j without rewriting raw flags',
    async (format) => {
      const run = await c6RunRequest(
        `#include <stdio.h>\nint f(int x){return 5*x+1;}int main(){int n;scanf("%d",&n);printf("${format}",f(n));return 0;}`,
      );
      const { input, ...common } = run;
      void input;
      const request: C6JudgeRequest = {
        ...common,
        judgeVersion: '2.0.0',
        profileRef: { id: 'judge.c6.s9.1.3', version: '1.0.0' },
        packageRef: { id: 'content.c.primer6', version: '1.0.0' },
      };
      const result = await decodeC6Response(
        execute_c6(encodeC6Request(request), engineBuild.wasmSha256, 1000).slice().buffer,
        request,
        engineBuild.wasmSha256,
      );
      if (!('cases' in result)) throw Error('judge required');
      const original = JSON.stringify(result);
      expect(c6OutputVerdict(result).status).toBe('passed');
      if (format !== '%d\\n') expect(result.status).toBe('failed');
      expect(JSON.stringify(result)).toBe(original);
    },
  );
  it.each(['f(n)+1', '7', 'n'])(
    'still rejects wrong data or missing teaching evidence: %s',
    async (expression) => {
      const run = await c6RunRequest(
        `#include <stdio.h>\nint f(int x){return 5*x+1;}int main(){int n;scanf("%d",&n);printf("%d ",${expression});return 0;}`,
      );
      const { input, ...common } = run;
      void input;
      const request: C6JudgeRequest = {
        ...common,
        judgeVersion: '2.0.0',
        profileRef: { id: 'judge.c6.s9.1.3', version: '1.0.0' },
        packageRef: { id: 'content.c.primer6', version: '1.0.0' },
      };
      const result = await decodeC6Response(
        execute_c6(encodeC6Request(request), engineBuild.wasmSha256, 1000).slice().buffer,
        request,
        engineBuild.wasmSha256,
      );
      if (!('cases' in result)) throw Error('judge required');
      expect(c6OutputVerdict(result).status).toBe('failed');
    },
  );
});
describe('complete swap presentation from actual Rust deltas', () => {
  it.each(['bubble', 'selection', 'quick', 'heap-sort', 'array', 'priority-queue'])(
    '%s has no visible partial swap, in either direction',
    async (slug) => {
      const source = readFileSync(`content/algorithms/visual-lab/${slug}.cpp`, 'utf8');
      const request: AdvancedRequest = {
        execVersion: '1.4.0',
        dslVersion: '1.3.0',
        diagnosticVersion: '1.3.0',
        integerEncoding: '1.0.0',
        language: 'cpp',
        engineId: 'engine.rust.advanced',
        runId: crypto.randomUUID(),
        sourceRevision: crypto.randomUUID(),
        source,
        input: {
          kind: 'integers',
          values:
            slug === 'array'
              ? [4, 8, 3, 6, 2, 3, 0, 0]
              : samples.find((row) => row.slug === slug)!.values,
        },
      };
      const result = await decodeAdvancedResult(
        execute_advanced(encodeAdvancedRequest(request), '1'.repeat(64), 1000).slice().buffer,
        request,
        '1'.repeat(64),
      );
      const groups = teachingSwapGroups(source, result),
        stops = teachingStops(source, result);
      expect(groups.length).toBeGreaterThan(0);
      const player = new AdvancedPlayer();
      player.accept(result);
      for (const group of groups) {
        expect(stops.filter((cursor) => cursor > group.start && cursor < group.end)).toEqual([]);
        player.seek(group.start);
        const before = structuredClone(player.snapshot().state!);
        player.seek(group.end);
        const after = structuredClone(player.snapshot().state!);
        const a = before.objects.find((row) => row.name === 'a' && row.alive)!;
        const b = after.objects.find((row) => row.id === a.id)!;
        const values = (object: typeof a) => object.cells.map((cell) => cell.value).sort();
        expect(values(b)).toEqual(values(a));
        player.seek(group.start);
        expect(player.snapshot().state).toEqual(before);
        player.seek(group.end);
        expect(player.snapshot().state).toEqual(after);
      }
    },
  );
});
describe('supported code suggestions', () => {
  const complete = (text: string, dialect: 'c6' | 'c' | 'cpp' = 'c6') =>
    codeCompletions(dialect)(
      new CompletionContext(
        EditorState.create({ doc: text, extensions: [cpp()] }),
        text.length,
        false,
      ),
    );
  it('suggests known variables and supported functions', () => {
    const options = complete('int count = 3;\nco')!.options.map((row) => row.label);
    expect(options).toContain('count');
    expect(complete('pri')!.options.some((row) => row.label === 'printf')).toBe(true);
    expect(complete('sca')!.options.some((row) => row.label === 'scanf')).toBe(true);
    expect(complete('ma')!.options.some((row) => row.label === 'malloc')).toBe(false);
    expect(complete('sca', 'c')!.options.some((row) => row.label === 'scanf')).toBe(false);
    expect(complete('co', 'cpp')!.options.some((row) => row.label === 'cout')).toBe(true);
  });
  it('does not interrupt strings or comments', () => {
    expect(complete('// pri')).toBeNull();
    expect(complete('printf("pri')).toBeNull();
  });
});
