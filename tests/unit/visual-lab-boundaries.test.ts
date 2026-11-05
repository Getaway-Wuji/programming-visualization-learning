import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init, { execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import {
  decodeAdvancedResult,
  encodeAdvancedRequest,
  type AdvancedRequest,
  type AdvancedState,
} from '../../web/src/engine/advanced-protocol';
import { AdvancedPlayer } from '../../web/src/engine/advanced-player';
import { visualModules } from '../../web/src/visual-lab/catalog';
import { parseVisualInput, type VisualDraft } from '../../web/src/visual-lab/input';
import {
  teachingStartCursor,
  teachingStops,
  teachingEndCursor,
} from '../../web/src/visual-lab/stops';

beforeAll(async () => {
  await init({ module_or_path: readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm') });
});
async function run(slug: string, draft: VisualDraft) {
  const spec = visualModules.find((s) => s.slug === slug)!;
  const parsed = parseVisualInput(spec, { ...spec.defaults, ...draft });
  expect(parsed.issue).toBe('');
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
    input: { kind: 'integers', values: parsed.values },
  };
  const bytes = execute_advanced(encodeAdvancedRequest(request), '1'.repeat(64), 1000);
  const result = await decodeAdvancedResult(Uint8Array.from(bytes).buffer, request, '1'.repeat(64));
  expect(result.terminal).toMatchObject({ status: 'completed', code: null, returnValue: 0 });
  const player = new AdvancedPlayer();
  player.accept(result);
  player.seek(result.trace!.steps.length);
  const completeOutput = player.snapshot().state!.output;
  player.seek(teachingEndCursor(source, result));
  expect(player.snapshot().state!.output).toBe(completeOutput);
  return { state: player.snapshot().state!, result, source };
}
const cells = (state: AdvancedState, name: string) => {
  const o = state.objects.find((o) => o.name === name && o.typeName === 'int')!;
  return Array.from({ length: o.length }, (_, i) => {
    const value = o.cells.find((c) => c.byteOffset === i * 4)?.value;
    return typeof value === 'number' ? value : o.zeroInitialized ? 0 : null;
  });
};
for (const slug of [
  'bubble',
  'selection',
  'insertion',
  'quick',
  'merge',
  'shell',
  'heap-sort',
  'counting',
  'radix',
])
  it(`${slug} handles empty, duplicate and boundary inputs`, async () => {
    for (const values of [
      '[]',
      '0 0 0',
      '12 1 12 0 5 2 3 4 6 7 8 9',
      ...(['counting', 'radix'].includes(slug) ? [] : ['-9 0 -9 8 -2']),
    ]) {
      const input = values === '[]' ? [] : values.split(' ').map(Number);
      const { state } = await run(slug, { values });
      expect(state.output).toBe(
        input.length
          ? input
              .slice()
              .sort((a, b) => a - b)
              .join(' ') + ' \n'
          : '\n',
      );
    }
  });
it('queue, stack and circular queue keep empty/full and wraparound behavior in Rust', async () => {
  for (const slug of ['stack', 'queue', 'circular-queue', 'priority-queue']) {
    expect((await run(slug, { operations: '出\n入 1\n出\n出' })).state.output).toBe(
      'empty 1 empty \n',
    );
    const operations = Array.from({ length: 9 }, (_, i) => `入 ${i}`).join('\n') + '\n出';
    expect((await run(slug, { operations })).state.output).toBe(
      slug === 'stack' || slug === 'priority-queue' ? 'full 7 \n' : 'full 0 \n',
    );
  }
  expect(
    (
      await run('circular-queue', {
        operations: '入 1\n入 2\n入 3\n出\n出\n入 4\n入 5\n入 6\n入 7\n入 8\n入 9\n出',
      })
    ).state.output,
  ).toBe('1 2 3 \n');
});
it('array and both linked lists handle insertion, deletion and reversal without inventing links', async () => {
  for (const slug of ['array', 'linked-list', 'doubly-linked-list']) {
    expect(
      (await run(slug, { values: '[]', action: '1', position: '0', value: '9' })).state.output,
    ).toBe('9 \n');
    expect((await run(slug, { values: '3 6 9', action: '2', position: '0' })).state.output).toBe(
      '6 9 \n',
    );
    expect((await run(slug, { values: '3 6 9', action: '3' })).state.output).toBe('9 6 3 \n');
  }
  expect((await run('array', { values: '3 6 9', action: '4', value: '6' })).state.output).toBe(
    '1\n',
  );
  expect((await run('array', { values: '[]', action: '4', value: '6' })).state.output).toBe('-1\n');
});
it('graphs distinguish BFS/DFS, directed cycles and unreachable nodes', async () => {
  const graph = { number: '4', edges: '0 1 1\n0 2 1\n1 3 1', start: '0' };
  expect((await run('bfs-dfs', { ...graph, order: '1' })).state.output).toBe('0 1 2 3 \n');
  expect((await run('bfs-dfs', { ...graph, order: '2' })).state.output).toBe('0 1 3 2 \n');
  expect((await run('topological', { number: '2', edges: '0 1 1\n1 0 1' })).state.output).toBe(
    'cycle\n',
  );
  expect((await run('dijkstra', { number: '3', edges: '0 1 4', start: '0' })).state.output).toBe(
    '0 4 inf \n',
  );
  for (const slug of ['prim', 'kruskal'])
    expect((await run(slug, { number: '3', edges: '0 1 4', start: '0' })).state.output).toBe(
      'disconnected\n',
    );
});
it('DP and strings handle zero and maximum shapes, and table writes remain visible teaching stops', async () => {
  for (const slug of ['01-knapsack', 'complete-knapsack']) {
    expect((await run(slug, { capacity: '0', items: '2 8' })).state.output).toBe('0\n');
    expect((await run(slug, { capacity: '8', items: '1 2\n2 5\n3 7\n4 10' })).state.output).toBe(
      slug === '01-knapsack' ? '19\n' : '20\n',
    );
  }
  expect((await run('lcs', { text: '', pattern: 'abcdefgh' })).state.output).toBe('0\n');
  expect((await run('edit-distance', { text: '', pattern: 'abcdefgh' })).state.output).toBe('8\n');
  expect((await run('kmp', { text: 'aaaaaaaa', pattern: 'aa' })).state.output).toBe(
    '0 1 2 3 4 5 6 \n',
  );
  expect((await run('lis', { values: '[]' })).state.output).toBe('0\n');
  expect((await run('lis', { values: '4 4 4 4' })).state.output).toBe('1\n');
  const { state, result, source } = await run('stairs', { number: '12' });
  expect(state.output).toBe('233\n');
  const dp = state.objects.findLast((o) => o.name === 'dp')!;
  const start = teachingStartCursor(source, result);
  expect(start).toBeGreaterThan(0);
  expect(
    teachingStops(source, result).some(
      (cursor) =>
        cursor > start &&
        result.trace!.steps[cursor - 1].changes.some(
          (c) => c.op === 'cell' && c.objectId === dp.id,
        ),
    ),
  ).toBe(true);
});
it('Hanoi emitted moves remain legal, solve the requested tower and reverse exactly', async () => {
  for (const n of [0, 1, 5]) {
    const { state } = await run('hanoi', { number: String(n) });
    const rods = [Array.from({ length: n }, (_, i) => n - i), [] as number[], [] as number[]];
    const moves = state.output.trim() ? state.output.trim().split('\n') : [];
    expect(moves).toHaveLength(2 ** n - 1);
    for (const move of moves) {
      const [from, to] = move.split(' ').map((v) => Number(v) - 1);
      const disk = rods[from].pop()!;
      expect(disk).toBeGreaterThan(0);
      if (rods[to].length) expect(disk).toBeLessThan(rods[to].at(-1)!);
      rods[to].push(disk);
    }
    expect(rods).toEqual([[], [], Array.from({ length: n }, (_, i) => n - i)]);
  }
});
it('red-black rotations preserve the root, red-child and black-height invariants', async () => {
  for (const values of ['1 2 3 4 5 6 7', '7 6 5 4 3 2 1', '8 4 12 2 6 10 14']) {
    const { state } = await run('rbtree', { values });
    const a = cells(state, 'a'),
      left = cells(state, 'left'),
      right = cells(state, 'right'),
      red = cells(state, 'red');
    const root = cells(state, 'root')[0]!;
    expect(red[root]).toBe(0);
    const visited = new Set<number>();
    const walk = (node: number, min: number, max: number): number => {
      if (node === -1) return 1;
      expect(visited.has(node)).toBe(false);
      visited.add(node);
      expect(a[node]).toBeGreaterThanOrEqual(min);
      expect(a[node]).toBeLessThanOrEqual(max);
      if (red[node] === 1) {
        if (left[node] !== -1) expect(red[left[node]!]).toBe(0);
        if (right[node] !== -1) expect(red[right[node]!]).toBe(0);
      }
      const l = walk(left[node]!, min, a[node]!),
        r = walk(right[node]!, a[node]!, max);
      expect(l).toBe(r);
      return l + (red[node] === 0 ? 1 : 0);
    };
    walk(root, -Infinity, Infinity);
    expect(visited.size).toBe(7);
  }
});
