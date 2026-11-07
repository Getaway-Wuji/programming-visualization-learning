import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { CppInput } from '../../web/src/engine/cpp-course-protocol';
import type {} from './harness/cpp-course';

const profiles = JSON.parse(
  readFileSync(new URL('../../content/cpp/course/exercises-1.0.0.json', import.meta.url), 'utf8'),
) as {
  id: string;
  source: string;
  starter: string;
  cases: { input: CppInput; expected: string }[];
}[];
const empty: CppInput = { kind: 'integers', values: [] };
const wrap = (body: string) => '#include <iostream>\nint main(){' + body + '}';

test.beforeEach(async ({ page }) => {
  await page.goto('/checks/cpp-course.html');
  await page.waitForFunction(() => Boolean(window.cppCourseHarness));
});

test('production assets map each book node to its own lesson and activity', async ({ page }) => {
  const { counts, nodes } = await page.evaluate(() => window.cppCourseHarness.content());
  expect(nodes).toHaveLength(376);
  expect(new Set(nodes.map(({ id }) => id)).size).toBe(376);
  expect(
    nodes.filter(({ mode, activity }) => mode === 'reading' && activity === 'self-check'),
  ).toHaveLength(283);
  expect(
    nodes.filter(({ mode, activity }) => mode === 'wasm' && activity === 'judge'),
  ).toHaveLength(12);
  expect(counts).toMatchObject({
    parts: 4,
    chapters: 18,
    sections: 126,
    subsections: 228,
    judgeCases: 48,
  });
});

for (const profile of profiles) {
  test(`C++ four inputs and four verdicts ${profile.id}`, async ({ page }) => {
    for (const group of profile.cases) {
      const run = await page.evaluate(
        ({ source, input }) => window.cppCourseHarness.run(source, input),
        { source: profile.source, input: group.input },
      );
      expect(run.status).toBe('completed');
      expect(run.end.state?.output).toBe(group.expected);
      expect(run.rewound).toEqual(run.initial);
      expect(run.receipt?.request.language).toBe('cpp');
      expect(run.receipt?.wasmPages).toBeLessThanOrEqual(2048);
    }
    const run = await page.evaluate(
      ({ id, source, cases }) => window.cppCourseHarness.judge(source, id, 2, cases[2].input),
      profile,
    );
    expect(run.judgement?.cases.map((item) => item.passed)).toEqual([true, true, true, true]);
    expect(run.end.state?.output).toBe(profile.cases[2].expected);
    expect(run.rewound).toEqual(run.initial);
    const wrong = await page.evaluate(
      ({ id, starter, cases }) => window.cppCourseHarness.judge(starter, id, 0, cases[0].input),
      profile,
    );
    expect(wrong.judgement?.passed).toBe(false);
  });
}

for (const [id, source, expected, code] of [
  ['do runs before test', wrap('int n=0; do{n=n+1;}while(0); std::cout<<n;'), '1', null],
  [
    'continue tests the condition',
    wrap('int n=0; do{n=n+1; continue;}while(n<3); std::cout<<n;'),
    '3',
    null,
  ],
  ['break skips the condition', wrap('do{break;}while(1/0); std::cout<<9;'), '9', null],
  [
    'alias refers to one object',
    '#include <iostream>\nvoid f(int& a,int& b){a=a+1;b=b+2;} int main(){int n=0;f(n,n);std::cout<<n;}',
    '3',
    null,
  ],
  ['reference requires lvalue', 'void f(int& n){} int main(){ f(1); }', '', 'E_TYPE_INVALID'],
  ['private fields rejected', 'class A{ int n; }; int main(){ A a{}; }', '', 'E_PARSE_INVALID'],
  [
    'templates rejected',
    'template <typename T> T f(T n){ return n; } int main(){}',
    '',
    'E_UNSUPPORTED_SYNTAX',
  ],
  ['signed overflow', wrap('int n=2147483647;std::cout<<n+1;'), '', 'E_OVERFLOW'],
  ['division by zero', wrap('std::cout<<1/0;'), '', 'E_DIV_ZERO'],
  ['use after delete', wrap('int* p=new int{};delete p;std::cout<<*p;'), '', 'E_DANGLING_POINTER'],
  ['array bound', wrap('int a[2]={};std::cout<<a[2];'), '', 'E_POINTER_BOUNDS'],
] as const) {
  test(`C++ boundary / ${id}`, async ({ page }) => {
    const result = await page.evaluate(
      ({ source, empty }) => window.cppCourseHarness.run(source, empty),
      { source, empty },
    );
    expect(result.diagnostic?.code ?? null).toBe(code);
    expect(result.end.state?.output ?? '').toBe(expected);
    expect(result.rewound).toEqual(result.initial);
  });
}

test('editing returns original UTF-8 byte ranges and cancel permits recovery', async ({ page }) => {
  const source = '// 中文\r\nint main(){do{}while(0);}';
  const edit = await page.evaluate((value) => window.cppCourseHarness.analyze(value), source);
  const node = edit.nodeMap.find((item) => item.kind === 'do-while');
  expect(node).toBeDefined();
  const bytes = new TextEncoder().encode(source);
  expect(new TextDecoder().decode(bytes.slice(node!.byteRange.start, node!.byteRange.end))).toBe(
    'do{}while(0);',
  );
  const result = await page.evaluate(() => window.cppCourseHarness.cancel());
  expect(result.outcome).toBe('E_CANCELLED');
  expect(result.stale).toBeNull();
  expect(result.recovered.terminal?.returnValue).toBe(7);
});

test('bounded output preserves the committed reversible prefix', async ({ page }) => {
  const output = 'x'.repeat(128);
  const source = wrap(`while(1){std::cout<<"${output}";}`);
  const result = await page.evaluate(
    ({ source, empty }) => window.cppCourseHarness.run(source, empty),
    { source, empty },
  );
  expect(result.diagnostic?.code).toBe('E_OUTPUT_LIMIT');
  expect(result.end.state?.output).toBe(output.repeat(128));
  expect(result.rewound).toEqual(result.initial);
});

test('real Worker entry deadline covers waiting for the module and permits retry', async ({
  page,
}) => {
  await page.route('**/c_viz_cpp_course_bg-*.wasm', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.abort();
  });
  const result = await page.evaluate(
    async ({ empty }) => {
      const start = performance.now();
      const code = await window.cppCourseHarness.run('int main(){}', empty).then(
        () => 'completed',
        (error: Error) => error.message,
      );
      return { code, ms: performance.now() - start };
    },
    { empty },
  );
  expect(result.code).toBe('E_DEADLINE');
  expect(result.ms).toBeGreaterThanOrEqual(950);
  await page.unroute('**/c_viz_cpp_course_bg-*.wasm');
  expect(
    (
      await page.evaluate(
        (input) => window.cppCourseHarness.run('int main(){return 4;}', input),
        empty,
      )
    ).terminal?.returnValue,
  ).toBe(4);
});
