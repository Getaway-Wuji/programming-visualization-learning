import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { initSync, execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
import { advancedRequest } from '../../web/src/engine/advanced-client';
import {
  canonicalAdvancedJson,
  decodeAdvancedResult,
  encodeAdvancedRequest,
} from '../../web/src/engine/advanced-protocol';

initSync({
  module: new WebAssembly.Module(
    new Uint8Array(readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
  ),
});
const bytes = (v: unknown) => new TextEncoder().encode(canonicalAdvancedJson(v));
test('real WASM rejects oversized request independently of source UTF-8 size and then executes fresh code', async () => {
  const request = advancedRequest('\u0000'.repeat(12000), 'c');
  expect(new TextEncoder().encode(request.source)).toHaveLength(12000);
  expect(bytes(request).length).toBeGreaterThan(65536);
  expect(() => encodeAdvancedRequest(request)).toThrow('E_PROTOCOL_INVALID');
  expect(() => execute_advanced(bytes(request), engineBuild.wasmSha256, 1000)).toThrow();
  const fresh = advancedRequest('int main(){return 37;}', 'c');
  const raw = execute_advanced(encodeAdvancedRequest(fresh), engineBuild.wasmSha256, 1000);
  const result = await decodeAdvancedResult(raw.slice().buffer, fresh, engineBuild.wasmSha256);
  expect(result.terminal).toMatchObject({ status: 'completed', returnValue: 37 });
});
test('real WASM request boundary rejects wrong input shapes, extra fields, unsafe integers and forbidden C++ features in C', async () => {
  for (const mutate of [
    (r: Record<string, unknown>) => {
      r.extra = 'not allowed';
    },
    (r: Record<string, unknown>) => {
      r.input = { kind: 'integers', values: [9007199254740992] };
    },
    (r: Record<string, unknown>) => {
      r.input = { kind: 'integers', values: [0], trace: [] };
    },
    (r: Record<string, unknown>) => {
      r.input = { kind: 'lines', values: ['text'] };
    },
    (r: Record<string, unknown>) => {
      r.input = { kind: 'integers', values: new Array(31).fill(0) };
    },
  ]) {
    const request = advancedRequest('int main(){return 0;}', 'c');
    mutate(request as unknown as Record<string, unknown>);
    expect(() => encodeAdvancedRequest(request)).toThrow('E_PROTOCOL_INVALID');
    expect(() => execute_advanced(bytes(request), engineBuild.wasmSha256, 1000)).toThrow();
  }
  const request = advancedRequest('int main(){if(0){new int{};}return 0;}', 'c');
  const raw = execute_advanced(encodeAdvancedRequest(request), engineBuild.wasmSha256, 1000);
  const result = await decodeAdvancedResult(raw.slice().buffer, request, engineBuild.wasmSha256);
  expect(result.terminal.status).toBe('error');
  expect(result.trace).toBeNull();
});
test('strict consumer rejects over-16-MiB buffers, invalid UTF-8 and trailing executable text before acceptance', async () => {
  const request = advancedRequest('int main(){return 0;}', 'c');
  const raw = execute_advanced(encodeAdvancedRequest(request), engineBuild.wasmSha256, 1000);
  for (const buffer of [
    new ArrayBuffer(16777217),
    new Uint8Array([0xff]).buffer,
    new TextEncoder().encode(new TextDecoder().decode(raw) + '<script>alert(1)</script>').buffer,
  ])
    await expect(decodeAdvancedResult(buffer, request, engineBuild.wasmSha256)).rejects.toThrow(
      'E_PROTOCOL_INVALID',
    );
  expect(
    (await decodeAdvancedResult(raw.slice().buffer, request, engineBuild.wasmSha256)).terminal
      .status,
  ).toBe('completed');
});
