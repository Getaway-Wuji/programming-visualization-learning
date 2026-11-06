import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/java-semantics.json', import.meta.url), 'utf8'),
) as {
  id: string;
  source: string;
  input: string;
  expectedStatus: string;
  expectedStdout: string;
  expectedDiagnostic: string | null;
}[];
const programs = JSON.parse(
  readFileSync(new URL('../fixtures/java-reference.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const main = (body: string) =>
  'public class Main { public static void main(String[] args) { ' + body + ' } }';

test.beforeEach(async ({ page }) => {
  await page.goto('/checks/java.html');
  await page.waitForFunction(() => Boolean(window.javaHarness));
});

for (const vector of vectors) {
  test(`Java WASM / ${vector.id}`, async ({ page }) => {
    const result = await page.evaluate(
      ({ source, input }) => window.javaHarness.run(source, input),
      vector,
    );
    expect(result.terminal.status).toBe(vector.expectedStatus);
    expect(result.terminal.diagnostic?.code ?? null).toBe(vector.expectedDiagnostic);
    expect(result.end?.state.output ?? '').toBe(vector.expectedStdout);
    expect(result.initial?.state.frames ?? []).toEqual([]);
    expect(result.initial?.state.objects ?? {}).toEqual({});
    expect(result.proof?.request.language).toBe('java');
    expect(result.proof?.wasmPages).toBeGreaterThan(0);
    expect(result.proof?.wasmPages).toBeLessThanOrEqual(2048);
  });
}

for (const [name, source] of Object.entries(programs)) {
  test(`Java WASM judges four cases / ${name}`, async ({ page }) => {
    const result = await page.evaluate(
      ({ source, name }) => window.javaHarness.judge(source, 'java.practice.' + name),
      { source, name },
    );
    expect(result.status).toBe('passed');
    expect(result.cases.map((item) => item.caseKey)).toEqual([1, 2, 3, 4]);
    for (const group of result.cases) {
      expect(group.terminal.status).toBe('completed');
      expect(group.stdoutMatches).toBe(true);
      expect(group.observationMatches).toBe(true);
      expect(group.observations.length).toBeGreaterThan(0);
      expect(group.initial?.state.control.inputCursor).toBe(0);
    }
  });
}

test('checkpoint, scopes, arrays, objects and output reverse completely', async ({ page }) => {
  const source =
    main(
      'int[] a = new int[1]; int[] b = a; Cell c = new Cell(); c.next = c; int i = 0; while (i < 50) { b[0] = b[0] + 1; i++; } c.value = a[0]; System.out.println(c.next.value);',
    ) + ' class Cell { Cell next; int value; }';
  const run = await page.evaluate((code) => window.javaHarness.run(code, ''), source);
  expect(run.terminal.status).toBe('completed');
  expect(run.terminal.cursor).toBeGreaterThan(128);
  expect(run.end?.state.output).toBe('50\n');
  expect(run.end?.state.frames).toEqual([]);
  expect(run.nearEnd?.state.frames).toHaveLength(1);
  expect(run.initial?.state).toEqual({
    frames: [],
    objects: {},
    output: '',
    control: { nodeId: null, path: [], inputCursor: 0 },
    allocator: { objects: 0, frames: 0, liveBytes: 0 },
    counters: { writes: 0, calls: 0, comparisons: 0 },
  });
});

test('zero-divide position uses original UTF-8 and retains actual output', async ({ page }) => {
  const source =
    '\uFEFFpublic class Main {\r\npublic static void main(String[] args) {\r\nSystem.out.print("雨🙂");\r\nint zero = 0; System.out.println(1 / zero);\r\n}}';
  const run = await page.evaluate((code) => window.javaHarness.run(code, ''), source);
  expect(run.terminal.diagnostic?.code).toBe('E_JAVA_ZERO_DIVISION');
  expect(run.end?.state.output).toBe('雨🙂');
  const range = run.terminal.diagnostic!.byteRange;
  expect(Buffer.from(source).subarray(range.start, range.end).toString('utf8')).toBe('1 / zero');
});

test('budget termination returns a reversible prefix and next run works', async ({ page }) => {
  const source = main('int i = 0; while (true) { i++; }');
  const run = await page.evaluate((code) => window.javaHarness.run(code, ''), source);
  expect(run.terminal.diagnostic?.code).toBe('E_STEP_LIMIT');
  expect(run.terminal.cursor).toBe(20000);
  expect(run.initial?.state.frames).toEqual([]);
  await page.route(
    '**/java-worker-*.js',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue().catch(() => {});
    },
    { times: 1 },
  );
  const short = main('System.out.println(7);');
  const delayed = await page.evaluate(
    (code) => window.javaHarness.run(code, '').catch((error: Error) => error.message),
    short,
  );
  expect(delayed).toBe('E_DEADLINE');
  const next = await page.evaluate((code) => window.javaHarness.run(code, ''), short);
  expect(next.end?.state.output).toBe('7\n');
});

test('hardcoded correct outputs fail observed short circuit', async ({ page }) => {
  const source =
    'import java.util.Scanner; ' +
    main(
      'Scanner scan = new Scanner(System.in); int x = scan.nextInt(); if (x == 7) { System.out.println(true); } else { System.out.println(false); }',
    );
  const result = await page.evaluate(
    (code) => window.javaHarness.judge(code, 'java.practice.short-circuit'),
    source,
  );
  expect(result.status).toBe('failed');
  expect(result.cases.every((item) => item.stdoutMatches && !item.observationMatches)).toBe(true);
});

test('edit mapping distinguishes mapped, code-only, invalid and unsupported', async ({ page }) => {
  const sources = [
    main('int n = 4; while (n > 0) { n = n - 1; } System.out.println(n);'),
    main('int[] a = new int[1]; System.out.println(a.length);'),
    main('int n = ;'),
    main('System.exit(0);'),
  ];
  const results = await page.evaluate(async (codes) => {
    const results = [];
    for (const code of codes) results.push(await window.javaHarness.edit(code));
    return results;
  }, sources);
  expect(results.map(({ result }) => result.kind === 'edit' && result.status)).toEqual([
    'mapped',
    'code-only',
    'invalid',
    'unsupported',
  ]);
  if (results[0].result.kind !== 'edit') throw new Error('Wrong result');
  expect(results[0].result.blockMap).toEqual(results[0].nodeMap);
});

test('cancelled and stale responses cannot commit and a fresh run recovers', async ({ page }) => {
  expect(await page.evaluate(() => window.javaHarness.cancel())).toEqual({
    result: 'E_CANCELLED',
    output: '2\n',
    current: true,
    stale: null,
  });
});

test('array observation requires both slots of the same object', async ({ page }) => {
  const source =
    'import java.util.Scanner; ' +
    main(
      'Scanner input = new Scanner(System.in); int[] a = new int[2]; int[] b = new int[2]; a[0] = input.nextInt(); b[1] = input.nextInt(); System.out.println(b[1] - a[0]);',
    );
  const result = await page.evaluate(
    (code) => window.javaHarness.judge(code, 'java.practice.array-difference'),
    source,
  );
  expect(result.status).toBe('failed');
  expect(result.cases.every((item) => item.stdoutMatches && !item.observationMatches)).toBe(true);
});

test('judge shares the step limit across cases and restores each fresh initial state', async ({
  page,
}) => {
  const source = programs['utf16-length'].replace(
    'System.out.println(text.length());',
    'System.out.println(text.length()); for (int i = 0; i < 2500; i++) {}',
  );
  const result = await page.evaluate(
    (code) => window.javaHarness.judge(code, 'java.practice.utf16-length'),
    source,
  );
  expect(result.status).toBe('incomplete');
  expect(result.cases.length).toBeLessThan(4);
  expect(result.cases.at(-1)?.terminal.diagnostic?.code).toBe('E_STEP_LIMIT');
  expect(result.usage.steps).toBe(20000);
  expect(result.cases.every((item) => item.initial?.state.control.inputCursor === 0)).toBe(true);
});

test('stack and output overages preserve the last committed prefix', async ({ page }) => {
  const recursion =
    'public class Main { static int f(int n) { return f(n + 1); } public static void main(String[] args) { System.out.println(f(0)); } }';
  const stack = await page.evaluate((code) => window.javaHarness.run(code, ''), recursion);
  expect(stack.terminal.diagnostic?.code).toBe('E_STACK_LIMIT');
  expect(stack.end?.state.frames).toHaveLength(32);
  const output = await page.evaluate(
    (code) => window.javaHarness.run(code, ''),
    main('while (true) { System.out.print("abcdefghijklmnopqrstuvwxyz"); }'),
  );
  expect(output.terminal.diagnostic?.code).toBe('E_OUTPUT_LIMIT');
  expect(output.end?.state.output.length).toBe(16380);
  expect(output.initial?.state.output).toBe('');
});
