import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { initSync, execute_memory } from '../../web/src/generated/memory/c_viz_memory';
import { engineBuild } from '../../web/src/generated/memory/engine-build';
import { memoryRequest } from '../../web/src/engine/memory-client';
import {
  encodeMemoryRequest,
  decodeMemoryResult,
  type MemoryRequest,
} from '../../web/src/engine/memory-protocol';
import { MemoryPlayer } from '../../web/src/engine/memory-player';
import { nodeCases, prepareNodeCase, parseNodeOperations } from '../../web/src/node-cases/content';
import {
  nodesView,
  mainScalar,
  objectValue,
  mainObject,
} from '../../web/src/node-cases/presentation';
beforeAll(() =>
  initSync({ module: readFileSync('web/src/generated/memory/c_viz_memory_bg.wasm') }),
);
async function real(request: MemoryRequest) {
  const bytes = execute_memory(encodeMemoryRequest(request), engineBuild.wasmSha256, 1000).slice();
  return decodeMemoryResult(bytes.buffer, request, engineBuild.wasmSha256);
}
type Tree = { value: number; left: Tree | null; right: Tree | null };
function insert(t: Tree | null, v: number): Tree {
  if (!t) return { value: v, left: null, right: null };
  if (v < t.value) t.left = insert(t.left, v);
  else t.right = insert(t.right, v);
  return t;
}
function values(t: Tree | null, kind: number): number[] {
  if (!t) return [];
  return [
    ...(kind === 3 ? [t.value] : []),
    ...values(t.left, kind),
    ...(kind === 4 ? [t.value] : []),
    ...values(t.right, kind),
    ...(kind === 5 ? [t.value] : []),
  ];
}
const samples = (s: (typeof nodeCases)[number]) => [
  { id: 'default', draft: s.defaultDraft },
  { id: 'no-ops', draft: '[]' },
  ...s.boundaryDrafts,
  ...(s.kind === 'list'
    ? [
        { id: 'single', draft: '插 0 -999\n遍历\n删 0\n遍历' },
        { id: 'duplicates', draft: '插 0 0\n插 1 0\n插 1 0\n遍历\n删 1\n遍历' },
        { id: 'max-in', draft: Array.from({ length: 10 }, (_, i) => `插 0 ${i}`).join('\n') },
        { id: 'max-alternate', draft: Array(6).fill('插 0 0\n删 0').join('\n') },
        { id: 'max-empty-traverse', draft: Array(30).fill('遍历').join('\n') },
      ]
    : [
        { id: 'single', draft: '插 0\n查 0\n前序\n中序\n后序' },
        { id: 'max-in', draft: Array.from({ length: 15 }, (_, i) => `插 ${i}`).join('\n') },
        {
          id: 'max-find',
          draft: [
            ...Array.from({ length: 7 }, (_, i) => `插 ${i}`),
            ...Array.from({ length: 8 }, (_, i) => `查 ${i}`),
          ].join('\n'),
        },
        { id: 'max-empty-traverse', draft: Array(10).fill('前序\n中序\n后序').join('\n') },
      ]),
];
for (const spec of nodeCases)
  for (const sample of samples(spec))
    it(`${spec.kind} ${sample.id}: real pointer graph, output, commits and full atomic reversal`, async () => {
      const prepared = prepareNodeCase(spec, sample.draft),
        request = memoryRequest(prepared.source, 'cpp', prepared.input),
        result = await real(request);
      expect(request.source).toBe(
        readFileSync(spec.sourceFile, 'utf8').replace('{{n}}', String(prepared.input.length)),
      );
      expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 0, code: null });
      expect(result.trace!.completeness).toBe('complete');
      const player = new MemoryPlayer();
      player.accept(result);
      const initial = player.snapshot(),
        array: number[] = [],
        unique = new Set<number>();
      let tree: Tree | null = null,
        offset = 0,
        processed = 0,
        output = '',
        maxFrames = 0,
        maxHeap = 0,
        allocated = 0;
      for (let i = 1; i <= result.trace!.steps.length; i++) {
        player.seek(i);
        const state = player.snapshot().state!,
          step = result.trace!.steps[i - 1],
          view = nodesView(state, result.types, spec, step);
        maxFrames = Math.max(maxFrames, state.frames.length);
        maxHeap = Math.max(maxHeap, view.nodes.length);
        expect(view.nodes.length).toBeLessThanOrEqual(7);
        expect(view.nodes.map((n) => n.object.id)).toEqual(
          state.objects
            .filter((o) => o.alive && o.storage === 'heap' && o.typeName === 'Node')
            .map((o) => o.id),
        );
        for (const n of view.nodes) {
          expect(n.object.alive).toBe(true);
          expect(n.object.byteLength).toBe(spec.kind === 'list' ? 12 : 20);
          for (const f of n.fields) {
            const fieldType = result.types
              .find((t) => t.name === 'Node')!
              .fields.find((t) => t.name === f.name)!;
            const explicit = n.object.cells.find((c) => c.byteOffset === fieldType.byteOffset);
            const raw = explicit
              ? explicit.value
              : n.object.zeroInitialized
                ? {
                    objectId: null,
                    byteOffset: 0,
                    lowerBound: 0,
                    upperBound: 0,
                    pointeeType: 'Node',
                  }
                : null;
            expect(f.value).toEqual(raw);
            if (f.kind === 'valid') {
              expect(f.value!.pointeeType).toBe('Node');
              expect(state.objects.find((o) => o.id === f.value!.objectId)!.alive).toBe(true);
            }
          }
        }
        for (const dead of view.ended) expect(dead.cells).toEqual([]);
        if (step.kind === 'memory.allocate') allocated++;
        const done = mainScalar(state, result.types, 'processed');
        if (done === null || done === processed) continue;
        expect(done).toBe(processed + 1);
        const code = prepared.input[offset++];
        let outcome: number;
        if (spec.kind === 'list') {
          if (code === 1) {
            const pos = prepared.input[offset++],
              value = prepared.input[offset++];
            if (pos < 0 || pos > array.length) {
              output += `RANGE ${pos}\n`;
              outcome = 5;
            } else if (array.length === 7) {
              output += `FULL ${value}\n`;
              outcome = 4;
            } else {
              array.splice(pos, 0, value);
              output += `INSERT ${value}\n`;
              outcome = 1;
            }
          } else if (code === 2) {
            const pos = prepared.input[offset++];
            if (pos < 0 || pos >= array.length) {
              output += `RANGE ${pos}\n`;
              outcome = 5;
            } else {
              const [v] = array.splice(pos, 1);
              output += `DELETE ${v}\n`;
              outcome = 2;
            }
          } else {
            output += 'LIST' + array.map((v) => ' ' + v).join('') + '\n';
            outcome = 3;
          }
          const order: number[] = [],
            byId = new Map(view.nodes.map((n) => [n.object.id, n]));
          let id = view.anchor.value?.objectId;
          const seen = new Set<string>();
          while (id) {
            expect(seen.has(id)).toBe(false);
            seen.add(id);
            const n = byId.get(id)!;
            expect(n).toBeDefined();
            order.push(n.value as number);
            id = n.fields[0].value?.objectId;
          }
          expect(order).toEqual(array);
          expect(view.size).toBe(array.length);
          expect(view.nodes.length).toBe(array.length);
        } else {
          if (code === 1) {
            const v = prepared.input[offset++];
            if (unique.has(v)) {
              output += `DUP ${v}\n`;
              outcome = 6;
            } else if (unique.size === 7) {
              output += `FULL ${v}\n`;
              outcome = 4;
            } else {
              unique.add(v);
              tree = insert(tree, v);
              output += `INSERT ${v}\n`;
              outcome = 1;
            }
          } else if (code === 2) {
            const v = prepared.input[offset++];
            const found = unique.has(v);
            output += `${found ? 'FOUND' : 'MISS'} ${v}\n`;
            outcome = found ? 7 : 8;
          } else {
            output +=
              { 3: 'PRE', 4: 'IN', 5: 'POST' }[code]! +
              values(tree, code)
                .map((v) => ' ' + v)
                .join('') +
              '\n';
            outcome = 3;
          }
          const byId = new Map(view.nodes.map((n) => [n.object.id, n]));
          const check = (id: string | null | undefined, expected: Tree | null) => {
            if (!expected) {
              expect(id ?? null).toBeNull();
              return;
            }
            expect(id).toBeTruthy();
            const n = byId.get(id!)!;
            expect(n.value).toBe(expected.value);
            check(n.fields.find((f) => f.name === 'left')!.value?.objectId, expected.left);
            check(n.fields.find((f) => f.name === 'right')!.value?.objectId, expected.right);
          };
          check(view.anchor.value?.objectId, tree);
          expect(view.size).toBe(unique.size);
          expect(view.nodes.length).toBe(unique.size);
        }
        expect(view.outcome).toBe(outcome);
        expect(view.processed).toBe(done);
        expect(view.consumed).toBe(offset);
        expect(state.control.inputCursor).toBe(offset);
        expect(state.output).toBe(output);
        processed = done;
        if (processed % 3 === 0) {
          const saved = player.snapshot();
          player.seek(i - 1);
          player.seek(i);
          expect(player.snapshot()).toEqual(saved);
        }
      }
      expect(processed).toBe(prepared.operationCount);
      expect(offset).toBe(prepared.input.length);
      const end = player.snapshot().state!;
      expect(end.output).toBe(output + 'END\n');
      expect(end.frames).toEqual([]);
      expect(end.objects.every((o) => !o.alive && o.cells.length === 0)).toBe(true);
      expect(end.allocator.liveBytes).toBe(0);
      expect(allocated).toBeLessThanOrEqual(10);
      expect(maxHeap).toBeLessThanOrEqual(7);
      expect(maxFrames).toBeLessThanOrEqual(spec.kind === 'list' ? 2 : 9);
      for (let i = result.trace!.steps.length - 1; i >= 0; i--) player.seek(i);
      expect(player.snapshot()).toEqual(initial);
      expect(result.stats.fuelUsed).toBeLessThan(1000000);
    });
