import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name: string) =>
  readFileSync(new URL(`../../shared/fixtures/memory/${name}`, import.meta.url), 'utf8');
const pointers = fixture('pointers.c');
const dangling = fixture('dangling.c');
const list = fixture('list.cpp');
const tree = fixture('tree.cpp');
const buckets = fixture('buckets.cpp');

test.beforeEach(async ({ page }) => {
  await page.goto('/memory-harness.html');
  await page.waitForFunction(() => Boolean(window.memoryTest));
});
async function execute(page: Page, source: string, language: 'c' | 'cpp', input: number[] = []) {
  return page.evaluate(
    ({ source, language, input }) => window.memoryTest.run(source, language, input),
    { source, language, input },
  );
}
async function restored(page: Page) {
  const replay = await page.evaluate(() => window.memoryTest.replay());
  expect(replay.restored).toBe(true);
  return replay.last.state!;
}

test('C pointers update the real caller and source edits preserve UTF8 locations', async ({
  page,
}) => {
  const source = '// 中😀\r\n' + pointers.replaceAll('\n', '\r\n');
  const first = await execute(page, source, 'c');
  expect(first.result.terminal.status).toBe('completed');
  expect((await restored(page)).output).toBe('9 6\n');
  const changed = await execute(page, source.replace('set(p, 9)', 'set(p, 7)'), 'c');
  expect(changed.result.identity.runId).not.toBe(first.result.identity.runId);
  expect((await restored(page)).output).toBe('7 6\n');
  const bytes = new TextEncoder().encode(source.replace('set(p, 9)', 'set(p, 7)'));
  for (const node of changed.result.nodeMap)
    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.slice(node.byteRange.start, node.byteRange.end),
      ),
    ).not.toThrow();
});

test('C invalid pointers keep a reversible prefix and explicit diagnostic', async ({ page }) => {
  for (const [source, code] of [
    ['int main(){int* p;return *p;}', 'E_UNINITIALIZED'],
    ['int main(){int* p=0;return *p;}', 'E_NULL_POINTER'],
    [dangling, 'E_DANGLING_POINTER'],
    ['int main(){int a[2]={1,2};int* p=&a[0]+2;return *p;}', 'E_POINTER_BOUNDS'],
    ['int main(){int a[2];int* p=&a[0];p=p+3;return 0;}', 'E_POINTER_BOUNDS'],
  ]) {
    const run = await execute(page, source, 'c');
    expect(run.result.terminal).toMatchObject({ code, status: 'error' });
    expect(run.result.trace!.completeness).toBe('prefix');
    await restored(page);
  }
});

test('C++ linked nodes are rewired and deleted through genuine object references', async ({
  page,
}) => {
  for (const input of [
    [4, 2, 9],
    [0, 0, 0],
  ]) {
    const run = await execute(page, list, 'cpp', input);
    expect(run.result.terminal.status).toBe('completed');
    const state = await restored(page);
    expect(state.output).toBe(`${input.join(' ')} \n${input[0]} ${input[2]} \n`);
    const heap = state.objects.filter((object) => object.storage === 'heap');
    expect(heap).toHaveLength(3);
    expect(heap.every((object) => !object.alive && object.cells.length === 0)).toBe(true);
    expect(run.result.trace!.steps.filter((step) => step.kind === 'memory.release')).toHaveLength(
      3,
    );
  }
});

test('C++ BST uses pointer returns and recursion for varied input and changed source', async ({
  page,
}) => {
  for (const values of [
    [],
    [5],
    [3, 1, 4, 1, 5],
    [-2, 7, 0, -9],
    Array.from({ length: 29 }, (_, index) => index),
    Array.from({ length: 29 }, (_, index) => 28 - index),
  ]) {
    const run = await execute(page, tree, 'cpp', [values.length, ...values]);
    expect(run.result.terminal.status).toBe('completed');
    expect((await restored(page)).output).toBe(
      values.length ? [...values].sort((a, b) => a - b).join(' ') + ' \n' : '\n',
    );
    if (values.length === 29)
      await test.info().attach(`bst-29-${values[0]}`, {
        body: JSON.stringify({ steps: run.result.trace!.steps.length, elapsedMs: run.elapsedMs }),
        contentType: 'application/json',
      });
  }
  const run = await execute(
    page,
    tree.replace('value < root->value', 'value > root->value'),
    'cpp',
    [3, 1, 3, 2],
  );
  expect(run.result.terminal.status).toBe('completed');
  expect((await restored(page)).output).toBe('3 2 1 \n');
});

