import * as Blockly from 'blockly/core';
import { setTeachingBlocklyLocale } from '../blocks/definitions';
import type { JavaNode } from '../engine/java-types';
import { javaPositions } from '../engine/java-protocol';

const types = ['int', 'long', 'boolean', 'String'];
const binary = ['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '==', '!=', '&&', '||'];
const unary = ['+', '-', '!'];
const printMethods = ['println', 'print'];
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const literal = /^(?:true|false|-?(?:0|[1-9][0-9]*)[lL]?|"(?:[^"\\\r\n]|\\[nrt\\"'])*")$/u;
const text = (name: string, initial: string) => ({ type: 'field_input', name, text: initial });
const select = (name: string, items: string[]) => ({
  type: 'field_dropdown',
  name,
  options: items.map((item) => [item, item]),
});
const expressionInput = (name: string) => ({ type: 'input_value', name });
const bodyInput = (name: string) => ({ type: 'input_statement', name });
const prefix = 'java_';

function define(
  type: string,
  message0: string,
  args0: object[],
  shape: 'root' | 'control' | 'statement' | 'value',
) {
  const key = prefix + type;
  if (Blockly.Blocks[key]) return;
  Blockly.defineBlocksWithJsonArray([
    {
      type: key,
      message0,
      args0,
      colour: shape === 'value' ? 40 : shape === 'statement' ? 170 : 200,
      ...(shape === 'value'
        ? { output: null }
        : shape === 'root'
          ? {}
          : { previousStatement: null, nextStatement: null }),
    },
  ]);
}

function registerJavaBlocks() {
  setTeachingBlocklyLocale();
  define(
    'main',
    '类 %1 · main 参数 %2 %3',
    [text('CLASS', 'Main'), text('ARGS', 'args'), bodyInput('BODY')],
    'root',
  );
  define(
    'declare',
    '声明 %1 %2 为 %3',
    [select('TYPE', types), text('NAME', 'n'), expressionInput('VALUE')],
    'statement',
  );
  define('assign', '将 %1 设为 %2', [text('NAME', 'n'), expressionInput('VALUE')], 'statement');
  define(
    'print',
    '输出 %1 %2',
    [select('METHOD', printMethods), expressionInput('VALUE')],
    'statement',
  );
  define('newline', '输出换行', [], 'statement');
  define('if', '如果 %1 则 %2', [expressionInput('COND'), bodyInput('BODY')], 'control');
  define(
    'if_else',
    '如果 %1 则 %2 否则 %3',
    [expressionInput('COND'), bodyInput('BODY'), bodyInput('ELSE')],
    'control',
  );
  define('while', '当 %1 时重复 %2', [expressionInput('COND'), bodyInput('BODY')], 'control');
  define('literal', '常量 %1', [text('TEXT', '0')], 'value');
  define('name', '变量 %1', [text('NAME', 'n')], 'value');
  define('unary', '%1 %2', [select('OP', unary), expressionInput('VALUE')], 'value');
  define(
    'binary',
    '%1 %2 %3',
    [expressionInput('LEFT'), select('OP', binary), expressionInput('RIGHT')],
    'value',
  );
}

export const javaToolbox = {
  kind: 'flyoutToolbox',
  contents: [
    'main',
    'declare',
    'assign',
    'print',
    'newline',
    'if',
    'if_else',
    'while',
    'literal',
    'name',
    'unary',
    'binary',
  ].map((type) => ({ kind: 'block', type: prefix + type })),
};

interface MappedNode extends JavaNode {
  children: MappedNode[];
}
type BlockState = Blockly.serialization.blocks.State;

function forest(nodes: JavaNode[]) {
  const roots: MappedNode[] = [];
  const stack: MappedNode[] = [];
  for (const node of nodes.toSorted(
    (a, b) =>
      a.byteRange.start - b.byteRange.start ||
      b.byteRange.end - a.byteRange.end ||
      b.nodeId - a.nodeId,
  )) {
    while (
      stack.length &&
      (stack.at(-1)!.byteRange.end < node.byteRange.end ||
        stack.at(-1)!.byteRange.end <= node.byteRange.start)
    )
      stack.pop();
    const mapped = { ...node, children: [] };
    (stack.at(-1)?.children ?? roots).push(mapped);
    stack.push(mapped);
  }
  return roots;
}

export function javaBlocks(source: string, nodes: JavaNode[]): BlockState {
  const positions = javaPositions(source);
  const sourceAt = (start: number, end: number) =>
    source.slice(positions.get(start)!.utf16Offset, positions.get(end)!.utf16Offset);
  const raw = (node: MappedNode) => sourceAt(node.byteRange.start, node.byteRange.end).trim();
  const make = (node: MappedNode, type: string, fields?: Record<string, string>): BlockState => ({
    type: prefix + type,
    id: 'java-node-' + node.nodeId,
    fields,
  });
  const connect = (block: BlockState, input: string, child?: BlockState) => {
    if (child) (block.inputs ??= {})[input] = { block: child };
  };
  const invalid = () => new Error('当前代码的积木映射不完整，原稿已保留。');

  function expression(node: MappedNode): BlockState {
    const [left, right] = node.children;
    if (node.kind === 'literal')
      return make(node, 'literal', { TEXT: raw(node).replace(/^-\s+/u, '-') });
    if (node.kind === 'name') return make(node, 'name', { NAME: raw(node) });
    if (node.kind === 'group' && left) return expression(left);
    if (node.kind === 'unary' && left) {
      const block = make(node, 'unary', {
        OP: sourceAt(node.byteRange.start, left.byteRange.start).trim(),
      });
      connect(block, 'VALUE', expression(left));
      return block;
    }
    if (node.kind === 'binary' && left && right) {
      const block = make(node, 'binary', {
        OP: sourceAt(left.byteRange.end, right.byteRange.start).trim(),
      });
      connect(block, 'LEFT', expression(left));
      connect(block, 'RIGHT', expression(right));
      return block;
    }
    throw invalid();
  }

  function statements(body: MappedNode) {
    if (body.kind !== 'block') throw invalid();
    let first: BlockState | undefined;
    let last: BlockState | undefined;
    for (const item of body.children) {
      const next = statement(item);
      if (last) last.next = { block: next };
      else first = next;
      last = next;
    }
    return first;
  }

  function statement(node: MappedNode): BlockState {
    const [first, second, third] = node.children;
    if (node.kind === 'declare' && first) {
      const head = sourceAt(node.byteRange.start, first.byteRange.start);
      const match = /^(int|long|boolean|String)\s+([A-Za-z_]\w*)\s*=\s*$/u.exec(head);
      if (!match) throw invalid();
      const block = make(node, 'declare', { TYPE: match[1], NAME: match[2] });
      connect(block, 'VALUE', expression(first));
      return block;
    }
    if (node.kind === 'assign' && first?.kind === 'name' && second) {
      const block = make(node, 'assign', { NAME: raw(first) });
      connect(block, 'VALUE', expression(second));
      return block;
    }
    if (node.kind === 'call-statement' && first?.kind === 'receiver-call') {
      const [receiver, argument] = first.children;
      if (!receiver) throw invalid();
      const method = /^\.\s*(print|println)\s*\(/u.exec(
        sourceAt(receiver.byteRange.end, first.byteRange.end).trim(),
      )?.[1];
      if (!method) throw invalid();
      if (!argument) return make(node, 'newline');
      const block = make(node, 'print', { METHOD: method });
      connect(block, 'VALUE', expression(argument));
      return block;
    }
    if ((node.kind === 'if' || node.kind === 'while') && first && second) {
      const block = make(node, third ? 'if_else' : node.kind);
      connect(block, 'COND', expression(first));
      connect(block, 'BODY', statements(second));
      if (third) {
        if (third.kind !== 'scope' || third.children.length !== 1) throw invalid();
        connect(block, 'ELSE', statements(third.children[0]));
      }
      return block;
    }
    throw invalid();
  }

  const roots = forest(nodes);
  const [method] = roots;
  const className = /^\s*public\s+class\s+([A-Za-z_]\w*)\s*\{/u.exec(source)?.[1];
  const argsName =
    method &&
    /^public\s+static\s+void\s+main\s*\(\s*String\s*\[\s*\]\s*([A-Za-z_]\w*)\s*\)/u.exec(
      raw(method),
    )?.[1];
  if (
    !className ||
    !argsName ||
    roots.length !== 1 ||
    method.kind !== 'method' ||
    method.children.length !== 1
  )
    throw invalid();
  registerJavaBlocks();
  const root = make(method, 'main', { CLASS: className, ARGS: argsName });
  connect(root, 'BODY', statements(method.children[0]));
  return root;
}

export function javaFromBlocks(workspace: Blockly.Workspace): string {
  const roots = workspace.getTopBlocks(true);
  const [root] = roots;
  if (roots.length !== 1 || root.type !== prefix + 'main')
    throw Error('请将积木连入唯一的 main 程序块。');
  const field = (block: Blockly.Block, key: string) => String(block.getFieldValue(key) ?? '');
  const name = (block: Blockly.Block, key: string) => {
    const result = field(block, key);
    if (!identifier.test(result)) throw Error('请填写有效的 Java 名称。');
    return result;
  };
  const choice = (block: Blockly.Block, key: string, options: string[]) => {
    const result = field(block, key);
    if (!options.includes(result)) throw Error('积木选项无效。');
    return result;
  };
  let visited = 0;
  function value(block: Blockly.Block, slot: string, depth: number): string {
    const child = block.getInputTargetBlock(slot);
    if (!child) throw Error('请补齐积木的值。');
    if (++visited > 4096 || depth > 48) throw Error('积木程序超过编辑范围。');
    switch (child.type) {
      case 'java_literal': {
        const result = field(child, 'TEXT');
        if (!literal.test(result)) throw Error('请输入本工作台支持的 Java 常量。');
        return result;
      }
      case 'java_name':
        return name(child, 'NAME');
      case 'java_unary':
        return '(' + choice(child, 'OP', unary) + ' ' + value(child, 'VALUE', depth + 1) + ')';
      case 'java_binary':
        return (
          '(' +
          value(child, 'LEFT', depth + 1) +
          ' ' +
          choice(child, 'OP', binary) +
          ' ' +
          value(child, 'RIGHT', depth + 1) +
          ')'
        );
      default:
        throw Error('此位置需要一个表达式积木。');
    }
  }
  function statements(first: Blockly.Block | null, indentation: string, depth: number): string {
    if (depth > 48) throw Error('积木嵌套过深。');
    const lines: string[] = [];
    for (let block = first; block; block = block.getNextBlock()) {
      if (++visited > 4096) throw Error('积木程序超过编辑范围。');
      const emit = (line: string) => lines.push(indentation + line + '\n');
      if (block.type === 'java_declare') {
        emit(
          choice(block, 'TYPE', types) +
            ' ' +
            name(block, 'NAME') +
            ' = ' +
            value(block, 'VALUE', depth) +
            ';',
        );
      } else if (block.type === 'java_assign') {
        emit(name(block, 'NAME') + ' = ' + value(block, 'VALUE', depth) + ';');
      } else if (block.type === 'java_print') {
        emit(
          'System.out.' +
            choice(block, 'METHOD', printMethods) +
            '(' +
            value(block, 'VALUE', depth) +
            ');',
        );
      } else if (block.type === 'java_newline') {
        emit('System.out.println();');
      } else if (['java_if', 'java_if_else', 'java_while'].includes(block.type)) {
        emit(
          (block.type === 'java_while' ? 'while' : 'if') +
            ' (' +
            value(block, 'COND', depth) +
            ') {',
        );
        lines.push(statements(block.getInputTargetBlock('BODY'), indentation + '    ', depth + 1));
        if (block.type === 'java_if_else') {
          emit('} else {');
          lines.push(
            statements(block.getInputTargetBlock('ELSE'), indentation + '    ', depth + 1),
          );
        }
        emit('}');
      } else {
        throw Error('发现无法转换成 Java 语句的积木。');
      }
    }
    return lines.join('');
  }
  const body = statements(root.getInputTargetBlock('BODY'), '        ', 0);
  return (
    'public class ' +
    name(root, 'CLASS') +
    ' {\n    public static void main(String[] ' +
    name(root, 'ARGS') +
    ') {\n' +
    body +
    '    }\n}\n'
  );
}