for (const spec of nodeCases)
  it(`${spec.kind} syntax only, exact budget and genuine malformed input failure`, async () => {
    for (const draft of [
      '',
      '插',
      '插 1e2',
      '插 1.5',
      '插 1000',
      'push 1',
      '[]\n前序',
      Array(31)
        .fill(spec.kind === 'list' ? '遍历' : '前序')
        .join('\n'),
    ])
      expect(parseNodeOperations(spec, draft).valid).toBe(false);
    expect(parseNodeOperations(spec, spec.kind === 'list' ? '插 -999 0' : '插 -0').valid).toBe(
      true,
    );
    const input = spec.kind === 'list' ? [1, -999, 0] : [1, 0];
    expect(
      parseNodeOperations(spec, spec.kind === 'list' ? '插 -999 -0' : '插 -0').encoded,
    ).toEqual(input);
    const bad = await real(
      memoryRequest(
        prepareNodeCase(spec, spec.kind === 'list' ? '遍历' : '前序').source,
        'cpp',
        [9],
      ),
    );
    expect(bad.terminal).toMatchObject({ status: 'completed', returnValue: 1 });
    const badPlayer = new MemoryPlayer();
    badPlayer.accept(bad);
    badPlayer.seek(bad.trace!.steps.length);
    expect(badPlayer.snapshot().state!.output).toBe('INVALID 9\n');
    const exhausted = await real(
      memoryRequest(
        prepareNodeCase(spec, spec.kind === 'list' ? '插 0 7' : '插 7').source,
        'cpp',
        [1],
      ),
    );
    expect(exhausted.terminal.code).toBe('E_INPUT_EXHAUSTED');
    expect(exhausted.trace!.completeness).toBe('prefix');
    const prefix = new MemoryPlayer();
    prefix.accept(exhausted);
    const start = prefix.snapshot();
    prefix.seek(exhausted.trace!.steps.length);
    prefix.seek(0);
    expect(prefix.snapshot()).toEqual(start);
    expect(objectValue(mainObject(start.state!, 'head'), exhausted.types)).toBeNull();
  });
