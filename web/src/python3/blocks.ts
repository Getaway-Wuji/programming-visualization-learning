import * as Blockly from 'blockly/core';
import { setTeachingBlocklyLocale } from '../blocks/definitions';
import type { PythonNode } from '../engine/python3-types';
import { pythonPositions } from '../engine/python3-protocol';

const statementKinds = new Set(['assign', 'expression', 'if', 'while', 'for', 'pass']);
const literalKinds = new Set(['none', 'bool', 'int', 'float', 'string']);
const colors = { statement: 170, control: 200, value: 40 };
const operators = [
  '+',
  '-',
  '*',
  '/',
  '//',
  '%',
  'and',
  'or',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'is',
  'is not',
];
const unary = ['+', '-', 'not'];
const textField = (name: string, text: string) => ({ type: 'field_input', name, text });
const valueInput = (name: string) => ({ type: 'input_value', name });
const statementInput = (name: string) => ({ type: 'input_statement', name });
const select = (name: string, values: string[]) => ({
  type: 'field_dropdown',
  name,
  options: values.map((item) => [item, item]),
});

function define(
  type: string,
  message0: string,
  args0: object[],
  kind: keyof typeof colors,
  output = false,
) {
  const key = 'py3_' + type;
  if (Blockly.Blocks[key]) return;
  Blockly.defineBlocksWithJsonArray([
    {
      type: key,
      message0,
      args0,
      colour: colors[kind],
      ...(output ? { output: null } : { previousStatement: null, nextStatement: null }),
    },
  ]);
}
function definePrint(length: number) {
  define(
    'print' + length,
    ['输出', ...Array.from({ length }, (_, i) => '%' + (i + 1))].join(' '),
    Array.from({ length }, (_, i) => valueInput('ARG' + i)),
    'statement',
  );
}
export function registerPythonBlocks() {
  setTeachingBlocklyLocale();
  define('assign', '将 %1 设为 %2', [textField('NAME', 'x'), valueInput('VALUE')], 'statement');
  define('pass', '空语句 pass', [], 'statement');
  define('if', '如果 %1 则 %2', [valueInput('COND'), statementInput('BODY')], 'control');
  define(
    'if_else',
    '如果 %1 则 %2 否则 %3',
    [valueInput('COND'), statementInput('BODY'), statementInput('ELSE')],
    'control',
  );
  define('while', '当 %1 时重复 %2', [valueInput('COND'), statementInput('BODY')], 'control');
  for (let length = 1; length <= 3; length++) {
    const markers = Array.from({ length }, (_, i) => '%' + (i + 2));
    define(
      'for' + length,
      '令 %1 遍历 range(' + markers.join(', ') + ') %' + (length + 2),
      [
        textField('NAME', 'i'),
        ...markers.map((_, i) => valueInput('ARG' + i)),
        statementInput('BODY'),
      ],
      'control',
    );
  }
  for (let length = 0; length <= 3; length++) definePrint(length);
  define('literal', '常量 %1', [textField('TEXT', '0')], 'value', true);
  define('name', '变量 %1', [textField('NAME', 'x')], 'value', true);
  define('unary', '%1 %2', [select('OP', unary), valueInput('VALUE')], 'value', true);
  define(
    'binary',
    '%1 %2 %3',
    [valueInput('LEFT'), select('OP', operators), valueInput('RIGHT')],
    'value',
    true,
  );
}
export const pythonToolbox = {
  kind: 'flyoutToolbox',
  contents: [
    'assign',
    'print1',
    'print0',
    'print2',
    'if',
    'if_else',
    'while',
    'for1',
    'for2',
    'for3',
    'pass',
    'literal',
    'name',
    'unary',
    'binary',
  ].map((type) => ({ kind: 'block', type: 'py3_' + type })),
};

interface MappedNode extends PythonNode {
  children: MappedNode[];
}
type BlockState = Blockly.serialization.blocks.State;

