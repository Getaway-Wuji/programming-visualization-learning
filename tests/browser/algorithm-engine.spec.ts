import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function ready(page: Page) {
  await page.goto('/algorithm-harness.html');
  await page.waitForFunction(() => Boolean(window.algorithmTest));
}
test.beforeEach(async ({ page }) => ready(page));

const hanoi =
  '#include <iostream>\nvoid hanoi(int n,int from,int spare,int to){if(n==0){return;}hanoi(n-1,from,to,spare);std::cout << from << "->" << to << "\\n";hanoi(n-1,spare,from,to);}int main(){int n;std::cin >> n;hanoi(n,1,2,3);return 0;}';
const quicksort =
  '#include <iostream>\nvoid sort(int a[],int left,int right){if(left>=right){return;}int i=left;int j=right;int pivot=a[(left+right)/2];while(i<=j){while(a[i]<pivot){i=i+1;}while(a[j]>pivot){j=j-1;}if(i<=j){int t=a[i];a[i]=a[j];a[j]=t;i=i+1;j=j-1;}}if(left<j){sort(a,left,j);}if(i<right){sort(a,i,right);}}int main(){int a[7]={};for(int i=0;i<7;i=i+1){std::cin >> a[i];}sort(a,0,6);for(int i=0;i<7;i=i+1){std::cout << a[i] << " ";}return 0;}';
const publicWorst30 = readFileSync(
  new URL('../../shared/fixtures/p1/quicksort.cpp', import.meta.url),
  'utf8',
)
  .replace('int a[5]', 'int a[30]')
  .replaceAll('i < 5', 'i < 30')
  .replace('quicksort(a, 0, 4)', 'quicksort(a, 0, 29)');

