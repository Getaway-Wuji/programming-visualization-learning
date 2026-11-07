import { readFileSync } from 'node:fs';
import * as Blockly from 'blockly/core';
import { beforeAll, expect, test } from 'vitest';
import { execute_rust2018, initSync } from '../../web/src/generated/rust2018/c_viz_rust2018';
import { rust2018Build } from '../../web/src/generated/rust2018/engine-build';
import {
  decodeRustResponse,
  rustRequest,
  type RustOperation,
} from '../../web/src/engine/rust2018-protocol';
import { Rust2018Player } from '../../web/src/engine/rust2018-player';
import { rustFromBlocks, rustToBlocks } from '../../web/src/rust2018-course/blocks';
import { rustSourcePositions } from '../../web/src/rust2018-course/source';

beforeAll(() =>
  initSync({
    module: new Uint8Array(readFileSync('web/src/generated/rust2018/c_viz_rust2018_bg.wasm')),
  }),
);

async function execute(source: string, operation: RustOperation = { operation: 'analyze' }) {
  const { request, bytes } = rustRequest(source, operation, 'blocks-unit');
  const raw = execute_rust2018(bytes, rust2018Build.wasmSha256, 1000).slice().buffer as ArrayBuffer;
  return decodeRustResponse(raw, request, rust2018Build.wasmSha256, () => {});
}
async function mapped(source: string) {
  const response = await execute(source);
  expect(response.status).toBe('completed');
  return rustToBlocks(source, response.nodeMap, response.analysis);
}

test.each([
  [
    'typed mutable arithmetic',
    'fn main(){let mut n: i32 = 2; n = (n + 3) * 4; println!("{}", n);}',
    '20\n',
  ],
  [
    'bool and comparison',
    'fn main(){let ok: bool = !(2 > 4) && true; println!("{}", ok);}',
    'true\n',
  ],
  ['shadow and negative', 'fn main(){let n = 9; let n = -n + 2; println!("{}", n);}', '-7\n'],
  ['i32 minimum', 'fn main(){println!("{}", -2147483648);}', '-2147483648\n'],
  ['grouped operators', 'fn main(){let n = (2 + 3) * (4 - 1); println!("{}", (n));}', '15\n'],
])(
  '%s maps actual AST to editable blocks and executes the generated Rust',
  async (_title, source, expected) => {
    const state = await mapped(source);
    const workspace = new Blockly.Workspace();
    try {
      Blockly.serialization.blocks.append(state, workspace);
      const generated = rustFromBlocks(workspace);
      const response = await execute(generated, { operation: 'execute', input: '' });
      expect(response.status).toBe('completed');
      const player = new Rust2018Player(response.replay!);
      expect(player.seek(player.length).output).toBe(expected);
      expect(player.seek(0)).toEqual(response.replay!.trace.initialState);
    } finally {
      workspace.dispose();
    }
  },
);

test.each([
  'fn main(){let n = String::from("原稿"); println!("{}", n);}',
  'fn main(){let mut n = 0; while n < 2 {n = n + 1;} println!("{}", n);}',
  'fn main(){println!("前缀 {}", 2);}',
  'fn main(){print!("{}", 2);}',
  'fn main(){let n = 2; /* keep this explanation */ println!("{}", n);}',
  'fn main(){let n = 2;; println!("{}", n);}',
])('code outside the whitelist preserves its source: %s', async (source) => {
  const original = source;
  const response = await execute(source);
  expect(response.status).toBe('completed');
  expect(() => rustToBlocks(source, response.nodeMap, response.analysis)).toThrow('保留');
  expect(source).toBe(original);
});

test('incomplete mapping cannot silently discard an AST node', async () => {
  const source = 'fn main(){let n = 1; println!("{}", n);}';
  const response = await execute(source);
  expect(() =>
    rustToBlocks(source, response.nodeMap, {
      status: 'mapped',
      blockMap: response.analysis!.blockMap.slice(1),
    }),
  ).toThrow('保留');
});

test('disconnected blocks and invalid integer fields never generate code', async () => {
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.blocks.append(await mapped('fn main(){println!("{}", 1);}'), workspace);
    const literal = workspace
      .getAllBlocks(false)
      .find((block) => block.type === 'rust2018_literal')!;
    literal.setFieldValue('2147483648', 'VALUE');
    expect(() => rustFromBlocks(workspace)).toThrow('整数');
    literal.setFieldValue('1', 'VALUE');
    workspace.newBlock('rust2018_literal');
    expect(() => rustFromBlocks(workspace)).toThrow('唯一');
  } finally {
    workspace.dispose();
  }
});

test('UTF-8 positions preserve supplementary characters and CRLF source locations', () => {
  const positions = rustSourcePositions('中😀\r\nfn main() {}');
  expect(positions.get(7)).toEqual({ utf16Offset: 3, line: 1, column: 3 });
  expect(positions.get(9)).toEqual({ utf16Offset: 5, line: 2, column: 1 });
  expect(positions.has(4)).toBe(false);
});
