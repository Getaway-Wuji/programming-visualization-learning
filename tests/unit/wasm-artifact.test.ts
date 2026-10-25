import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { inspectWasm } from '../../scripts/wasm-inspect.mjs';

describe('final wasm-bindgen build artifact', () => {
  test('declares the 128 MiB ceiling and imports no WASI or shared memory', async () => {
    const artifact = await readFile(
      new URL('../../web/src/generated/c_viz_wasm_bg.wasm', import.meta.url),
    );
    expect([...artifact.subarray(0, 8)]).toEqual([0, 97, 115, 109, 1, 0, 0, 0]);
    const inspected = inspectWasm(artifact);
    expect(inspected.memories).toHaveLength(1);
    expect(inspected.memories[0].maximum).toBe(2048);
    expect(inspected.memories[0].minimum).toBeGreaterThan(0);
    expect(inspected.memories[0].minimum).toBeLessThanOrEqual(2048);
    expect(inspected.memories[0].shared).toBe(false);
    const enabledFeatures = inspected.features
      .filter((feature) => feature.startsWith('+'))
      .map((feature) => feature.slice(1));
    expect(enabledFeatures).not.toContain('atomics');
    expect(enabledFeatures).not.toContain('threads');
    expect(
      inspected.imports.some((entry) => /wasi|shared/i.test(`${entry.module}/${entry.name}`)),
    ).toBe(false);
    expect(inspected.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'memory', kind: 'memory' }),
        expect.objectContaining({ name: 'build_probe', kind: 'function' }),
      ]),
    );
  });
});
