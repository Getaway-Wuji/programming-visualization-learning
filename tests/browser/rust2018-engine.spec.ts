import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type {} from './harness/rust2018';

const vectors = JSON.parse(
  readFileSync('tests/fixtures/rust2018-semantic-vectors.json', 'utf8'),
) as {
  id: string;
  source: string;
  input: string;
  output: string | null;
  diagnostic: string | null;
}[];
const profiles = JSON.parse(
  readFileSync('shared/contracts/rust2018-profiles-1.0.0.json', 'utf8'),
) as { id: string; source: string; cases: { input: string; expected: string }[] }[];

test.beforeEach(async ({ page }) => {
  await page.goto('/checks/rust2018.html');
  await page.waitForFunction(() => Boolean(window.rust2018Harness));
});

for (const vector of vectors) {
  test(`Rust semantics and full reverse / ${vector.id}`, async ({ page }) => {
    const result = await page.evaluate(
      ({ source, input }) => window.rust2018Harness.run(source, input),
      vector,
    );
    expect(result.response.diagnostic?.code ?? null).toBe(vector.diagnostic);
    expect(result.rewound).toEqual(result.initial);
    if (vector.diagnostic === null) {
      expect(result.response.status).toBe('completed');
      expect(result.end?.output).toBe(vector.output);
      expect(result.end?.frames).toEqual([]);
      expect(result.end?.loans).toEqual([]);
      expect(result.end?.allocator.liveBytes).toBe(0);
    }
    if (vector.id.startsWith('dead-branch') || vector.id === 'static-before-output')
      expect(result.response.replay).toBeNull();
    expect(result.receipt?.request.source).toBe(vector.source);
  });
}

for (const profile of profiles) {
  test(`Rust current-source four-group judge / ${profile.id}`, async ({ page }) => {
    for (const [index, group] of profile.cases.entries()) {
      const result = await page.evaluate(
        ({ source, id, index }) => window.rust2018Harness.judge(source, id, index),
        { source: profile.source, id: profile.id, index },
      );
      expect(result.response.judgement?.passed).toBe(true);
      expect(result.response.judgement?.cases).toHaveLength(4);
      expect(result.response.judgement?.reviewCase).toBe(index);
      expect(result.end?.output).toBe(group.expected);
      expect(result.rewound).toEqual(result.initial);
    }
  });
}

test('Rust cancellation invalidates old receipts and a new real run recovers', async ({ page }) => {
  const result = await page.evaluate(() => window.rust2018Harness.cancel());
  expect(result.outcome).toBe('E_CANCELLED');
  expect(result.stale).toBeNull();
  expect(result.recovered.end?.output).toBe('ready\n');
});

test('Rust malformed reverse changes are rejected after a real WASM execution', async ({
  page,
}) => {
  expect(await page.evaluate(() => window.rust2018Harness.forgedReverse())).toBe(
    'E_PROTOCOL_INVALID',
  );
});

test('Rust complete step prefix remains reversible and releases the next run', async ({ page }) => {
  const result = await page.evaluate(() => window.rust2018Harness.run('fn main(){loop{}}', ''));
  expect(result.response.status).toBe('limited');
  expect(result.response.diagnostic?.code).toBe('E_STEP_LIMIT');
  expect(result.response.replay?.trace.steps).toHaveLength(20000);
  expect(result.rewound).toEqual(result.initial);
  const recovered = await page.evaluate(() =>
    window.rust2018Harness.run('fn main(){println!("recovered");}', ''),
  );
  expect(recovered.end?.output).toBe('recovered\n');
});

test('Rust input boilerplate cannot satisfy user mutable borrowing or String construction goals', async ({
  page,
}) => {
  const borrowed = profiles.find((profile) => profile.id.includes('root04.02.01'))!;
  const fakeBorrow = borrowed.source.replace('bump(&mut value);', 'value = value + 2;');
  const result = await page.evaluate(
    ({ source, profile }) => window.rust2018Harness.judge(source, profile, 0),
    { source: fakeBorrow, profile: borrowed.id },
  );
  expect(result.response.judgement?.passed).toBe(false);
  expect(result.end?.output).toBe(borrowed.cases[0].expected);
  const string = profiles.find((profile) => profile.id.includes('root04.01.03'))!;
  const fakeString = string.source
    .replace('println!("{} {}", text, n);', 'println!("Rust {}", n);')
    .replace('println!("{}", text);', 'println!("Rust");');
  const stringResult = await page.evaluate(
    ({ source, profile }) => window.rust2018Harness.judge(source, profile, 0),
    { source: fakeString, profile: string.id },
  );
  expect(stringResult.response.judgement?.passed).toBe(false);
  expect(stringResult.end?.output).toBe(string.cases[0].expected);
});