test('C functions keep parameter values, lexical locals and true recursive returns', async ({
  page,
}) => {
  const source =
    '#include <stdio.h>\nint sum(int n){if(n==0){return 0;}int same=n;return same+sum(n-1);}int main(void){int same=91;printf("%d %d\\n",sum(5),same);return 7;}';
  const run = await page.evaluate((text) => window.algorithmTest.run(text, 'c'), source);
  expect(run.result.language).toBe('c');
  expect(run.result.terminal).toMatchObject({ status: 'completed', returnValue: 7 });
  const replay = await page.evaluate(() => window.algorithmTest.replay());
  expect(replay.last.state!.output).toBe('15 91\n');
  expect(replay.restored).toBe(true);
  expect(replay.samples).toHaveLength(6);
  expect(run.inspect.activeWorkers).toBe(0);
});
test('C++ Hanoi input changes moves and all returned frames restore from real Rust deltas', async ({
  page,
}) => {
  for (const n of [0, 1, 3]) {
    const run = await page.evaluate(
      ({ source, n }) => window.algorithmTest.run(source, 'cpp', [n]),
      { source: hanoi, n },
    );
    expect(run.result.language).toBe('cpp');
    expect(run.result.terminal.status).toBe('completed');
    const replay = await page.evaluate(() => window.algorithmTest.replay());
    expect(replay.last.state!.output.split('\n').filter(Boolean)).toHaveLength(2 ** n - 1);
    expect(replay.last.state!.control.inputCursor).toBe(1);
    expect(replay.restored).toBe(true);
  }
});
test('C++ quicksort truly modifies the caller array through array parameters for varied input', async ({
  page,
}) => {
  for (const input of [
    [7, 2, 5, 1, 6, 3, 4],
    [2, 2, -3, 0, -3, 2, 1],
    [7, 6, 5, 4, 3, 2, 1],
  ]) {
    const run = await page.evaluate(
      ({ source, input }) => window.algorithmTest.run(source, 'cpp', input),
      { source: quicksort, input },
    );
    expect(run.result.terminal.status).toBe('completed');
    const replay = await page.evaluate(() => window.algorithmTest.replay());
    expect(replay.last.state!.output).toBe([...input].sort((a, b) => a - b).join(' ') + ' ');
    expect(replay.restored).toBe(true);
    expect(replay.samples.length).toBeGreaterThan(0);
  }
  const group30 = Array.from({ length: 30 }, (_, index) => 29 - index);
  for (const source of [
    quicksort
      .replaceAll('[7]', '[30]')
      .replaceAll('i<7', 'i<30')
      .replace('sort(a,0,6)', 'sort(a,0,29)'),
    publicWorst30,
  ]) {
    const input = source === publicWorst30 ? [...group30].reverse() : group30;
    const run = await page.evaluate(
      ({ source, input }) => window.algorithmTest.run(source, 'cpp', input),
      { source, input },
    );
    expect(run.result.terminal.status).toBe('completed');
    expect(run.elapsedMs).toBeLessThan(1000);
    await test
      .info()
      .attach(source === publicWorst30 ? 'last-pivot-sorted30' : 'middle-pivot-reversed30', {
        body: JSON.stringify({
          language: run.result.language,
          engine: run.result.engine,
          inputCount: input.length,
          steps: run.result.trace?.steps.length,
          fuelUsed: run.result.stats.fuelUsed,
          elapsedMs: run.elapsedMs,
        }),
        contentType: 'application/json',
      });
    const replay = await page.evaluate(() => window.algorithmTest.replay());
    expect(replay.last.state!.output).toBe(
      [...input].sort((a, b) => a - b).join(' ') + (source === publicWorst30 ? ' \n' : ' '),
    );
    expect(replay.last.state!.control.inputCursor).toBe(30);
    expect(replay.restored).toBe(true);
  }
});
test('editing actual C++ source changes result and source locations remain in original UTF8 text', async ({
  page,
}) => {
  const source =
    '// 中文 😀\r\n#include <iostream>\r\nint twice(int n){return n*2;}int main(){int n;std::cin >> n;std::cout << twice(n);return 0;}';
  const first = await page.evaluate(
    (source) => window.algorithmTest.run(source, 'cpp', [9]),
    source,
  );
  expect(first.result.terminal.status).toBe('completed');
  expect((await page.evaluate(() => window.algorithmTest.replay())).last.state!.output).toBe('18');
  const second = await page.evaluate(
    (source) => window.algorithmTest.run(source, 'cpp', [9]),
    source.replace('n*2', 'n*3'),
  );
  expect(second.result.identity.runId).not.toBe(first.result.identity.runId);
  expect((await page.evaluate(() => window.algorithmTest.replay())).last.state!.output).toBe('27');
  const ranges = second.result.nodeMap.map((node) => node.byteRange);
  const bytes = new TextEncoder().encode(source.replace('n*2', 'n*3'));
  for (const range of ranges)
    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(range.start, range.end)),
    ).not.toThrow();
  expect(second.result.trace!.steps.some((step) => step.kind === 'function.enter')).toBe(true);
});
test('unsupported C++ and language mismatches fail without substituting another program', async ({
  page,
}) => {
  for (const [source, language] of [
    ['#include <vector>\nint main(){return 0;}', 'cpp'],
    ['#include <iostream>\nint main(){std::cout << 1;return 0;}', 'c'],
    ['int main(){bool b=true;return 0;}', 'cpp'],
  ] as const) {
    const run = await page.evaluate(
      ({ source, language }) => window.algorithmTest.run(source, language),
      { source, language },
    );
    expect(run.result.language).toBe(language);
    expect(run.result.terminal.status).toBe('error');
    expect(run.result.trace).toBeNull();
  }
});
test('runtime errors and stack depth limits retain reversible successful prefixes', async ({
  page,
}) => {
  const cases = [
    {
      source: '#include <iostream>\nint main(){int a[2]={1,2};std::cout << a[2];return 0;}',
      code: 'E_BOUNDS',
      status: 'error',
    },
    {
      source: '#include <iostream>\nint main(){int n;std::cout << n;return 0;}',
      code: 'E_UNINITIALIZED',
      status: 'error',
    },
    {
      source: 'int forever(int n){return forever(n+1);}int main(){return forever(0);}',
      code: 'E_STACK_LIMIT',
      status: 'limited',
    },
  ];
  for (const item of cases) {
    const run = await page.evaluate(
      (source) => window.algorithmTest.run(source, 'cpp'),
      item.source,
    );
    expect(run.result.terminal).toMatchObject({ code: item.code, status: item.status });
    expect(run.result.trace!.completeness).toBe('prefix');
    expect((await page.evaluate(() => window.algorithmTest.replay())).restored).toBe(true);
  }
});
test('cancel/invalidate terminates genuine Worker work and a following run still succeeds', async ({
  page,
}) => {
  const result = await page.evaluate(async (source) => {
    const pending = window.algorithmTest.run(source, 'cpp').then(
      () => 'unexpected-success',
      (error: Error) => error.message,
    );
    while (window.algorithmTest.inspect().state === 'loading')
      await new Promise<void>((accept) => setTimeout(accept, 0));
    if (window.algorithmTest.inspect().state !== 'running')
      throw new Error('Did not reach genuine Worker execution');
    window.algorithmTest.cancel();
    const cancelled = await pending;
    window.algorithmTest.invalidate();
    const clean = await window.algorithmTest.run(
      '#include <iostream>\nint main(){std::cout << 42;return 0;}',
      'cpp',
    );
    return { cancelled, clean, replay: window.algorithmTest.replay() };
  }, 'int main(){while(1){}return 0;}');
  expect(result.cancelled).toBe('E_CANCELLED');
  expect(result.clean.result.terminal.status).toBe('completed');
  expect(result.replay.last.state!.output).toBe('42');
  expect(result.clean.inspect.activeWorkers).toBe(0);
});

test('released large arrays keep reversible virtual addresses above four GiB in real WASM', async ({
  page,
}) => {
  const report = await page.evaluate(async () => {
    const run = await window.algorithmTest.run('int main(){while(1){int a[262144];}}', 'cpp');
    let maximum = 0;
    for (const step of run.result.trace!.steps) {
      for (const change of step.changes) {
        if (change.op === 'allocator') {
          if (change.after.nextAddress < change.before.nextAddress)
            throw new Error('Virtual address wrapped');
          maximum = Math.max(maximum, change.after.nextAddress);
          if (change.after.liveBytes > 1_048_576) throw new Error('Live memory limit exceeded');
        }
      }
    }
    return {
      engine: run.result.engine,
      terminal: run.result.terminal,
      maximum,
      elapsedMs: run.elapsedMs,
      restored: window.algorithmTest.replay().restored,
    };
  });
  expect(report.terminal).toMatchObject({ code: 'E_STEP_LIMIT', status: 'limited' });
  expect(report.maximum).toBeGreaterThan(0xffff_ffff);
  expect(Number.isSafeInteger(report.maximum)).toBe(true);
  expect(report.restored).toBe(true);
  await test.info().attach('virtual-address-beyond-four-gib', {
    body: JSON.stringify(report),
    contentType: 'application/json',
  });
});
