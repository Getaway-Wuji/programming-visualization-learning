import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/python3-semantics.json', import.meta.url), 'utf8'),
) as {
  id: string;
  source: string;
  input: string;
  status: string;
  stdout: string;
  diagnostic?: string;
}[];
const programs = JSON.parse(
  readFileSync(new URL('../fixtures/python3-reference.json', import.meta.url), 'utf8'),
) as Record<string, string>;

test.beforeEach(async ({ page }) => {
  await page.goto('/checks/python3.html');
  await page.waitForFunction(() => Boolean(window.python3Harness));
});

for (const vector of vectors) {
  test(`Python WASM semantics / ${vector.id}`, async ({ page }) => {
    const result = await page.evaluate(
      ({ source, input }) => window.python3Harness.run(source, input),
      vector,
    );
    expect(result.terminal.status).toBe(vector.status);
    expect(result.terminal.diagnostic?.code).toBe(vector.diagnostic);
    expect(result.end?.state.output ?? '').toBe(vector.stdout);
    expect(result.initial?.state.output ?? '').toBe('');
    expect(result.initial?.state.frames ?? []).toEqual([]);
    expect(result.proof?.wasmPages).toBeGreaterThan(0);
    expect(result.proof?.wasmPages).toBeLessThanOrEqual(2048);
  });
}

for (const [name, source] of Object.entries(programs)) {
  test(`Python WASM judges all four groups / ${name}`, async ({ page }) => {
    const result = await page.evaluate(
      ({ source, name }) => window.python3Harness.judge(source, 'py3.practice.' + name),
      { source, name },
    );
    expect(result.status).toBe('passed');
    expect(result.cases.map((item) => item.caseKey)).toEqual([1, 2, 3, 4]);
    for (const group of result.cases) {
      expect(group.terminal.status).toBe('completed');
      expect(group.stdoutMatches).toBe(true);
      expect(group.observationMatches).toBe(true);
      expect(group.initial?.state.control.inputCursor).toBe(0);
    }
  });
}

test('WASM observes aliasing and reverses checkpoint, stack, list, and output', async ({
  page,
}) => {
  const source =
    'a=[]\na.append(a)\nb=a\nb.append(int(input()))\ndef f(x):\n    return x.pop()\nn=0\nwhile n<50:\n    n+=1\nprint(f(a), b)';
  const result = await page.evaluate((code) => window.python3Harness.run(code, '8\n'), source);
  expect(result.end?.cursor).toBeGreaterThan(128);
  expect(result.end?.state.output).toBe('8 [[...]]\n');
  expect(result.end?.state.control.inputCursor).toBe(2);
  expect(result.initial?.state.globals).toEqual({});
  expect(result.initial?.state.objects).toEqual({});
});

test('WASM rejects a correct stdout that bypasses the observed learning goal', async ({ page }) => {
  const result = await page.evaluate(() =>
    window.python3Harness.judge(
      "a = input()\nb = '你好，' + a\nprint('你好，',a,sep='')",
      'py3.practice.greeting',
    ),
  );
  expect(result.status).toBe('failed');
  expect(result.cases.every((item) => item.stdoutMatches && !item.observationMatches)).toBe(true);
});

test('WASM cancellation invalidates pending results and a fresh run recovers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await window.python3Harness.run('print(1)', '');
    return window.python3Harness.cancel();
  });
  expect(result).toEqual({ result: 'E_CANCELLED', output: '2\n' });
});

test('WASM edit analysis preserves UTF-8 spans and reports whole-document capability', async ({
  page,
}) => {
  const result = await page.evaluate(() => window.python3Harness.edit("a = '🐍'\r\nprint(a)"));
  expect(result.result.kind).toBe('edit');
  if (result.result.kind !== 'edit') throw new Error('Wrong result kind');
  expect(result.result.status).toBe('mapped');
  expect(result.result.blockMap).toEqual(result.nodeMap);
  expect(result.nodeMap.find((node) => node.kind === 'string')?.byteRange).toEqual({
    start: 4,
    end: 10,
  });
  const noMap = await page.evaluate(() => window.python3Harness.edit('# keep original\nprint(1)'));
  expect(noMap.result).toMatchObject({ status: 'code-only', blockMap: [] });
});

test('WASM output limit returns the committed prefix and releases the next run', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const response = await window.python3Harness.run(
      "while True:\n    print('" + 'x'.repeat(4000) + "')",
      '',
    );
    const recovered = await window.python3Harness.run('print(5)', '');
    return {
      code: response.terminal.diagnostic?.code,
      status: response.terminal.status,
      outputLength: response.end?.state.output.length,
      reversed: response.initial?.state.output,
      recovered: recovered.end?.state.output,
    };
  });
  expect(result).toEqual({
    code: 'E_OUTPUT_LIMIT',
    status: 'limited',
    outputLength: 16004,
    reversed: '',
    recovered: '5\n',
  });
});

test('WASM step limit accepts the full reversible prefix and releases the next run', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const prefix = await window.python3Harness.run('while True:\n    pass', '');
    const recovered = await window.python3Harness.run('print(5)', '');
    return {
      status: prefix.terminal.status,
      code: prefix.terminal.diagnostic?.code,
      steps: prefix.usage.steps,
      end: prefix.end?.cursor,
      initial: prefix.initial?.cursor,
      recovered: recovered.end?.state.output,
    };
  });
  expect(result).toEqual({
    status: 'limited',
    code: 'E_STEP_LIMIT',
    steps: 20000,
    end: 20000,
    initial: 0,
    recovered: '5\n',
  });
});

test('WASM list display escapes Unicode nonprintable scalars and retains combining marks', async ({
  page,
}) => {
  const result = await page.evaluate(() =>
    window.python3Harness.run("print(['e\\u0301', '\\u0378', '\\U000f0000', '🐍'])", ''),
  );
  expect(result.end?.state.output).toBe("['e\u0301', '\\u0378', '\\U000f0000', '🐍']\n");
});

test('WASM Worker initialization shares the whole-trigger deadline', async ({ page }) => {
  await page.route(
    '**/python3-worker-*.js',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue().catch(() => {});
    },
    { times: 1 },
  );
  const first = await page.evaluate(() =>
    window.python3Harness.run('print(1)', '').catch((error: Error) => error.message),
  );
  expect(first).toBe('E_DEADLINE');
  const next = await page.evaluate(() => window.python3Harness.run('print(2)', ''));
  expect(next.end?.state.output).toBe('2\n');
});
