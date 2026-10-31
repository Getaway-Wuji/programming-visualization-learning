import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
const fixture = (name: string) =>
  readFileSync(new URL(`../../shared/fixtures/advanced/${name}`, import.meta.url), 'utf8');
test.beforeEach(async ({ page }) => {
  await page.goto('/advanced-harness.html');
  await page.waitForFunction(() => Boolean(window.advancedTest));
});
for (const [text, pattern, want] of [
  ['ababab', 'abab', 0],
  ['aaaaab', 'aaab', 2],
  ['abc', 'd', -1],
  ['', '', 0],
  ['', 'a', -1],
  ['abc', '', 0],
  ['a'.repeat(29) + 'b', 'aaab', 26],
  ['a'.repeat(30), 'a'.repeat(30), 0],
] as const) {
  test(`KMP ${text.length}/${pattern.length}/${want}`, async ({ page }) => {
    const source = fixture('kmp.cpp');
    const r = await page.evaluate(
      ({ source, text, pattern }) =>
        window.advancedTest.run(source, 'cpp', { kind: 'lines', values: [text, pattern] }),
      { source, text, pattern },
    );
    expect(r.result.terminal.status).toBe('completed');
    const p = await page.evaluate(() => window.advancedTest.replay());
    expect(p.restored).toBe(true);
    expect(p.last.state!.output).toBe(String(want));
    expect(r.inspect.activeWorkers).toBe(0);
    await test.info().attach('real-run', {
      body: JSON.stringify({
        ms: r.elapsedMs,
        steps: r.result.trace!.steps.length,
        engine: r.result.engine,
      }),
      contentType: 'application/json',
    });
  });
}
test('C scanf successful input, exhausted input, failed target and full reverse', async ({
  page,
}) => {
  const source = fixture('input.c');
  for (const input of [[7, -2], [7]]) {
    const r = await page.evaluate(
      ({ source, input }) =>
        window.advancedTest.run(source, 'c', { kind: 'integers', values: input }),
      { source, input },
    );
    const p = await page.evaluate(() => window.advancedTest.replay());
    expect(p.restored).toBe(true);
    if (input.length === 2) {
      expect(r.result.terminal.status).toBe('completed');
      expect(p.last.state!.output).toBe('5');
    } else {
      expect(r.result.terminal.code).toBe('E_INPUT_EXHAUSTED');
      expect(p.last.state!.control.inputCursor).toBe(1);
    }
  }
  const r = await page.evaluate(() =>
    window.advancedTest.run(
      '#include <stdio.h>\nint main(){int a[2];scanf("%d",&a[2]);return 0;}',
      'c',
      { kind: 'integers', values: [9] },
    ),
  );
  expect(r.result.terminal.status).toBe('error');
  const p = await page.evaluate(() => window.advancedTest.replay());
  expect(p.restored).toBe(true);
  expect(p.last.state!.control.inputCursor).toBe(0);
});
test('strings copy, scope restoration and character output', async ({ page }) => {
  for (const input of [
    ['aba', 'x'],
    ['', ''],
    ['<script>', '123'],
  ]) {
    const source = fixture('strings.cpp');
    const r = await page.evaluate(
      ({ source, input }) =>
        window.advancedTest.run(source, 'cpp', { kind: 'lines', values: input }),
      { source, input },
    );
    expect(r.result.terminal.status).toBe('completed');
    const p = await page.evaluate(() => window.advancedTest.replay());
    expect(p.restored).toBe(true);
    expect(p.last.state!.output).toBe(input[0] + input[1] + input[0].length + (input[0][0] ?? ''));
  }
});
test('four numeric programs, 30-item sequence and changed KMP source', async ({ page }) => {
  for (const [name, input, want] of [
    ['eratos.cpp', [30], '2 3 5 7 11 13 17 19 23 29 '],
    ['euler.cpp', [30], '2 3 5 7 11 13 17 19 23 29 '],
    ['kadane.cpp', [3, -5, -2, -8], '-2'],
    ['lis.cpp', [3, 3, 3, 3], '1'],
  ] as const) {
    const source = fixture(name);
    const r = await page.evaluate(
      ({ source, input }) =>
        window.advancedTest.run(source, 'cpp', { kind: 'integers', values: [...input] }),
      { source, input },
    );
    expect(r.result.terminal.status).toBe('completed');
    const p = await page.evaluate(() => window.advancedTest.replay());
    expect(p.restored).toBe(true);
    expect(p.last.state!.output).toBe(want);
  }
  for (const name of ['kadane.cpp', 'lis.cpp']) {
    const source = fixture(name).replace('int n;std::cin>>n;', 'int n=30;');
    const r = await page.evaluate(
      ({ source }) =>
        window.advancedTest.run(source, 'cpp', {
          kind: 'integers',
          values: Array.from({ length: 30 }, (_, i) => i - 15),
        }),
      { source },
    );
    expect(r.result.terminal.status).toBe('completed');
    const p = await page.evaluate(() => window.advancedTest.replay());
    expect(p.restored).toBe(true);
    expect(p.last.state!.output).toBe(name === 'lis.cpp' ? '30' : '105');
  }
  const source = fixture('kmp.cpp').replace('answer=i-m+1', 'answer=i-m+2');
  await page.evaluate(
    ({ source }) =>
      window.advancedTest.run(source, 'cpp', { kind: 'lines', values: ['zabc', 'abc'] }),
    { source },
  );
  const p = await page.evaluate(() => window.advancedTest.replay());
  expect(p.last.state!.output).toBe('2');
  expect(p.restored).toBe(true);
});
test('input validation and static language rejection', async ({ page }) => {
  for (const input of [['é'], ['a\nb'], ['a'.repeat(31)]]) {
    const err = await page.evaluate(
      (input) =>
        window.advancedTest
          .run('int main(){return 0;}', 'cpp', { kind: 'lines', values: input })
          .then(
            () => '',
            (e: Error) => e.message,
          ),
      input,
    );
    expect(err).toBe('E_PROTOCOL_INVALID');
  }
  for (const source of ["int main(){return 'a';}", 'int main(){if(0){int* p=new int;}return 0;}']) {
    const r = await page.evaluate((source) => window.advancedTest.run(source, 'c'), source);
    expect(r.result.terminal.status).toBe('error');
    expect(r.result.trace).toBeNull();
  }
});
test('deep recursion and real Worker cancellation recover with a fresh run', async ({ page }) => {
  const deep =
    'int f(int n){if(n==0){return 0;}' +
    '{'.repeat(27) +
    'return f(n-1);' +
    '}'.repeat(27) +
    '}int main(){return f(30);}';
  const r = await page.evaluate((deep) => window.advancedTest.run(deep, 'c'), deep);
  expect(r.result.terminal.code).toBe('E_DEPTH_LIMIT');
  expect((await page.evaluate(() => window.advancedTest.replay())).restored).toBe(true);
  const out = await page.evaluate(async () => {
    const p = window.advancedTest.run('int main(){while(1){}}', 'c').then(
      () => '',
      (e: Error) => e.message,
    );
    while (window.advancedTest.inspect().state === 'loading')
      await new Promise((r) => setTimeout(r, 0));
    window.advancedTest.cancel();
    const code = await p;
    const r = await window.advancedTest.run('int main(){return 7;}', 'c');
    return { code, result: r.result.terminal, inspect: r.inspect };
  });
  expect(out.code).toBe('E_CANCELLED');
  expect(out.result.returnValue).toBe(7);
  expect(out.inspect.activeWorkers).toBe(0);
});

test('execution keeps source and input in the browser and leaves storage empty', async ({
  page,
}) => {
  const requests: { url: string; method: string; body: string | null }[] = [];
  page.on('request', (request) =>
    requests.push({ url: request.url(), method: request.method(), body: request.postData() }),
  );
  const source = fixture('strings.cpp');
  await page.evaluate(
    (source) =>
      window.advancedTest.run(source, 'cpp', { kind: 'lines', values: ['PRIVATE_QA_MARKER', 'x'] }),
    source,
  );
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every(
      (r) =>
        r.url.startsWith('http://127.0.0.1:4183/') &&
        r.method === 'GET' &&
        r.body === null &&
        !r.url.includes('PRIVATE_QA_MARKER'),
    ),
  ).toBe(true);
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases()).length,
  }));
  expect(storage).toEqual({ local: 0, session: 0, databases: 0 });
});