test('Rust WASM rejects unknown fields, versions, profiles and input byte overflow', async ({
  page,
}) => {
  const request = {
    version: '1.0.0',
    language: 'rust',
    edition: '2018',
    runId: 'raw-test',
    sourceRevision: 'raw-revision',
    source: 'fn main(){}',
    operation: 'execute',
    input: '',
  };
  expect(
    await page.evaluate((value) => window.rust2018Harness.rawError(value), {
      ...request,
      extra: true,
    }),
  ).toBe('E_REQUEST_INVALID');
  expect(
    await page.evaluate((value) => window.rust2018Harness.rawError(value), {
      ...request,
      edition: '2024',
    }),
  ).toBe('E_VERSION_UNSUPPORTED');
  expect(
    await page.evaluate((value) => window.rust2018Harness.rawError(value), {
      ...request,
      input: '字'.repeat(86),
    }),
  ).toBe('E_INPUT_LIMIT');
  const base: Record<string, unknown> = { ...request };
  delete base.input;
  expect(
    await page.evaluate((value) => window.rust2018Harness.rawError(value), {
      ...base,
      operation: 'judge',
      profile: 'rust.unknown',
      reviewCase: 0,
    }),
  ).toBe('E_PROFILE_UNKNOWN');
});

test('Rust editing analysis returns real UTF-8 source ranges and rejects invalid current code', async ({
  page,
}) => {
  const source = 'fn main(){let number=3;println!("字🙂 {}",number);}';
  const analysis = await page.evaluate((value) => window.rust2018Harness.analyze(value), source);
  expect(analysis.status).toBe('completed');
  expect(analysis.replay).toBeNull();
  expect(analysis.analysis?.status).toBe('mapped');
  const bytes = Buffer.from(source);
  expect(analysis.nodeMap.length).toBeGreaterThan(4);
  expect(
    analysis.nodeMap.some(
      (node) =>
        bytes.subarray(node.byteRange.start, node.byteRange.end).toString('utf8') === 'number',
    ),
  ).toBe(true);
  expect(
    analysis.nodeMap.every(
      (node) =>
        bytes
          .subarray(node.byteRange.start, node.byteRange.end)
          .toString('utf8')
          .includes('\uFFFD') === false,
    ),
  ).toBe(true);
  const invalid = await page.evaluate(() =>
    window.rust2018Harness.analyze('fn main(){let n=true;let x=n+1;}'),
  );
  expect(invalid.diagnostic?.code).toBe('E_TYPE');
  expect(invalid.analysis?.status).toBe('invalid');
  expect(invalid.replay).toBeNull();
});

test('Rust output limit preserves its exact prefix and permits a fresh execution', async ({
  page,
}) => {
  const literal = 'x'.repeat(128);
  const result = await page.evaluate(
    (source) => window.rust2018Harness.run(source, ''),
    `fn main(){loop{print!("${literal}");}}`,
  );
  expect(result.response.status).toBe('limited');
  expect(result.response.diagnostic?.code).toBe('E_OUTPUT_LIMIT');
  expect(result.end?.output).toBe('x'.repeat(16384));
  expect(result.rewound).toEqual(result.initial);
  const recovered = await page.evaluate(() =>
    window.rust2018Harness.run('fn main(){println!("done");}', ''),
  );
  expect(recovered.end?.output).toBe('done\n');
});

test('Rust whole-trigger deadline covers delayed Worker start and a retry recovers', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    const fault = { hold: true };
    Object.assign(window, { rustDeadlineFault: fault });
    window.Worker = class extends Native {
      override postMessage(
        message: unknown,
        options: Transferable[] | StructuredSerializeOptions = [],
      ) {
        const settings = Array.isArray(options) ? { transfer: options } : options;
        if (fault.hold) setTimeout(() => super.postMessage(message, settings), 1100);
        else super.postMessage(message, settings);
      }
    };
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(window.rust2018Harness));
  const result = await page.evaluate(async () => {
    try {
      await window.rust2018Harness.run('fn main(){}', '');
      return 'accepted';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
  expect(result).toBe('E_DEADLINE');
  await page.evaluate(() => {
    (window as unknown as { rustDeadlineFault: { hold: boolean } }).rustDeadlineFault.hold = false;
  });
  const recovered = await page.evaluate(() =>
    window.rust2018Harness.run('fn main(){println!("ready");}', ''),
  );
  expect(recovered.end?.output).toBe('ready\n');
});
