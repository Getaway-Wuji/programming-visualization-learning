import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { c6LearningRelease } from '../../web/src/c6-learning/release.generated';
test.beforeEach(async ({ page }) => {
  await page.goto('/c6-harness.html');
  await page.waitForFunction(() => !!window.c6Test);
});
test('real typed C6 Worker facts, complete reverse and changed source/input', async ({ page }) => {
  const source =
    '#include <stdio.h>\nstruct S{char text[4];double d;int n;};int main(){struct S s={"ok",-.125,0};scanf("%d",&s.n);struct S *p=&s;p->n+=2;printf("%s %.2f %d\\n",s.text,s.d,s.n);return 0;}';
  for (const input of ['0', '7']) {
    const run = await page.evaluate(({ source, input }) => window.c6Test.run(source, input), {
      source,
      input,
    });
    expect(run.result.terminal.status).toBe('completed');
    expect(run.result.engine.buildId).toBe(c6LearningRelease.engineBuildSha256);
    expect(await page.evaluate(() => window.c6Test.build.wasmSha256)).toBe(
      c6LearningRelease.engineBuildSha256,
    );
    expect(run.receipt).toBe(true);
    expect(run.inspect.activeWorkers).toBe(0);
    expect(run.elapsedMs).toBeLessThan(1000);
    expect(run.final!.output).toBe(`ok -0.12 ${Number(input) + 2}\n`);
    expect((await page.evaluate(() => window.c6Test.replay())).restored).toBe(true);
  }
  const changed = await page.evaluate(
    (source) => window.c6Test.run(source.replace('p->n+=2', 'p->n+=5'), '7'),
    source,
  );
  expect(changed.final!.output).toBe('ok -0.12 12\n');
});
const fixtures = JSON.parse(
  readFileSync('shared/fixtures/c6/21.3/judge-programs.json', 'utf8'),
) as {
  programs: {
    profileRef: { id: string; version: string };
    primary: string;
    alternative: string;
    bypass: string;
  }[];
};
for (const row of fixtures.programs) {
  test(`${row.profileRef.id}: actual four-case judge in a fresh Worker`, async ({ page }) => {
    const run = await page.evaluate((row) => window.c6Test.judge(row.primary, row.profileRef), row);
    expect(run.status).toBe('passed');
    expect(run.receipt).toBe(true);
    expect(run.cases).toHaveLength(4);
    expect(run.cases.every((c) => c.observed && c.status === 'completed')).toBe(true);
    expect(run.inspect.activeWorkers).toBe(0);
    expect(run.elapsedMs).toBeLessThan(1000);
    expect(run.aggregate.wasmPeakBytes).toBeLessThanOrEqual(134217728);
    expect(run.aggregate.wasmPeakBytes).toBeGreaterThanOrEqual(8388608);
    await test
      .info()
      .attach('actual-c6-judge', { body: JSON.stringify(run), contentType: 'application/json' });
  });
}
test('32 virtual frames produce the specified diagnostic and all state reverses', async ({
  page,
}) => {
  const run = await page.evaluate(() =>
    window.c6Test.run('int recurse(int n){return recurse(n+1);}int main(){return recurse(0);}'),
  );
  expect(run.result.terminal.code).toBe('E_STACK_LIMIT');
  expect(run.result.trace!.completeness).toBe('prefix');
  const replay = await page.evaluate(() => window.c6Test.replay());
  expect(replay.maxFrames).toBe(32);
  expect(replay.restored).toBe(true);
});
test('global zero/static lifetime and the exact 256 evaluation boundary survive the Worker', async ({
  page,
}) => {
  const global = await page.evaluate(() =>
    window.c6Test.run(
      'int count;int *p;int tick(){count++;return count;}int main(){return (p!=0)+tick()+tick();}',
    ),
  );
  expect(global.result.terminal.returnValue).toBe(3);
  expect((await page.evaluate(() => window.c6Test.replay())).restored).toBe(true);
  for (const n of [4, 5]) {
    const source =
      'int f(int n){if(n==0)return 0;return ' +
      '+ '.repeat(57) +
      `f(n-1);}int main(){return + + f(${n});}`;
    const run = await page.evaluate((source) => window.c6Test.run(source), source);
    expect(run.result.terminal.code).toBe(n === 4 ? null : 'E_DEPTH_LIMIT');
    expect((await page.evaluate(() => window.c6Test.replay())).restored).toBe(true);
  }
});
test('depth64 EDIT mapping crosses IPC as a flat graph inside JSON depth32', async ({ page }) => {
  const result = await page.evaluate(() =>
    window.c6Test.edit('int main(){return ' + '+ '.repeat(61) + '1;}'),
  );
  expect('editVersion' in result && result.status).toBe('mapped');
  expect('program' in result && result.program?.nodes.length).toBeGreaterThan(60);
});
test('EDIT2 preserves full new syntax and invalid drafts', async ({ page }) => {
  for (const [source, status] of [
    ['int main(){int x=2;x=x+1;return x;}', 'mapped'],
    ['int main(){int x=2;x++;return x;}', 'code-only'],
    ['// 中文\nint main(){return missing;}', 'invalid'],
  ] as const) {
    const result = await page.evaluate((source) => window.c6Test.edit(source), source);
    expect('editVersion' in result && result.status).toBe(status);
    expect('source' in result && result.source).toBe(source);
  }
});
test('cancellation removes the Worker and a later real run recovers', async ({ page }) => {
  await page.evaluate(() => window.c6Test.run('int main(){return 0;}'));
  const cancelled = await page.evaluate(() => window.c6Test.cancelRun());
  expect(cancelled.outcome).toBe('E_CANCELLED');
  expect(cancelled.inspect.activeWorkers).toBe(0);
  const recovered = await page.evaluate(() => window.c6Test.run('int main(){return 7;}'));
  expect(recovered.result.terminal.returnValue).toBe(7);
  expect(recovered.receipt).toBe(true);
});
test('failed module load recovers and the whole trigger has one deadline', async ({ page }) => {
  await page.route('**/c_viz_c6_bg-*.wasm', (route) => route.abort());
  const failed = await page.evaluate(() =>
    window.c6Test.run('int main(){return 0;}').then(
      () => '',
      (e) => (e as Error).message,
    ),
  );
  expect(failed).toBe('E_MODULE_LOAD');
  await page.unroute('**/c_viz_c6_bg-*.wasm');
  expect(
    (await page.evaluate(() => window.c6Test.run('int main(){return 3;}'))).result.terminal
      .returnValue,
  ).toBe(3);
  await page.reload();
  await page.waitForFunction(() => !!window.c6Test);
  await page.route('**/c_viz_c6_bg-*.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1300));
    await route.continue().catch(() => {});
  });
  const expired = await page.evaluate(async () => {
    const start = performance.now();
    const code = await window.c6Test.run('int main(){return 0;}').then(
      () => '',
      (e) => (e as Error).message,
    );
    return { code, elapsed: performance.now() - start, inspect: window.c6Test.inspect() };
  });
  expect(expired.code).toBe('E_DEADLINE');
  expect(expired.elapsed).toBeGreaterThanOrEqual(990);
  expect(expired.elapsed).toBeLessThan(1200);
  expect(expired.inspect.activeWorkers).toBe(0);
});
