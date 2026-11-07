import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { execute_cpp_course, initSync } from '../../web/src/generated/cpp-course/c_viz_cpp_course';
import { cppCourseBuild } from '../../web/src/generated/cpp-course/engine-build';
import { canonicalAdvancedJson } from '../../web/src/engine/advanced-protocol';
import { cppRequest, decodeCppResponse } from '../../web/src/engine/cpp-course-protocol';

test('validation preserves native C++ packet records and rejects a forged reverse value', async () => {
  initSync({
    module: new Uint8Array(readFileSync('web/src/generated/cpp-course/c_viz_cpp_course_bg.wasm')),
  });
  const input = { kind: 'integers' as const, values: [] };
  const { request, bytes } = cppRequest(
    'int main(){int n=0; do{n=n+1;}while(n<3); return n;}',
    { operation: 'execute', input },
    'course-test',
  );
  const build = cppCourseBuild.wasmSha256;
  const raw = execute_cpp_course(bytes, build, 1000).slice().buffer as ArrayBuffer;
  const decode = (buffer: ArrayBuffer) =>
    decodeCppResponse(buffer, request, build, input, () => {});
  const accepted = await decode(raw);
  expect(accepted.replay?.terminal.returnValue).toBe(3);
  expect(canonicalAdvancedJson(accepted)).toBe(new TextDecoder().decode(raw));
  const write = accepted.replay?.trace?.steps
    .flatMap((step) => step.changes)
    .find((change) => change.op === 'cell');
  expect(write?.op).toBe('cell');
  if (write?.op !== 'cell') throw new Error('Expected a real cell write');
  write.before = 99;
  await expect(
    decode(new TextEncoder().encode(canonicalAdvancedJson(accepted)).buffer),
  ).rejects.toThrow('E_PROTOCOL_INVALID');
});
