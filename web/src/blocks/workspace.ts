import * as Blockly from 'blockly/core';
import { registerTeachingBlocks, type TeachingBlock } from './definitions';
import {
  BLOCK_LIMITS,
  type BlockExpression,
  type BlockProgram,
  type BlockStatement,
  type BlockInput,
} from './model';

/** A temporary, in-memory Blockly snapshot. It is never an import or storage format. */
export type BlockWorkspaceDraft = Record<string, unknown>;
export interface WorkspaceIssue {
  code: string;
  message: string;
  blockId: string | null;
}
export interface WorkspaceRead {
  program: BlockProgram | null;
  issues: WorkspaceIssue[];
}

/** Blockly 13.4 creates AudioContext even with sounds:false, including in its
 * trashcan workspace. A silent editor must not open an audio device. Injection
 * is synchronous, so hide that feature only for this call and restore the exact
 * browser descriptor before yielding; never replace the native API for a session.
 */
export function withoutWorkspaceAudio<T>(inject: () => T, target: object = window): T {
  if (typeof Reflect.get(target, 'AudioContext') !== 'function') return inject();
  const original = Object.getOwnPropertyDescriptor(target, 'AudioContext');
  if (original && !original.configurable) throw new Error('当前环境无法初始化静音积木工作区。');
  Object.defineProperty(target, 'AudioContext', {
    configurable: true,
    value: undefined,
    writable: true,
  });
  try {
    return inject();
  } finally {
    if (original) Object.defineProperty(target, 'AudioContext', original);
    else Reflect.deleteProperty(target, 'AudioContext');
  }
}