function forest(nodes: PythonNode[]) {
  const roots: MappedNode[] = [];
  const parents: MappedNode[] = [];
  const order = nodes.toSorted(
    (a, b) =>
      a.byteRange.start - b.byteRange.start ||
      b.byteRange.end - a.byteRange.end ||
      b.nodeId - a.nodeId,
  );
  for (const node of order) {
    while (parents.length && parents.at(-1)!.byteRange.end < node.byteRange.end) parents.pop();
    while (parents.length && parents.at(-1)!.byteRange.end <= node.byteRange.start) parents.pop();
    const mapped = { ...node, children: [] };
    (parents.at(-1)?.children ?? roots).push(mapped);
    parents.push(mapped);
  }
  return roots;
}

export function pythonBlocks(source: string, nodes: PythonNode[]) {
  const offsets = pythonPositions(source);
  const slice = (start: number, end: number) =>
    source.slice(offsets.get(start)!.utf16Offset, offsets.get(end)!.utf16Offset);
  const raw = (node: MappedNode) => slice(node.byteRange.start, node.byteRange.end).trim();
  const make = (node: MappedNode, type: string, fields?: Record<string, string>): BlockState => ({
    type: 'py3_' + type,
    id: 'py3-node-' + node.nodeId,
    fields,
  });
  const connect = (block: BlockState, key: string, child: BlockState | undefined) => {
    if (child) (block.inputs ??= {})[key] = { block: child };
  };
  function expression(node: MappedNode): BlockState {
    const [left, right] = node.children;
    if (literalKinds.has(node.kind)) return make(node, 'literal', { TEXT: raw(node) });
    if (node.kind === 'name') return make(node, 'name', { NAME: raw(node) });
    if (node.kind === 'group' && left) return expression(left);
    if (node.kind === 'unary' && left) {
      const block = make(node, 'unary', {
        OP: slice(node.byteRange.start, left.byteRange.start).trim(),
      });
      connect(block, 'VALUE', expression(left));
      return block;
    }
    if ((node.kind === 'binary' || node.kind === 'compare') && left && right) {
      const block = make(node, 'binary', {
        OP: slice(left.byteRange.end, right.byteRange.start).trim().replace(/\s+/gu, ' '),
      });
      connect(block, 'LEFT', expression(left));
      connect(block, 'RIGHT', expression(right));
      return block;
    }
    throw Error('E_PY_BLOCK_MAP');
  }
  function statements(items: MappedNode[]): BlockState | undefined {
    let first: BlockState | undefined;
    let last: BlockState | undefined;
    for (const item of items) {
      const next = statement(item);
      if (last) last.next = { block: next };
      else first = next;
      last = next;
    }
    return first;
  }
  function statement(node: MappedNode): BlockState {
    const [value, rhs] = node.children;
    if (node.kind === 'pass') return make(node, 'pass');
    if (node.kind === 'assign' && value?.kind === 'name' && rhs) {
      const block = make(node, 'assign', { NAME: raw(value) });
      connect(block, 'VALUE', expression(rhs));
      return block;
    }
    if (!value) throw Error('E_PY_BLOCK_MAP');
    if ((node.kind === 'for' || node.kind === 'expression') && value.kind === 'call') {
      const args = value.children.slice(1);
      const name =
        node.kind === 'for'
          ? /^for\s+([A-Za-z_]\w*)\s+in\s*$/u.exec(
              slice(node.byteRange.start, value.byteRange.start).trim(),
            )?.[1]
          : undefined;
      if (node.kind === 'for' && !name) throw Error('E_PY_BLOCK_MAP');
      if (!name) definePrint(args.length);
      const block = make(
        node,
        (name ? 'for' : 'print') + args.length,
        name ? { NAME: name } : undefined,
      );
      args.forEach((arg, i) => connect(block, 'ARG' + i, expression(arg)));
      if (name) connect(block, 'BODY', statements(node.children.slice(1)));
      return block;
    }
    if (node.kind === 'while' || node.kind === 'if') {
      const body = node.children.slice(1);
      const otherwise =
        node.kind === 'if'
          ? body.findIndex(
              (item, index) =>
                index > 0 &&
                /^\s*else\s*:\s*$/u.test(
                  slice(body[index - 1].byteRange.end, item.byteRange.start),
                ),
            )
          : -1;
      const block = make(node, otherwise < 0 ? node.kind : 'if_else');
      connect(block, 'COND', expression(value));
      connect(block, 'BODY', statements(otherwise < 0 ? body : body.slice(0, otherwise)));
      if (otherwise >= 0) connect(block, 'ELSE', statements(body.slice(otherwise)));
      return block;
    }
    throw Error('E_PY_BLOCK_MAP');
  }
  registerPythonBlocks();
  const roots = forest(nodes);
  if (roots.some((root) => !statementKinds.has(root.kind))) throw Error('E_PY_BLOCK_MAP');
  return statements(roots);
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const literal =
  /^(?:None|True|False|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|'(?:[^'\\\r\n]|\\[^\r\n])*'|"(?:[^"\\\r\n]|\\[^\r\n])*")$/u;

