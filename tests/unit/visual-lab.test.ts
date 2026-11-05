import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import {
  encodeAdvancedRequest,
  decodeAdvancedResult,
  type AdvancedRequest,
} from '../../web/src/engine/advanced-protocol';
import { AdvancedPlayer } from '../../web/src/engine/advanced-player';
import { parseVisualInput } from '../../web/src/visual-lab/input';
import { visualModules } from '../../web/src/visual-lab/catalog';
import { teachingStops } from '../../web/src/visual-lab/stops';
import { stepLineRange } from '../../web/src/components/HighlightedCode';
import samples from '../fixtures/visual-lab-cases.json' with { type: 'json' };

const buildId = '1'.repeat(64);
beforeAll(async () => {
  await init({ module_or_path: readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm') });
});
describe('40 live algorithm modules', () => {
  for (const sample of samples)
    it(`${sample.slug}: independently expected output and exact reverse restoration`, async () => {
      const spec = visualModules.find((s) => s.slug === sample.slug)!;
      expect(parseVisualInput(spec, spec.defaults)).toEqual({ values: sample.values, issue: '' });
      const source = readFileSync(`content/algorithms/visual-lab/${spec.slug}.cpp`, 'utf8');
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
        input: { kind: 'integers', values: sample.values },
      };
      const bytes = execute_advanced(encodeAdvancedRequest(request), buildId, 1000);
      const result = await decodeAdvancedResult(Uint8Array.from(bytes).buffer, request, buildId);
      expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0, code: null });
      const player = new AdvancedPlayer();
      player.accept(result);
      const initial = player.snapshot().state;
      expect(player.seek(result.trace!.steps.length)).toBe(true);
      expect(player.snapshot().state?.output).toBe(sample.stdout);
      const stops = teachingStops(source, result);
      expect(stops.length).toBeLessThan(result.trace!.steps.length);
      for (let i = stops.length - 1; i >= 0; i--) expect(player.seek(stops[i])).toBe(true);
      expect(player.snapshot().state).toEqual(initial);
    });
  it('covers the reference inventory exactly and rejects unsafe or misleading input', () => {
    expect(visualModules).toHaveLength(40);
    expect(new Set(visualModules.map((s) => s.slug)).size).toBe(40);
    const get = (slug: string) => visualModules.find((s) => s.slug === slug)!;
    expect(parseVisualInput(get('binary'), { values: '3 1 2', target: '1' }).issue).toContain(
      '从小到大',
    );
    expect(parseVisualInput(get('kmp'), { text: 'abc', pattern: '' }).issue).not.toBe('');
    expect(parseVisualInput(get('counting'), { values: '-1 3' }).issue).not.toBe('');
    expect(parseVisualInput(get('01-knapsack'), { capacity: '8', items: '0 9' }).issue).not.toBe(
      '',
    );
    expect(
      parseVisualInput(get('dijkstra'), { number: '3', edges: '0 9 2', start: '0' }).issue,
    ).not.toBe('');
    expect(
      parseVisualInput(get('bfs-dfs'), { number: '3', edges: '0 1 2\n1 0 4', start: '0' }).issue,
    ).toContain('重复');
    expect(
      parseVisualInput(get('union-find'), { number: '3', operations: '合 0 3' }).issue,
    ).not.toBe('');
  });
  it.each(['\n', '\r\n', '\r'])(
    'highlights one statement with %j line endings, excluding braces',
    (newline) => {
      const source = ['for (int i = 0; i < 2; i = i + 1) {', '    a[i] = 3;', '}', ''].join(
        newline,
      );
      const bytes = new TextEncoder();
      const start = bytes.encode(source.slice(0, source.indexOf('a[i]'))).length;
      const range = stepLineRange(source, { start, end: start + 9 });
      expect(source.slice(range!.utf16Range.start, range!.utf16Range.end)).toBe('    a[i] = 3;');
      const brace = source.indexOf('{');
      expect(stepLineRange(source, { start: brace, end: source.length - 1 })).toBeNull();
      expect(
        stepLineRange(source, { start: source.lastIndexOf('}'), end: source.lastIndexOf('}') + 1 }),
      ).toBeNull();
    },
  );
});