test('C++ bucket arrays traverse and delete actual linked nodes', async ({ page }) => {
  for (const values of [[], [5], [8, 1, 4, 0, 3, 7]]) {
    const run = await execute(page, buckets, 'cpp', [values.length, ...values]);
    expect(run.result.terminal.status).toBe('completed');
    const state = await restored(page);
    expect(state.output).toBe(
      values.length ? [...values].sort((a, b) => a - b).join(' ') + ' \n' : '\n',
    );
    expect(state.objects.filter((object) => object.storage === 'heap')).toHaveLength(values.length);
    expect(state.allocator.liveBytes).toBe(0);
  }
});

test('C++ lifetime, delete and field provenance failures stay reversible', async ({ page }) => {
  for (const [source, code] of [
    ['int main(){int* p=new int;return *p;}', 'E_UNINITIALIZED'],
    ['int main(){int* p=new int{};delete p;return *p;}', 'E_DANGLING_POINTER'],
    ['int main(){int* p=new int{};delete p;delete p;return 0;}', 'E_DOUBLE_DELETE'],
    ['int main(){int x;int* p=&x;delete p;return 0;}', 'E_INVALID_DELETE'],
    ['int main(){int* p=new int{};p=p+1;delete p;return 0;}', 'E_INVALID_DELETE'],
    [
      'struct Pair{int a;int b;};int main(){Pair p{};int* q=&p.a;q=q+1;return *q;}',
      'E_POINTER_BOUNDS',
    ],
  ]) {
    const run = await execute(page, source, 'cpp');
    expect(run.result.terminal).toMatchObject({ code, status: 'error' });
    await restored(page);
  }
  const zero = await execute(
    page,
    'int main(){int* p=new int{};int x=*p;delete p;int* q=nullptr;delete q;return x;}',
    'cpp',
  );
  expect(zero.result.terminal).toMatchObject({ status: 'completed', returnValue: 0 });
  await restored(page);
});

test('unsupported memory syntax and C++ syntax on the C path are rejected before execution', async ({
  page,
}) => {
  for (const [source, language] of [
    ['int main(){if(0){int* p=new int;}return 0;}', 'c'],
    ['int main(){int* p=nullptr;return 0;}', 'c'],
    ['int main(){int* p=4096;return 0;}', 'cpp'],
    ['int main(){int** p;return 0;}', 'cpp'],
    ['int main(){int* p=new int[2];delete[] p;return 0;}', 'cpp'],
    ['int main(){malloc(4);return 0;}', 'c'],
  ] as const) {
    const run = await execute(page, source, language);
    expect(run.result.terminal.status).toBe('error');
    expect(run.result.trace).toBeNull();
  }
});

test('heap limits preserve the full accepted state and original resource ceilings', async ({
  page,
}) => {
  const run = await execute(
    page,
    'int main(){int i=0;while(i<129){int* p=new int{};i=i+1;}return 0;}',
    'cpp',
  );
  expect(run.result.terminal).toMatchObject({ code: 'E_HEAP_LIMIT', status: 'limited' });
  const state = await restored(page);
  expect(state.objects.filter((object) => object.storage === 'heap' && object.alive)).toHaveLength(
    128,
  );
  expect(state.allocator.liveBytes).toBeLessThanOrEqual(1_048_576);
  await test.info().attach('heap-limit-real-wasm', {
    body: JSON.stringify({
      engine: run.result.engine,
      steps: run.result.trace!.steps.length,
      elapsedMs: run.elapsedMs,
    }),
    contentType: 'application/json',
  });
});

test('cancelling a genuine memory Worker invalidates it and a fresh run recovers', async ({
  page,
}) => {
  const report = await page.evaluate(async () => {
    const pending = window.memoryTest
      .run('int main(){while(1){int* p=new int{};delete p;}}', 'cpp')
      .then(
        () => 'unexpected-success',
        (error: Error) => error.message,
      );
    while (window.memoryTest.inspect().state === 'loading')
      await new Promise<void>((accept) => setTimeout(accept, 0));
    if (window.memoryTest.inspect().state !== 'running') throw new Error('No genuine Worker run');
    window.memoryTest.cancel();
    const cancelled = await pending;
    window.memoryTest.invalidate();
    const run = await window.memoryTest.run('int main(){int x=7;int* p=&x;return *p;}', 'c');
    return {
      cancelled,
      terminal: run.result.terminal,
      inspect: run.inspect,
      restored: window.memoryTest.replay().restored,
    };
  });
  expect(report.cancelled).toBe('E_CANCELLED');
  expect(report.terminal).toMatchObject({ status: 'completed', returnValue: 7 });
  expect(report.inspect.activeWorkers).toBe(0);
  expect(report.restored).toBe(true);
});