export function pythonFromBlocks(workspace: Blockly.Workspace): string {
  const top = workspace.getTopBlocks(true);
  if (!top.length) return '';
  if (top.length !== 1) throw Error('请把积木连接成一段程序。');
  const field = (block: Blockly.Block, key: string) => String(block.getFieldValue(key) ?? '');
  function value(block: Blockly.Block, key: string): string {
    const child = block.getInputTargetBlock(key);
    if (!child) throw Error('请补齐积木的值。');
    return expression(child);
  }
  function checkedField(block: Blockly.Block, key: string, pattern: RegExp) {
    const text = field(block, key);
    if (!pattern.test(text)) throw Error('积木字段的值不符合当前类型。');
    return text;
  }
  function expression(block: Blockly.Block): string {
    switch (block.type) {
      case 'py3_literal':
        return checkedField(block, 'TEXT', literal);
      case 'py3_name':
        return checkedField(block, 'NAME', identifier);
      case 'py3_unary':
        return '(' + field(block, 'OP') + ' ' + value(block, 'VALUE') + ')';
      case 'py3_binary':
        return (
          '(' + value(block, 'LEFT') + ' ' + field(block, 'OP') + ' ' + value(block, 'RIGHT') + ')'
        );
      default:
        throw Error('此积木不能作为值使用。');
    }
  }
  function lines(first: Blockly.Block | null, indent: string): string {
    if (!first) return indent + 'pass\n';
    const body: string[] = [];
    for (let block: Blockly.Block | null = first; block; block = block.getNextBlock()) {
      const type = block.type.slice(4);
      const child = (slot: string) => lines(block!.getInputTargetBlock(slot), indent + '    ');
      if (type === 'pass') body.push(indent + 'pass\n');
      else if (type === 'assign')
        body.push(
          indent + checkedField(block, 'NAME', identifier) + ' = ' + value(block, 'VALUE') + '\n',
        );
      else if (['if', 'if_else', 'while'].includes(type)) {
        body.push(
          indent +
            (type === 'while' ? 'while ' : 'if ') +
            value(block, 'COND') +
            ':\n' +
            child('BODY'),
        );
        if (type === 'if_else') body.push(indent + 'else:\n' + child('ELSE'));
      } else {
        const match = /^(print|for)(\d+)$/u.exec(type);
        if (!match) throw Error('无法生成此积木。');
        const args = Array.from({ length: Number(match[2]) }, (_, i) =>
          value(block!, 'ARG' + i),
        ).join(', ');
        body.push(
          match[1] === 'print'
            ? indent + 'print(' + args + ')\n'
            : indent +
                'for ' +
                checkedField(block, 'NAME', identifier) +
                ' in range(' +
                args +
                '):\n' +
                child('BODY'),
        );
      }
    }
    return body.join('');
  }
  return lines(top[0], '');
}