/** Blockly ids are opaque punctuation-rich strings; EXEC block ids have a smaller alphabet. */
export function protocolBlockId(nativeId: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(nativeId)) return nativeId;
  return `block.native.${Array.from(new TextEncoder().encode(nativeId), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function formatField(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}
function parseFormat(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\\') result += text[index];
    else {
      const next = text[++index];
      if (next === 'n') result += '\n';
      else if (next === '\\' || next === '"') result += next;
      else throw new Error('输出格式只允许 \\n、\\\\ 和 \\" 转义。');
    }
  }
  return result;
}

export function inputBlocks(program: BlockProgram): BlockInput[] {
  const found: BlockInput[] = [];
  const visit = (statements: readonly BlockStatement[]) => {
    for (const statement of statements) {
      if (statement.kind === 'input') found.push(statement);
      else if (statement.kind === 'if') {
        visit(statement.then);
        if (statement.else) visit(statement.else);
      } else if (
        statement.kind === 'while' ||
        statement.kind === 'for' ||
        statement.kind === 'scope'
      )
        visit(statement.body);
    }
  };
  visit(program.body);
  return found;
}

/** Construct actual Blockly blocks, preserving every IR node id. No source parsing occurs. */
export function loadBlockProgram(workspace: Blockly.Workspace, program: BlockProgram): void {
  registerTeachingBlocks();
  Blockly.Events.disable();
  try {
    workspace.clear();
    const make = (node: BlockProgram | BlockStatement | BlockExpression): Blockly.Block => {
      const block = workspace.newBlock(
        `cv_${node.kind === 'input' ? (node.targetKind === 'array' ? 'array_declare' : 'declare') : node.kind}`,
        node.id,
      );
      const field = (name: string, value: string) => block.setFieldValue(value, name);
      const value = (name: string, child: BlockExpression | null) => {
        if (child) block.getInput(name)!.connection!.connect(make(child).outputConnection!);
      };
      const body = (name: string, children: readonly BlockStatement[]) => {
        let connection = block.getInput(name)!.connection!;
        for (const child of children) {
          const next = make(child);
          connection.connect(next.previousConnection!);
          connection = next.nextConnection!;
        }
      };
      switch (node.kind) {
        case 'main':
          body('BODY', node.body);
          break;
        case 'input':
          block.loadExtraState!({
            binding: { bindingKey: node.bindingKey, name: node.name, targetKind: node.targetKind },
          });
          break;
        case 'integer':
          field('VALUE', node.value);
          break;
        case 'variable':
          field('NAME', node.name);
          break;
        case 'declare':
          field('NAME', node.name);
          field('INITIALIZE', node.initial ? 'TRUE' : 'FALSE');
          value('INITIAL', node.initial);
          break;
        case 'assign':
          field('NAME', node.name);
          value('VALUE', node.value);
          break;
        case 'unary':
          field('OP', node.operator);
          value('OPERAND', node.operand);
          break;
        case 'arithmetic':
        case 'compare':
        case 'logic':
          field('OP', node.operator);
          value('LEFT', node.left);
          value('RIGHT', node.right);
          break;
        case 'if':
          value('CONDITION', node.condition);
          body('THEN', node.then);
          field('HAS_ELSE', node.else ? 'TRUE' : 'FALSE');
          if (node.else) body('ELSE', node.else);
          break;
        case 'while':
          value('CONDITION', node.condition);
          body('BODY', node.body);
          break;
        case 'for':
          if (node.init) body('INIT', [node.init]);
          value('CONDITION', node.condition);
          if (node.update) body('UPDATE', [node.update]);
          body('BODY', node.body);
          break;
        case 'array_declare':
          field('NAME', node.name);
          field('LENGTH', node.length);
          field('VALUES', node.values?.join(', ') ?? '');
          break;
        case 'array_read':
          field('NAME', node.name);
          value('INDEX', node.index);
          break;
        case 'array_write':
          field('NAME', node.name);
          value('INDEX', node.index);
          value('VALUE', node.value);
          break;
        case 'print':
          field('FORMAT', formatField(node.format));
          node.args.forEach((arg, index) => value(`ARG${index}`, arg));
          break;
        case 'return':
          value('VALUE', node.value);
          break;
        case 'scope':
          body('BODY', node.body);
          break;
        case 'break':
        case 'continue':
          break;
      }
      return block;
    };
    make(program);
    if (workspace.rendered) {
      for (const block of workspace.getAllBlocks(false)) (block as Blockly.BlockSvg).initSvg();
      (workspace as Blockly.WorkspaceSvg).render();
    }
    workspace.clearUndo();
  } finally {
    Blockly.Events.enable();
  }
}

export function saveBlockWorkspaceDraft(workspace: Blockly.Workspace): BlockWorkspaceDraft {
  return Blockly.serialization.workspaces.save(workspace);
}
export function loadBlockWorkspaceDraft(
  workspace: Blockly.Workspace,
  draft: BlockWorkspaceDraft,
): void {
  registerTeachingBlocks();
  Blockly.Events.disable();
  try {
    Blockly.serialization.workspaces.load(draft, workspace);
    workspace.clearUndo();
  } finally {
    Blockly.Events.enable();
  }
}

/** Structural checks run before the C generator; incomplete edits remain as a draft. */
export function readBlockWorkspace(
  workspace: Blockly.Workspace,
  expectedInputs: readonly BlockInput[] = [],
): WorkspaceRead {
  const issues: WorkspaceIssue[] = [];
  const issue = (block: Blockly.Block | null, code: string, message: string) => {
    const mapped = block ? protocolBlockId(block.id) : null;
    issues.push({ code, message, blockId: mapped && mapped.length <= 96 ? mapped : null });
  };
  const blocks = workspace.getAllBlocks(false);
  const protocolIds = new Set<string>();
  for (const block of blocks) {
    const mapped = protocolBlockId(block.id);
    if (mapped.length > 96)
      issue(block, 'BLOCK_ID_LIMIT', '积木标识超过执行接口的容量，请删除该积木后重新添加。');
    else if (protocolIds.has(mapped))
      issue(block, 'BLOCK_ID_COLLISION', '两个积木的执行标识重复，请删除重复积木后重新添加。');
    protocolIds.add(mapped);
  }
  if (blocks.length > BLOCK_LIMITS.nodes)
    return {
      program: null,
      issues: [
        {
          code: 'BLOCK_LIMIT',
          message: `积木数量超过 ${BLOCK_LIMITS.nodes} 块，请减少程序规模。`,
          blockId: null,
        },
      ],
    };
  const tops = workspace.getTopBlocks(true);
  const mains = tops.filter((block) => block.type === 'cv_main');
  if (mains.length !== 1) issue(null, 'MAIN_COUNT', '工作区必须恰好有一个主程序。');
  for (const block of tops)
    if (block.type !== 'cv_main')
      issue(block, 'DISCONNECTED_BLOCK', '这块积木还未连接到主程序，请连接或删除。');
  const seenInputs: BlockInput[] = [];
  const read = (
    block: Blockly.Block,
    depth: number,
    inLoop: boolean,
  ): BlockProgram | BlockStatement | BlockExpression => {
    if (depth > BLOCK_LIMITS.depth) throw new Error(`积木嵌套不能超过 ${BLOCK_LIMITS.depth} 层。`);
    const kind = block.type.replace(/^cv_/, '');
    const id = protocolBlockId(block.id);
    const field = (name: string) => String(block.getFieldValue(name) ?? '');
    const expression = (name: string, optional = false): BlockExpression | null => {
      const child = block.getInputTargetBlock(name);
      if (!child) {
        if (!optional)
          issue(
            block,
            'MISSING_INPUT',
            `请补齐“${
              block
                .getInput(name)
                ?.fieldRow.map((entry) => entry.getText())
                .join(' ') || name
            }”表达式槽。`,
          );
        return null;
      }
      return read(child, depth + 1, inLoop) as BlockExpression;
    };
    const required = (name: string) => expression(name) as BlockExpression;
    const statements = (name: string, loop = inLoop): BlockStatement[] => {
      const children: BlockStatement[] = [];
      for (let child = block.getInputTargetBlock(name); child; child = child.getNextBlock())
        children.push(read(child, depth + 1, loop) as BlockStatement);
      return children;
    };
    const metadata = (block as TeachingBlock).inputBinding;
    if (metadata) {
      const input: BlockInput = { id, kind: 'input', ...metadata };
      seenInputs.push(input);
      if (field('NAME') !== metadata.name)
        issue(block, 'INPUT_BINDING', '课程输入的名称已变化，请恢复该输入来源积木。');
      return input;
    }
    switch (kind) {
      case 'main':
        return { id, kind, body: statements('BODY') };
      case 'integer':
        return { id, kind, value: field('VALUE') };
      case 'variable':
        return { id, kind, name: field('NAME') };
      case 'declare':
        return {
          id,
          kind,
          name: field('NAME'),
          initial: field('INITIALIZE') === 'TRUE' ? required('INITIAL') : null,
        };
      case 'assign':
        return { id, kind, name: field('NAME'), value: required('VALUE') };
      case 'unary':
        return { id, kind, operator: field('OP') as '+' | '-' | '!', operand: required('OPERAND') };
      case 'arithmetic':
        return {
          id,
          kind,
          operator: field('OP') as '+' | '-' | '*' | '/' | '%',
          left: required('LEFT'),
          right: required('RIGHT'),
        };
      case 'compare':
        return {
          id,
          kind,
          operator: field('OP') as '<' | '<=' | '>' | '>=' | '==' | '!=',
          left: required('LEFT'),
          right: required('RIGHT'),
        };
      case 'logic':
        return {
          id,
          kind,
          operator: field('OP') as '&&' | '||',
          left: required('LEFT'),
          right: required('RIGHT'),
        };
      case 'if':
        return {
          id,
          kind,
          condition: required('CONDITION'),
          then: statements('THEN'),
          else: field('HAS_ELSE') === 'TRUE' ? statements('ELSE') : null,
        };
      case 'while':
        return { id, kind, condition: required('CONDITION'), body: statements('BODY', true) };
      case 'for': {
        const init = statements('INIT');
        const update = statements('UPDATE');
        if (init.length > 1 || (init[0] && init[0].kind !== 'declare' && init[0].kind !== 'assign'))
          issue(block, 'FOR_INIT', 'for 初始化槽只能为空或放一个整数声明/赋值，不能放输入来源。');
        if (update.length > 1 || (update[0] && update[0].kind !== 'assign'))
          issue(block, 'FOR_UPDATE', 'for 更新槽只能为空或放一个变量赋值。');
        return {
          id,
          kind,
          init: (init[0] ?? null) as Extract<BlockStatement, { kind: 'declare' | 'assign' }> | null,
          condition: expression('CONDITION', true),
          update: (update[0] ?? null) as Extract<BlockStatement, { kind: 'assign' }> | null,
          body: statements('BODY', true),
        };
      }
      case 'break':
      case 'continue':
        if (!inLoop) issue(block, 'LOOP_CONTEXT', '跳出循环和继续下轮积木必须放在循环体内。');
        return { id, kind };
      case 'array_declare':
        return {
          id,
          kind,
          name: field('NAME'),
          length: field('LENGTH'),
          values: field('VALUES').trim()
            ? field('VALUES')
                .split(/[,，]/)
                .map((entry) => entry.trim())
            : null,
        };
      case 'array_read':
        return { id, kind, name: field('NAME'), index: required('INDEX') };
      case 'array_write':
        return {
          id,
          kind,
          name: field('NAME'),
          index: required('INDEX'),
          value: required('VALUE'),
        };
      case 'print': {
        if (new TextEncoder().encode(field('FORMAT')).length > BLOCK_LIMITS.sourceBytes)
          issue(block, 'BLOCK_SOURCE_LIMIT', '输出格式超过 32 KiB 源码预算，请缩短格式文字。');
        const args: BlockExpression[] = [];
        for (const input of block.inputList)
          if (/^ARG\d+$/.test(input.name)) args.push(required(input.name));
        return { id, kind, format: parseFormat(field('FORMAT')), args };
      }
      case 'return':
        return { id, kind, value: required('VALUE') };
      case 'scope':
        return { id, kind, body: statements('BODY') };
      default:
        throw new Error('工作区含有一期尚不支持的积木，请删除该积木。');
    }
  };
  let program: BlockProgram | null = null;
  if (mains.length === 1) {
    try {
      program = read(mains[0], 0, false) as BlockProgram;
    } catch (error) {
      issue(mains[0], 'INVALID_BLOCK', error instanceof Error ? error.message : '积木内容无效。');
    }
  }
  for (const expected of expectedInputs) {
    const matches = seenInputs.filter((input) => input.bindingKey === expected.bindingKey);
    if (
      matches.length !== 1 ||
      matches[0]?.id !== expected.id ||
      matches[0]?.name !== expected.name ||
      matches[0]?.targetKind !== expected.targetKind
    )
      issue(
        blocks.find((block) => protocolBlockId(block.id) === expected.id) ?? null,
        'INPUT_BINDING',
        `课程输入“${expected.name}”被删除、改名或重复，请恢复原输入来源积木。`,
      );
  }
  return { program: issues.length ? null : program, issues };
}
