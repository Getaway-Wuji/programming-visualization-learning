import * as Blockly from 'blockly/core';
import { setTeachingBlocklyLocale } from '../blocks/definitions';
import type { RustNode, RustResponse } from '../engine/rust2018-protocol';
import { rustSourcePositions } from './source';

const prefix = 'rust2018_';
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const integer = /^(?:0|-?[1-9][0-9]*)$/u;
const ops = ['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '==', '!=', '&&', '||'];
const field = (name: string, text: string) => ({ type: 'field_input', name, text });
const value = (name: string) => ({ type: 'input_value', name });
const body = (name: string) => ({ type: 'input_statement', name });
const select = (name: string, options: [string, string][]) => ({
  type: 'field_dropdown',
  name,
  options,
});
const definitions = [
  ['main', 'Rust · fn main %1', [body('BODY')], 'root'],
  [
    'declare',
    '绑定 %1 %2 类型 %3 初值 %4',
    [
      select('MUT', [
        ['不可变', ''],
        ['可变 mut', 'mut'],
      ]),
      field('NAME', 'n'),
      select('TYPE', [
        ['推断', ''],
        ['i32', 'i32'],
        ['bool', 'bool'],
      ]),
      value('VALUE'),
    ],
    'statement',
  ],
  ['assign', '将 %1 设为 %2', [field('NAME', 'n'), value('VALUE')], 'statement'],
  ['print', 'println! 输出 %1', [value('VALUE')], 'statement'],
  ['literal', '整数 %1', [field('VALUE', '0')], 'value'],
  [
    'bool',
    '布尔 %1',
    [
      select('VALUE', [
        ['true', 'true'],
        ['false', 'false'],
      ]),
    ],
    'value',
  ],
  ['name', '变量 %1', [field('VALUE', 'n')], 'value'],
  [
    'unary',
    '%1 %2',
    [
      select('OP', [
        ['-', '-'],
        ['!', '!'],
      ]),
      value('VALUE'),
    ],
    'value',
  ],
  [
    'binary',
    '%1 %2 %3',
    [
      value('LEFT'),
      select(
        'OP',
        ops.map((op) => [op, op]),
      ),
      value('RIGHT'),
    ],
    'value',
  ],
] as const;

export const rustToolbox = {
  kind: 'flyoutToolbox',
  contents: definitions.map(([type]) => ({ kind: 'block', type: prefix + type })),
};

function register() {
  setTeachingBlocklyLocale();
  Blockly.defineBlocksWithJsonArray(
    definitions
      .filter(([type]) => !Blockly.Blocks[prefix + type])
      .map(([type, message0, args0, shape]) => ({
        type: prefix + type,
        message0,
        args0,
        colour: shape === 'value' ? 40 : 170,
        ...(shape === 'value'
          ? { output: null }
          : shape === 'root'
            ? {}
            : { previousStatement: null, nextStatement: null }),
      })),
  );
}

type BlockState = Blockly.serialization.blocks.State;
interface TreeNode extends RustNode {
  children: TreeNode[];
}
const compact = (text: string) => text.replace(/[\s()]/gu, '');

/** Consume only the actual analyzer's mapped AST; every source token must round-trip. */
export function rustToBlocks(
  source: string,
  nodes: RustNode[],
  analysis: RustResponse['analysis'],
): BlockState {
  const unsupported = () =>
    new Error(
      '当前积木支持 fn main 中的 let、赋值和单值 println!，以及整数、布尔算式；这份代码保留在源码编辑器中。',
    );
  if (
    analysis?.status !== 'mapped' ||
    analysis.blockMap.length !== nodes.length ||
    new Set(analysis.blockMap).size !== nodes.length ||
    nodes.some((node) => !analysis.blockMap.includes(node.id))
  )
    throw unsupported();
  const positions = rustSourcePositions(source);
  const slice = (start: number, end: number) => {
    const a = positions.get(start),
      b = positions.get(end);
    if (!a || !b || start > end) throw unsupported();
    return source.slice(a.utf16Offset, b.utf16Offset).trim();
  };
  const raw = (node: RustNode) => slice(node.byteRange.start, node.byteRange.end);
  const roots: TreeNode[] = [],
    stack: TreeNode[] = [];
  for (const node of nodes.toSorted(
    (a, b) =>
      a.byteRange.start - b.byteRange.start || b.byteRange.end - a.byteRange.end || b.id - a.id,
  )) {
    while (
      stack.length &&
      (stack.at(-1)!.byteRange.end < node.byteRange.end ||
        stack.at(-1)!.byteRange.end <= node.byteRange.start)
    )
      stack.pop();
    const entry = { ...node, children: [] };
    (stack.at(-1)?.children ?? roots).push(entry);
    stack.push(entry);
  }
  const make = (
    type: string,
    fields?: Record<string, string>,
    inputs: Record<string, BlockState | undefined> = {},
  ): BlockState => ({
    type: prefix + type,
    fields,
    inputs: Object.fromEntries(
      Object.entries(inputs).flatMap(([slot, block]) => (block ? [[slot, { block }]] : [])),
    ),
  });
  function expr(node: TreeNode, depth = 0): BlockState {
    if (depth > 48) throw unsupported();
    const [a, b] = node.children,
      token = raw(node);
    if (!a && node.kind === 'int' && integer.test(token)) return make('literal', { VALUE: token });
    if (!a && node.kind === 'bool' && ['true', 'false'].includes(token))
      return make('bool', { VALUE: token });
    if (!a && node.kind === 'name' && identifier.test(token)) return make('name', { VALUE: token });
    if (a && !b && node.kind === 'unary') {
      const op = compact(slice(node.byteRange.start, a.byteRange.start));
      if (['-', '!'].includes(op)) return make('unary', { OP: op }, { VALUE: expr(a, depth + 1) });
    }
    if (a && b && node.children.length === 2 && node.kind === 'binary') {
      const op = compact(slice(a.byteRange.end, b.byteRange.start));
      if (ops.includes(op))
        return make('binary', { OP: op }, { LEFT: expr(a, depth + 1), RIGHT: expr(b, depth + 1) });
    }
    throw unsupported();
  }
  function statement(node: TreeNode) {
    const [a, b] = node.children;
    if (node.kind === 'let' && a && !b) {
      const match = /^let\s+(?:(mut)\s+)?([A-Za-z_]\w*)\s*(?::\s*(i32|bool)\s*)?=\s*\(*$/u.exec(
        slice(node.byteRange.start, a.byteRange.start),
      );
      if (match)
        return make(
          'declare',
          { MUT: match[1] ?? '', NAME: match[2], TYPE: match[3] ?? '' },
          { VALUE: expr(a) },
        );
    }
    if (
      node.kind === 'assign' &&
      a &&
      b &&
      node.children.length === 2 &&
      a.kind === 'name' &&
      !a.children.length &&
      identifier.test(raw(a))
    )
      return make('assign', { NAME: raw(a) }, { VALUE: expr(b) });
    if (
      node.kind === 'print' &&
      a &&
      !b &&
      /^println\s*!\s*\(\s*"\{\}"\s*,\s*\(*$/u.test(slice(node.byteRange.start, a.byteRange.start))
    )
      return make('print', undefined, { VALUE: expr(a) });
    throw unsupported();
  }
  const [main] = roots;
  if (
    roots.length !== 1 ||
    main.kind !== 'function' ||
    main.children.length !== 1 ||
    main.children[0].kind !== 'block' ||
    !/^fn\s+main\s*\(\s*\)\s*\{/u.test(raw(main))
  )
    throw unsupported();
  let first: BlockState | undefined, previous: BlockState | undefined;
  for (const child of main.children[0].children) {
    const block = statement(child);
    if (!first) first = block;
    if (previous) previous.next = { block };
    previous = block;
  }
  const result = make('main', undefined, { BODY: first });
  register();
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.blocks.append(result, workspace);
    if (compact(rustFromBlocks(workspace)) !== compact(source)) throw unsupported();
  } finally {
    workspace.dispose();
  }
  return result;
}

export function rustFromBlocks(workspace: Blockly.Workspace) {
  const roots = workspace.getTopBlocks(true);
  if (roots.length !== 1 || roots[0].type !== prefix + 'main')
    throw new Error('请将积木连接到唯一的 Rust fn main 块。');
  let visited = 0;
  const bounded = (depth: number) => {
    if (++visited > 4096 || depth > 48) throw new Error('积木超过编辑范围。');
  };
  const pick = (block: Blockly.Block, key: string) => String(block.getFieldValue(key) ?? '');
  const name = (block: Blockly.Block, key: string) => {
    const token = pick(block, key);
    if (!identifier.test(token)) throw new Error('请填写有效的 Rust 名称。');
    return token;
  };
  function expr(parent: Blockly.Block, key: string, depth: number): string {
    const block = parent.getInputTargetBlock(key);
    if (!block) throw new Error('请补齐积木的值。');
    bounded(depth);
    const op = pick(block, 'OP');
    switch (block.type) {
      case prefix + 'literal': {
        const token = pick(block, 'VALUE');
        if (!integer.test(token) || Number(token) < -2147483648 || Number(token) > 2147483647)
          throw new Error('请输入 -2147483648 到 2147483647 的整数。');
        return token;
      }
      case prefix + 'bool':
        if (['true', 'false'].includes(pick(block, 'VALUE'))) return pick(block, 'VALUE');
        break;
      case prefix + 'name':
        return name(block, 'VALUE');
      case prefix + 'unary':
        if (['-', '!'].includes(op)) return `(${op}${expr(block, 'VALUE', depth + 1)})`;
        break;
      case prefix + 'binary':
        if (ops.includes(op))
          return `(${expr(block, 'LEFT', depth + 1)} ${op} ${expr(block, 'RIGHT', depth + 1)})`;
        break;
    }
    throw new Error('此处需要有效的 Rust 表达式积木。');
  }
  const lines = ['fn main() {'];
  for (let block = roots[0].getInputTargetBlock('BODY'); block; block = block.getNextBlock()) {
    bounded(0);
    switch (block.type) {
      case prefix + 'declare': {
        const mutable = pick(block, 'MUT'),
          type = pick(block, 'TYPE');
        if (!['', 'mut'].includes(mutable) || !['', 'i32', 'bool'].includes(type))
          throw new Error('请选择有效的绑定类型。');
        lines.push(
          `    let ${mutable ? 'mut ' : ''}${name(block, 'NAME')}${type ? ': ' + type : ''} = ${expr(block, 'VALUE', 0)};`,
        );
        break;
      }
      case prefix + 'assign':
        lines.push(`    ${name(block, 'NAME')} = ${expr(block, 'VALUE', 0)};`);
        break;
      case prefix + 'print':
        lines.push(`    println!("{}", ${expr(block, 'VALUE', 0)});`);
        break;
      default:
        throw new Error('发现无法转换为 Rust 语句的积木。');
    }
  }
  return lines.join('\n') + '\n}\n';
}
