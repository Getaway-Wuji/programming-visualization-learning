import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';
import { expect, test } from '@playwright/test';

let moduleCode = '';
test.beforeAll(async () => {
  const output = await build({
    configFile: false,
    logLevel: 'error',
    build: {
      write: false,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./harness/reviewed-case-release.ts', import.meta.url)),
        formats: ['es'],
      },
    },
  });
  const result = (Array.isArray(output) ? output[0] : output) as Rollup.RollupOutput;
  const entry = result.output.find((item) => item.type === 'chunk' && item.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Reviewed-release test entry missing');
  moduleCode = entry.code;
});
test.beforeEach(async ({ page }) => {
  await page.route('**/checks/reviewed-release.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: moduleCode }),
  );
  await page.goto('/checks/');
});

for (const version of ['1.0.0', '1.0.1'])
  test(`native IDB upgrades reviewed predecessor ${version} with only a meta write`, async ({
    page,
  }) => {
    const result = await page.evaluate(async (version) => {
      const moduleUrl = '/checks/reviewed-release.js';
      const { openStorage } = (await import(
        moduleUrl
      )) as typeof import('./harness/reviewed-case-release');
      const client = await openStorage({
        name: `reviewed-case-${crypto.randomUUID()}`,
        recovery: true,
        activePackageRef: { id: 'content.c.p0', version },
        timeZone: 'Asia/Shanghai',
      });
      try {
        const initial = await client.read();
        await client.commit(initial.meta.generation, () => [
          {
            store: 'progress',
            mode: 'add',
            value: {
              eventType: 'case.view-confirmed',
              result: 'confirmed',
              subjectRef: { id: 'case.c.bubble-sort', version: '1.0.1' },
              packageRef: { id: 'content.c.p0', version: '1.0.1' },
              learningRevision: 1,
              firstAt: '2026-10-25T02:00:00.000Z',
              lastAt: '2026-10-25T02:00:00.000Z',
            },
          },
          {
            store: 'ledger',
            mode: 'add',
            value: {
              sourceId: 'reward.case.first-view',
              subjectId: 'case.c.bubble-sort',
              occurredAt: '2026-10-25T02:00:00.000Z',
              localDate: '2026-10-25',
              status: 'pending',
              points: null,
              policyRef: null,
            },
          },
        ]);
        const before = await client.read();
        const writes: string[] = [];
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
          writes.push(this.name);
          return original.call(this, value, key);
        };
        let switched;
        try {
          switched = await client.switchReviewedCaseRelease(
            before.meta.generation,
            before.meta.revision,
          );
        } finally {
          IDBObjectStore.prototype.put = original;
        }
        const after = await client.read();
        const repeated = await client.switchReviewedCaseRelease(
          after.meta.generation,
          after.meta.revision,
        );
        return { before, after, writes, switched, repeated, final: await client.read() };
      } finally {
        client.close();
      }
    }, version);
    expect(result.writes).toEqual(['meta']);
    expect(result.after.meta).toEqual({
      ...result.before.meta,
      revision: result.before.meta.revision + 1,
      activePackageRef: { id: 'content.c.p0', version: '1.0.2' },
    });
    expect({ ...result.after, meta: result.before.meta }).toEqual(result.before);
    expect(result.repeated.revision).toBe(result.after.meta.revision);
    expect(result.final).toEqual(result.after);
  });

test('native IDB competing CAS and quota/abort failures preserve data and allow an explicit retry', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const moduleUrl = '/checks/reviewed-release.js';
    const { openStorage } = (await import(
      moduleUrl
    )) as typeof import('./harness/reviewed-case-release');
    const name = `reviewed-case-${crypto.randomUUID()}`;
    const client = await openStorage({
      name,
      activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
    });
    const other = await openStorage({
      name,
      activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
    });
    const code = (error: unknown) => (error as { code: string }).code;
    try {
      const before = await client.read();
      const errors: string[] = [];
      const unchanged: boolean[] = [];
      for (const fault of ['quota', 'abort']) {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, key) {
          if (this.name !== 'meta') return original.call(this, value, key);
          if (fault === 'quota')
            throw new DOMException('Injected quota fault', 'QuotaExceededError');
          const request = original.call(this, value, key);
          request.addEventListener('success', () => this.transaction.abort());
          return request;
        };
        try {
          await client.switchReviewedCaseRelease(before.meta.generation, before.meta.revision);
        } catch (error) {
          errors.push(code(error));
        } finally {
          IDBObjectStore.prototype.put = original;
        }
        unchanged.push(JSON.stringify(await client.read()) === JSON.stringify(before));
      }
      const outcomes = await Promise.allSettled([
        client.switchReviewedCaseRelease(before.meta.generation, before.meta.revision),
        other.switchReviewedCaseRelease(before.meta.generation, before.meta.revision),
      ]);
      return {
        errors,
        unchanged,
        outcomes: outcomes.map((entry) =>
          entry.status === 'fulfilled' ? 'saved' : code(entry.reason),
        ),
        after: await client.read(),
        before,
      };
    } finally {
      other.close();
      client.close();
    }
  });
  expect(result.errors).toEqual(['S_QUOTA', 'S_ABORTED']);
  expect(result.unchanged).toEqual([true, true]);
  expect(result.outcomes.sort()).toEqual(['S_REVISION_CONFLICT', 'saved'].sort());
  expect(result.after.meta.revision).toBe(result.before.meta.revision + 1);
});

test('native IDB refuses unknown metadata packages and stale generation without writing', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const moduleUrl = '/checks/reviewed-release.js';
    const { openStorage } = (await import(
      moduleUrl
    )) as typeof import('./harness/reviewed-case-release');
    const client = await openStorage({
      name: `reviewed-case-${crypto.randomUUID()}`,
      activePackageRef: { id: 'content.foreign', version: '1.0.1' },
    });
    try {
      const before = await client.read();
      const errors: string[] = [];
      for (const generation of [before.meta.generation, crypto.randomUUID()]) {
        try {
          await client.switchReviewedCaseRelease(generation, before.meta.revision);
        } catch (error) {
          errors.push((error as { code: string }).code);
        }
      }
      return { errors, unchanged: JSON.stringify(await client.read()) === JSON.stringify(before) };
    } finally {
      client.close();
    }
  });
  expect(result.errors).toEqual(['S_CONTENT_INCOMPATIBLE', 'S_GENERATION_STALE']);
  expect(result.unchanged).toBe(true);
});
