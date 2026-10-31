// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { p05CourseRelease } from '../../web/src/content/p05-course-release.generated';
const bytes = readFileSync('web/public/' + p05CourseRelease.file);
const valid = () =>
  new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/json' } });
const damaged = () => {
  const data = new Uint8Array(bytes);
  data[0] ^= 1;
  return new Response(data);
};
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('location', new URL('https://example.test/'));
});
afterEach(() => vi.unstubAllGlobals());
it('verified public bytes can use HTTP cache while each realm independently validates them', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => valid());
  let loader = await import('../../web/src/content/course-bundle');
  const first = await loader.loadCourseBundle(fetcher);
  expect(first).not.toBeNull();
  expect(Object.isFrozen(first)).toBe(true);
  await loader.loadCourseBundle(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.resetModules();
  loader = await import('../../web/src/content/course-bundle');
  expect(await loader.loadCourseBundle(fetcher)).toEqual(first);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(
    fetcher.mock.calls.every(
      ([, options]) =>
        options?.cache === 'force-cache' &&
        options.credentials === 'omit' &&
        options.redirect === 'error' &&
        options.referrerPolicy === 'no-referrer',
    ),
  ).toBe(true);
});
it('stale cached bytes require one fresh response and cannot supply any authority themselves', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(async () => damaged())
    .mockImplementationOnce(async () => valid());
  const loader = await import('../../web/src/content/course-bundle');
  expect(await loader.loadCourseBundle(fetcher)).not.toBeNull();
  expect(fetcher.mock.calls.map(([, options]) => options?.cache)).toEqual([
    'force-cache',
    'reload',
  ]);
  expect(loader.courseBundleFailure()).toBeNull();
});
it('bad cached and fresh bytes both fail; explicit retry goes to the network without accepting bad content', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => damaged());
  const loader = await import('../../web/src/content/course-bundle');
  expect(await loader.loadCourseBundle(fetcher)).toBeNull();
  expect(loader.currentCourseBundle()).toBeNull();
  expect(loader.courseBundleFailure()).toBe('COURSE_BUNDLE_INTEGRITY');
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockImplementation(async () => valid());
  expect(await loader.loadCourseBundle(fetcher, true)).not.toBeNull();
  expect(fetcher.mock.calls.at(-1)?.[1]?.cache).toBe('reload');
});
