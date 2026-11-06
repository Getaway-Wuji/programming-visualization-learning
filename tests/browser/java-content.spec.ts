import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const manifest = JSON.parse(
  readFileSync(new URL('../../content/java/course/manifest-1.0.0.json', import.meta.url), 'utf8'),
) as { chunks: { articleSourceOrder: number; file: string; bytes: number; sha256: string }[] };
const profileArticles = [6, 7, 11, 12, 13, 17, 19, 22];

interface CourseChunk {
  examples: {
    lessonId: string;
    status: string;
    source?: string;
    cases?: { input: string; stdout: string }[];
  }[];
  activities: { id: string; lessonId: string; kind: string }[];
}

test('all article assets use the exact published manifest and original hashes', async ({
  request,
}) => {
  const release = await request.get('/content/java/course/manifest-1.0.0.json');
  expect(release.ok()).toBe(true);
  expect(await release.json()).toEqual(manifest);
  for (const entry of manifest.chunks) {
    const response = await request.get('/content/java/course/' + entry.file);
    expect(response.ok()).toBe(true);
    const body = await response.body();
    expect(body.byteLength).toBe(entry.bytes);
    expect(createHash('sha256').update(body).digest('hex')).toBe(entry.sha256);
  }
});

for (const order of profileArticles) {
  test(`Java published examples and judges / article ${order}`, async ({ page }) => {
    await page.goto('/checks/java.html');
    await page.waitForFunction(() => Boolean(window.javaHarness));
    const file = manifest.chunks.find((row) => row.articleSourceOrder === order)!.file;
    const response = await page.request.get('/content/java/course/' + file);
    expect(response.ok()).toBe(true);
    const chunk: CourseChunk = await response.json();
    const runnable = chunk.examples.filter(({ status }) => status === 'runnable-required');
    expect(runnable.length).toBeGreaterThan(0);
    for (const example of runnable) {
      const source = example.source!;
      const activity = chunk.activities.find((row) => row.lessonId === example.lessonId);
      expect(activity?.kind).toBe('rust-judge');
      const cases = example.cases!;
      expect(cases).toHaveLength(4);
      for (const { input, stdout } of cases) {
        const result = await page.evaluate(
          ({ source, input }) => window.javaHarness.run(source, input),
          { source, input },
        );
        expect(result.proof?.request.source).toBe(source);
        expect(result.terminal.status).toBe('completed');
        expect(result.end?.state.output).toBe(stdout);
      }
      const judge = await page.evaluate(({ source, id }) => window.javaHarness.judge(source, id), {
        source,
        id: activity!.id,
      });
      expect(judge.status).toBe('passed');
      expect(judge.cases).toHaveLength(4);
      expect(
        judge.cases.every(
          ({ stdoutMatches, observationMatches }) => stdoutMatches && observationMatches,
        ),
      ).toBe(true);
    }
  });
}
