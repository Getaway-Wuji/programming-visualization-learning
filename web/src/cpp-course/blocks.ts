import * as Blockly from 'blockly/core';
import { setTeachingBlocklyLocale } from '../blocks/definitions';
import type { AdvancedNode } from '../engine/advanced-protocol';
import { cppSourcePositions } from './source';

const prefix = 'cpp_';
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const integer = /^(?:0|[1-9][0-9]*)$/u;
const ops = ['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '==', '!=', '&&', '||'];
const field = (name: string, text: string) => ({ type: 'field_input', name, text });
const value = (name: string) => ({ type: 'input_value', name });
const body = (name: string) => ({ type: 'input_statement', name });
const select = (name: string, options: string[]) => ({
  type: 'field_dropdown',
  name,
  options: options.map((item) => [item, item]),
});
const definitions = [
  ['main', 'C++ · main %1', [body('BODY')], 'root'],
  ['declare', '整数 %1 初值 %2', [field('NAME', 'n'), value('VALUE')], 'statement'],
  ['assign', '将 %1 设为 %2', [field('NAME', 'n'), value('VALUE')], 'statement'],
  ['read', '读取整数到 %1', [field('NAME', 'n')], 'statement'],
  ['print', '输出 %1 %2', [value('VALUE'), select('END', ['换行', '不换行'])], 'statement'],
  ['if', '如果 %1 则 %2', [value('COND'), body('BODY')], 'statement'],
  ['if_else', '如果 %1 则 %2 否则 %3', [value('COND'), body('BODY'), body('ELSE')], 'statement'],
  ['while', '当 %1 时重复 %2', [value('COND'), body('BODY')], 'statement'],
  ['literal', '整数 %1', [field('VALUE', '0')], 'value'],
  ['name', '变量 %1', [field('VALUE', 'n')], 'value'],
  ['unary', '%1 %2', [select('OP', ['+', '-', '!']), value('VALUE')], 'value'],
  ['binary', '%1 %2 %3', [value('LEFT'), select('OP', ops), value('RIGHT')], 'value'],
] as const;

export const cppToolbox = {
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
interface TreeNode extends AdvancedNode {
  children: TreeNode[];
}

export function cppToBlocks(source: string, nodes: AdvancedNode[]): BlockState {
  const unsupported = () => new Error('这份代码超出当前积木映射范围，编辑器保留原稿。');
  const positions = cppSourcePositions(source);
  const slice = (start: number, end: number) =>
    source.slice(positions.get(start)?.utf16Offset, positions.get(end)?.utf16Offset).trim();
  const raw = (node: TreeNode) => slice(node.byteRange.start, node.byteRange.end);
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  for (const node of nodes.toSorted(
    (a, b) =>
      a.byteRange.start - b.byteRange.start ||
      b.byteRange.end - a.byteRange.end ||
      Number(b.nodeId.slice(1)) - Number(a.nodeId.slice(1)),
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
  function expression(node: TreeNode, depth = 0): BlockState {
    if (node.kind !== 'expression' || depth > 48) throw unsupported();
    const [a, b] = node.children;
    const token = raw(node)
      .replace(/^\(+\s*|\s*\)+$/gu, '')
      .trim();
    if (!a && integer.test(token)) return make('literal', { VALUE: token });
    if (!a && identifier.test(token)) return make('name', { VALUE: token });
    if (a && b && node.children.length === 2) {
      const op = slice(a.byteRange.end, b.byteRange.start);
      if (ops.includes(op))
        return make(
          'binary',
          { OP: op },
          { LEFT: expression(a, depth + 1), RIGHT: expression(b, depth + 1) },
        );
    }
    if (a && !b) {
      const op = slice(node.byteRange.start, a.byteRange.start).replace(/^\(+\s*/u, '');
      if (['+', '-', '!'].includes(op))
        return make('unary', { OP: op }, { VALUE: expression(a, depth + 1) });
    }
    throw unsupported();
  }
  function statements(node: TreeNode, depth: number): BlockState | undefined {
    if (node.kind !== 'block' || depth > 48) throw unsupported();
    let first: BlockState | undefined;
    let previous: BlockState | undefined;
    for (const child of node.children) {
      const block = statement(child, depth);
      if (!first) first = block;
      if (previous) previous.next = { block };
      previous = block;
    }
    return first;
  }
  function statement(node: TreeNode, depth: number): BlockState {
    const [a, b, c] = node.children;
    if (node.kind === 'declaration' && a) {
      const match = /^int\s+([A-Za-z_]\w*)\s*=$/u.exec(
        slice(node.byteRange.start, a.byteRange.start),
      );
      if (match && !b) return make('declare', { NAME: match[1] }, { VALUE: expression(a) });
    }
    if (node.kind === 'assignment' && a && b && identifier.test(raw(a)))
      return make('assign', { NAME: raw(a) }, { VALUE: expression(b) });
    if (
      node.kind === 'input' &&
      a &&
      !b &&
      identifier.test(raw(a)) &&
      /^std\s*::\s*cin\s*>>/u.test(raw(node))
    )
      return make('read', { NAME: raw(a) });
    if (
      node.kind === 'output' &&
      a &&
      !b &&
      /^std\s*::\s*cout\s*<<$/u.test(slice(node.byteRange.start, a.byteRange.start))
    ) {
      const end = slice(a.byteRange.end, node.byteRange.end);
      if (/^(?:<<\s*std\s*::\s*endl\s*)?;$/u.test(end))
        return make('print', { END: end === ';' ? '不换行' : '换行' }, { VALUE: expression(a) });
    }
    if ((node.kind === 'if' || node.kind === 'while') && a && b)
      return make(c ? 'if_else' : node.kind, undefined, {
        COND: expression(a),
        BODY: statements(b, depth + 1),
        ELSE: c && statements(c, depth + 1),
      });
    throw unsupported();
  }
  const [main] = roots;
  if (
    roots.length !== 1 ||
    main.kind !== 'function' ||
    main.children.length !== 1 ||
    !/^int\s+main\s*\(\s*(?:void\s*)?\)/u.test(raw(main))
  )
    throw unsupported();
  const result = make('main', undefined, { BODY: statements(main.children[0], 0) });
  register();
  return result;
}

export function cppFromBlocks(workspace: Blockly.Workspace) {
  const roots = workspace.getTopBlocks(true);
  if (roots.length !== 1 || roots[0].type !== 'cpp_main')
    throw new Error('请将积木连接到唯一的 C++ main 块。');
  let visited = 0;
  const bounded = (depth: number) => {
    if (++visited > 4096 || depth > 48) throw new Error('积木超过编辑范围。');
  };
  const pick = (block: Blockly.Block, key: string) => String(block.getFieldValue(key) ?? '');
  const name = (block: Blockly.Block, key: string) => {
    const token = pick(block, key);
    if (!identifier.test(token)) throw new Error('请填写有效的 C++ 名称。');
    return token;
  };
  function expr(parent: Blockly.Block, key: string, depth: number): string {
    const block = parent.getInputTargetBlock(key);
    if (!block) throw new Error('请补齐积木的值。');
    bounded(depth);
    const op = pick(block, 'OP');
    switch (block.type) {
      case 'cpp_literal': {
        const token = pick(block, 'VALUE');
        if (!integer.test(token) || Number(token) > 2147483647)
          throw new Error('请输入 0 到 2147483647 的整数。');
        return token;
      }
      case 'cpp_name':
        return name(block, 'VALUE');
      case 'cpp_unary':
        if (['+', '-', '!'].includes(op)) return `(${op} ${expr(block, 'VALUE', depth + 1)})`;
        break;
      case 'cpp_binary':
        if (ops.includes(op))
          return `(${expr(block, 'LEFT', depth + 1)} ${op} ${expr(block, 'RIGHT', depth + 1)})`;
        break;
    }
    throw new Error('此处需要一个有效的 C++ 表达式积木。');
  }
  function chain(first: Blockly.Block | null, depth: number): string {
    const indent = '    '.repeat(depth + 1);
    const lines: string[] = [];
    const add = (line: string) => lines.push(indent + line + '\n');
    for (let block = first; block; block = block.getNextBlock()) {
      bounded(depth);
      switch (block.type) {
        case 'cpp_declare':
          add(`int ${name(block, 'NAME')} = ${expr(block, 'VALUE', depth)};`);
          break;
        case 'cpp_assign':
          add(`${name(block, 'NAME')} = ${expr(block, 'VALUE', depth)};`);
          break;
        case 'cpp_read':
          add(`std::cin >> ${name(block, 'NAME')};`);
          break;
        case 'cpp_print':
          add(
            `std::cout << ${expr(block, 'VALUE', depth)}${pick(block, 'END') === '换行' ? ' << std::endl' : ''};`,
          );
          break;
        case 'cpp_if':
        case 'cpp_if_else':
        case 'cpp_while':
          add(`${block.type === 'cpp_while' ? 'while' : 'if'} (${expr(block, 'COND', depth)}) {`);
          lines.push(chain(block.getInputTargetBlock('BODY'), depth + 1));
          if (block.type === 'cpp_if_else') {
            add('} else {');
            lines.push(chain(block.getInputTargetBlock('ELSE'), depth + 1));
          }
          add('}');
          break;
        default:
          throw new Error('发现无法转换为 C++ 语句的积木。');
      }
    }
    return lines.join('');
  }
  return (
    '#include <iostream>\nint main() {\n' + chain(roots[0].getInputTargetBlock('BODY'), 0) + '}\n'
  );
}
