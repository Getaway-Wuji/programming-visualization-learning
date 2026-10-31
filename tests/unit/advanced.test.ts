import { expect, test } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initSync, execute_advanced } from '../../web/src/generated/advanced/c_viz_advanced';
import { engineBuild } from '../../web/src/generated/advanced/engine-build';
import { advancedRequest } from '../../web/src/engine/advanced-client';
import {
  encodeAdvancedRequest,
  decodeAdvancedResult,
  canonicalAdvancedJson,
  type AdvancedRequest,
} from '../../web/src/engine/advanced-protocol';
import { memoryRequest } from '../../web/src/engine/memory-client';
import { decodeMemoryResult } from '../../web/src/engine/memory-protocol';
const module = new WebAssembly.Module(
  new Uint8Array(readFileSync('web/src/generated/advanced/c_viz_advanced_bg.wasm')),
);
initSync({ module });
const records: { request: AdvancedRequest; result: unknown }[] = [];
async function run(
  source: string,
  language: 'c' | 'cpp',
  input: AdvancedRequest['input'] = { kind: 'integers', values: [] },
) {
  const request = advancedRequest(source, language, input);
  const bytes = execute_advanced(encodeAdvancedRequest(request), engineBuild.wasmSha256, 1000);
  const result = await decodeAdvancedResult(bytes.slice().buffer, request, engineBuild.wasmSha256);
  expect(new TextDecoder().decode(bytes)).toBe(canonicalAdvancedJson(result));
  records.push({ request, result });
  return { result, request, bytes };
}
test('real packets reject old consumers, wrong versions, identity and corrupt string state', async () => {
  const source = readFileSync('shared/fixtures/advanced/strings.cpp', 'utf8');
  const { result, request, bytes } = await run(source, 'cpp', {
    kind: 'lines',
    values: ['abc', 'z'],
  });
  expect(result.terminal.status).toBe('completed');
  await expect(
    decodeMemoryResult(bytes.slice().buffer, memoryRequest(source, 'cpp'), engineBuild.wasmSha256),
  ).rejects.toThrow('E_PROTOCOL_INVALID');
  for (const mutate of [
    (r: typeof result) => {
      r.identity.runId = 'wrong';
    },
    (r: typeof result) => {
      r.dslVersion = '1.2.0' as '1.3.0';
    },
    (r: typeof result) => {
      r.types.find((t) => t.kind === 'string')!.byteSize = 64;
    },
    (r: typeof result) => {
      r.trace!.steps[0].kind = 'future.event';
    },
  ]) {
    const copy = structuredClone(result);
    mutate(copy);
    await expect(
      decodeAdvancedResult(
        new TextEncoder().encode(canonicalAdvancedJson(copy)).buffer,
        request,
        engineBuild.wasmSha256,
      ),
    ).rejects.toThrow('E_PROTOCOL_INVALID');
  }
  const old = memoryRequest('int main(){return 0;}', 'c');
  expect(() =>
    execute_advanced(
      new TextEncoder().encode(canonicalAdvancedJson(old)),
      engineBuild.wasmSha256,
      1000,
    ),
  ).toThrow();
});
test('unsupported syntax and new language boundaries are static, even unreachable', async () => {
  for (const [body, language] of [
    ['std::string s;', 'c'],
    ["return 'a';", 'c'],
    ['char x;', 'cpp'],
    ['int x=0;x++;', 'cpp'],
    ['std::string s;std::cin>>s;', 'cpp'],
    ["std::string s;s[0]='a';", 'cpp'],
    ['std::string s;std::string t;s=s+t;', 'cpp'],
    ['std::string s="abc";', 'cpp'],
    ['std::string s[2];', 'cpp'],
    ["return 'é';", 'cpp'],
    ["return 'ab';", 'cpp'],
    ['int n=scanf("%d",&n);', 'c'],
    ['int a;int b;scanf("%d%d",&a,&b);', 'c'],
    ['int a;scanf("%d",a);', 'c'],
  ] as const) {
    const source =
      '#include <' +
      (language === 'c' ? 'stdio.h' : 'iostream') +
      '>\n' +
      (language === 'cpp' ? '#include <string>\n' : '') +
      'int main(){if(0){' +
      body +
      '}return 0;}';
    const { result } = await run(source, language);
    expect(result.terminal.status, body).toBe('error');
    expect(result.trace, body).toBeNull();
  }
});
test('character promotion, signed boundaries, empty string and indexed C input', async () => {
  for (const [source, lang, input, want] of [
    [
      "#include <iostream>\nint main(){std::cout<<'a'<< ('a'==97) << ('b'-'a');return 0;}",
      'cpp',
      { kind: 'integers', values: [] },
      'a11',
    ],
    [
      '#include <stdio.h>\nint main(){int a[2];scanf("%d",&a[1]);printf("%d",a[1]);return 0;}',
      'c',
      { kind: 'integers', values: [-999] },
      '-999',
    ],
  ] as const) {
    const { result } = await run(source, lang, { kind: 'integers', values: [...input.values] });
    expect(result.terminal.status).toBe('completed');
    expect(
      result
        .trace!.steps.flatMap((s) => s.changes)
        .filter((c) => c.op === 'output')
        .map((c) => c.append)
        .join(''),
    ).toBe(want);
  }
});
test('bounded input rejects wrong kinds, oversized data and non-ASCII', async () => {
  for (const input of [
    { kind: 'lines', values: ['é'] },
    { kind: 'lines', values: ['a'.repeat(31)] },
    { kind: 'lines', values: ['a', 'b', 'c'] },
    { kind: 'integers', values: Array(31).fill(0) },
    { kind: 'integers', values: [1000] },
  ]) {
    const req = advancedRequest('int main(){return 0;}', 'cpp', input as AdvancedRequest['input']);
    expect(() => encodeAdvancedRequest(req)).toThrow('E_PROTOCOL_INVALID');
    expect(() =>
      execute_advanced(
        new TextEncoder().encode(canonicalAdvancedJson(req)),
        engineBuild.wasmSha256,
        1000,
      ),
    ).toThrow();
  }
  const src =
    '#include <iostream>\n#include <string>\nint main(){std::string s;std::getline(std::cin,s);std::cout<<s[-1];}';
  const { result } = await run(src, 'cpp', { kind: 'lines', values: ['x'] });
  expect(result.terminal.code).toBe('E_STRING_BOUNDS');
});
test('public evidence packets are retained for independent Schema verification', () => {
  mkdirSync('.artifacts/17.2', { recursive: true });
  writeFileSync('.artifacts/17.2/packets.json', JSON.stringify(records));
  expect(records.length).toBeGreaterThan(15);
});
