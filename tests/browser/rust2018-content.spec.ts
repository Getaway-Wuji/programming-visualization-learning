import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type {} from './harness/rust2018';
import type { RustLesson, RustManifest } from '../../web/src/rust2018-course/repository';

const manifest = JSON.parse(
  readFileSync('content/rust2018/course/manifest-1.0.0.json', 'utf8'),
) as RustManifest;

test('Rust all published assets match the manifest and the verified lazy repository covers every node', async ({
  page,
  request,
}) => {
  const release = await request.get('/content/rust2018/course/manifest-1.0.0.json');
  expect(await release.json()).toEqual(manifest);
  for (const asset of [...manifest.chunks, manifest.sourceFile, manifest.registryFile]) {
    const response = await request.get('/content/rust2018/course/' + asset.file);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    expect(bytes.length).toBe(asset.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
  }
  await page.goto('/checks/rust2018.html');
  await page.waitForFunction(() => Boolean(window.rust2018Harness));
  const content = await page.evaluate(() => window.rust2018Harness.content());
  expect(content.counts).toEqual(manifest.counts);
  expect(content.nodes.map((row) => row.id)).toEqual(manifest.catalog.map((row) => row.id));
  expect(content.nodes.filter((row) => row.mode === 'reading')).toHaveLength(287);
  expect(content.nodes.filter((row) => row.activity === 'self-check')).toHaveLength(287);
  expect(content.nodes.filter((row) => row.mode === 'wasm')).toHaveLength(12);
  expect(content.nodes.filter((row) => row.activity === 'judge')).toHaveLength(12);
});

for (const group of [1, 3, 4]) {
  test(`Rust published current-source examples and every judge selection / unit ${group}`, async ({
    page,
    request,
  }) => {
    await page.goto('/checks/rust2018.html');
    await page.waitForFunction(() => Boolean(window.rust2018Harness));
    const asset = manifest.chunks[group - 1];
    const response = await request.get('/content/rust2018/course/' + asset.file);
    const chunk = (await response.json()) as { nodes: RustLesson[] };
    const examples = chunk.nodes.filter((row) => row.example?.mode === 'wasm');
    expect(examples.length).toBeGreaterThan(0);
    for (const node of examples) {
      const example = node.example!;
      const activity = node.activity!;
      expect(activity.mode).toBe('judge');
      if (activity.mode !== 'judge') throw new Error('Expected published judge');
      expect(example.cases).toHaveLength(4);
      for (const [reviewCase, group] of example.cases!.entries()) {
        const result = await page.evaluate(
          ({ source, input }) => window.rust2018Harness.run(source, input),
          { source: example.source, input: group.input },
        );
        expect(result.response.status).toBe('completed');
        expect(result.end?.output).toBe(group.expected);
        expect(result.receipt?.request.source).toBe(example.source);
        expect(result.receipt?.request.operation).toBe('execute');
        if (result.receipt?.request.operation !== 'execute')
          throw new Error('Expected execution receipt');
        expect(result.receipt.request.input).toBe(group.input);
        expect(result.rewound).toEqual(result.initial);
        const judged = await page.evaluate(
          ({ source, id, reviewCase }) => window.rust2018Harness.judge(source, id, reviewCase),
          { source: example.source, id: activity.profile, reviewCase },
        );
        expect(judged.response.judgement?.passed).toBe(true);
        expect(judged.response.judgement?.cases).toHaveLength(4);
        expect(judged.response.judgement?.reviewCase).toBe(reviewCase);
        expect(judged.end?.output).toBe(group.expected);
        expect(judged.rewound).toEqual(judged.initial);
      }
    }
  });
}

test('Rust altered course bytes are rejected by the repository', async ({ page }) => {
  await page.route('**/content/rust2018/course/unit-01-1.0.0.json', async (route) => {
    const response = await route.fetch();
    const bytes = await response.body();
    const position = bytes.indexOf(Buffer.from('入门指南'));
    expect(position).toBeGreaterThan(0);
    bytes[position] ^= 1;
    await route.fulfill({ response, body: bytes });
  });
  await page.goto('/checks/rust2018.html');
  await page.waitForFunction(() => Boolean(window.rust2018Harness));
  expect(
    await page.evaluate(() =>
      window.rust2018Harness.content().then(
        () => 'accepted',
        (error: Error) => error.message,
      ),
    ),
  ).toBe('E_RUST_CONTENT_HASH');
});
