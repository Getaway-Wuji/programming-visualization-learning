import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { initSync, execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
import { AdvancedExecutionClient, advancedRequest } from '../../web/src/engine/advanced-client';
import {
  encodeAdvancedRequest,
  decodeAdvancedResult,
} from '../../web/src/engine/advanced-protocol';
import { CustomCodeController } from '../../web/src/custom-code/controller';
import { assertCustomDraft } from '../../web/src/storage/custom-draft';
import { upgradeV7Meta } from '../../web/src/storage/v7-migration';
import { createMeta } from '../../web/src/storage/model';
initSync({
  module: new WebAssembly.Module(
    new Uint8Array(readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
  ),
});
const source =
  '#include <stdio.h>\nint main(){\n int n=2;\n n=n+1;\n printf("%d",n);\n return 0;\n}';
async function sample() {
  const req = advancedRequest(source, 'c');
  return decodeAdvancedResult(
    execute_advanced(encodeAdvancedRequest(req), engineBuild.wasmSha256, 1000).slice().buffer,
    req,
    engineBuild.wasmSha256,
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
test('C workbench full reverse and view changes never request another execution', async () => {
  const result = await sample();
  const client = new AdvancedExecutionClient();
  const execute = vi.spyOn(client, 'execute').mockResolvedValue(result);
  const c = new CustomCodeController(client);
  await c.execute(source, 'c', []);
  const initial = c.getSnapshot().view.state;
  c.seek(result.trace!.steps.length);
  expect(c.getSnapshot().view.state!.output).toBe('3');
  for (let i = result.trace!.steps.length - 1; i >= 0; i--) c.seek(i);
  expect(c.getSnapshot().view.state).toEqual(initial);
  expect(execute).toHaveBeenCalledTimes(1);
  c.invalidate();
});
test('late result is discarded after source revision and input invalidation', async () => {
  const result = await sample();
  const client = new AdvancedExecutionClient();
  let done!: (r: typeof result) => void;
  vi.spyOn(client, 'execute').mockReturnValue(
    new Promise((resolve) => {
      done = resolve;
    }),
  );
  const c = new CustomCodeController(client);
  const pending = c.execute(source, 'c', []);
  c.setSource('int main(){return 8;}', 'c');
  done(result);
  await pending;
  expect(c.getSnapshot().result).toBeNull();
  expect(c.getSnapshot().view.state).toBeNull();
  c.invalidate();
});
test('one scheduler pauses on line visit, retains input breakpoints and clears source breakpoints', async () => {
  const result = await sample();
  const client = new AdvancedExecutionClient();
  vi.spyOn(client, 'execute').mockResolvedValue(result);
  const c = new CustomCodeController(client);
  await c.execute(source, 'c', []);
  c.toggleBreakpoint(4);
  vi.useFakeTimers();
  c.play();
  c.setRate(4);
  c.play();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(c.getSnapshot().hit?.line).toBe(4);
  expect(c.getSnapshot().view.playing).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  c.invalidate();
  expect(c.getSnapshot().breakpoints).toEqual([4]);
  c.setSource(source + '\n', 'c');
  expect(c.getSnapshot().breakpoints).toEqual([]);
  c.invalidate();
});
test('failed execution has no previous trajectory and next run can recover', async () => {
  const result = await sample();
  const client = new AdvancedExecutionClient();
  const exec = vi.spyOn(client, 'execute').mockResolvedValue(result);
  const c = new CustomCodeController(client);
  await c.execute(source, 'c', []);
  exec.mockRejectedValueOnce(new Error('E_CANCELLED'));
  await c.execute(source, 'c', []);
  expect(c.getSnapshot().view.state).toBeNull();
  expect(c.getSnapshot().error).toBe('E_CANCELLED');
  await c.execute(source, 'c', []);
  expect(c.getSnapshot().view.cursor).toBe(0);
  c.invalidate();
});
test('draft records preserve invalid source, reject unexpected persisted data and bound UTF8 bytes', () => {
  const draft = {
    draftVersion: '1.0.0',
    generation: crypto.randomUUID(),
    revision: 1,
    source: 'int main( {',
    updatedAt: '2026-10-31T12:00:00.000Z',
  };
  expect(() => assertCustomDraft(draft)).not.toThrow();
  expect(() => assertCustomDraft({ ...draft, source: 'x'.repeat(32768) })).not.toThrow();
  expect(() => assertCustomDraft({ ...draft, source: '你'.repeat(10923) })).toThrow();
  for (const change of [
    { input: [7] },
    { runId: 'private' },
    { revision: 0 },
    { generation: 'bad' },
  ])
    expect(() => assertCustomDraft({ ...draft, ...change })).toThrow();
  expect(() => assertCustomDraft({ ...draft, draftVersion: '2.0.0' })).toThrow('S_VERSION_UNKNOWN');
});
test('SAVE7 migration keeps meta identity and other fields, rejects future without mutation', () => {
  const before = {
    ...createMeta({
      activePackageRef: { id: 'content.c.p0', version: '1.0.2' },
      generation: crypto.randomUUID(),
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-31T12:00:00.000Z',
    }),
    schemaVersion: '7.0.0',
    dbVersion: 7,
  };
  const original = structuredClone(before);
  expect(upgradeV7Meta(before)).toEqual({
    ...before,
    schemaVersion: '9.0.0',
    dbVersion: 9,
    revision: before.revision + 1,
  });
  expect(before).toEqual(original);
  expect(() => upgradeV7Meta({ ...before, schemaVersion: '9.0.0' })).toThrow('S_VERSION_UNKNOWN');
});
