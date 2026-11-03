import { expect, it, vi } from 'vitest';
import { assertC6Meta, createC6ResetMeta } from '../../web/src/storage/c6-reset';
import { assertRecord, assertSnapshot } from '../../web/src/storage/validation';
import { createMeta, emptySnapshot } from '../../web/src/storage/model';

const generation = '00000000-0000-4000-8000-000000000001';
const at = '2026-11-03T00:00:00.000Z';
it('SAVE10 metadata has an exact active C6 catalog while the legacy constructor remains SAVE9', () => {
  const current = createC6ResetMeta(generation, 'Asia/Shanghai', at);
  assertRecord('meta', current);
  assertRecord('meta', { ...current, revision: 4 });
  assertSnapshot(emptySnapshot(current));
  const legacy = createMeta({
    generation,
    timeZone: 'Asia/Shanghai',
    createdAt: at,
    activePackageRef: { id: 'content.c.p05', version: '1.0.0' },
  });
  expect(legacy.schemaVersion).toBe('9.0.0');
  assertRecord('meta', legacy);
  expect(() =>
    assertRecord('meta', { ...legacy, activeCatalogSetRef: current.activeCatalogSetRef }),
  ).toThrow();
});
it.each(['old-package', 'wrong-catalog', 'extra-key', 'unsafe-revision', 'wrong-version'])(
  'rejects mixed metadata: %s',
  (fault) => {
    const value = structuredClone(createC6ResetMeta(generation, 'UTC', at));
    if (fault === 'old-package')
      Object.assign(value.activePackageRef, { id: 'content.c.p05', version: '1.0.0' });
    if (fault === 'wrong-catalog') Object.assign(value.activeCatalogSetRef, { version: '1.0.0' });
    if (fault === 'extra-key') Object.assign(value, { previousGeneration: generation });
    if (fault === 'unsafe-revision') value.revision = Number.MAX_SAFE_INTEGER + 1;
    if (fault === 'wrong-version') Object.assign(value, { dbVersion: 9 });
    expect(() => assertC6Meta(value)).toThrow();
  },
);
it('metadata accessors are rejected before they can execute', () => {
  const value = createC6ResetMeta(generation, 'UTC', at),
    getter = vi.fn(() => generation);
  Object.defineProperty(value, 'generation', { enumerable: true, get: getter });
  expect(() => assertC6Meta(value)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
