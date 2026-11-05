import * as Blockly from 'blockly/core';
import * as Chinese from 'blockly/msg/zh-hans';
import { BLOCK_LIMITS } from './model';

import { BLOCK_TYPES, BLOCK_LABELS, type TeachingBlockKind } from './block-kinds';
export { BLOCK_TYPES, BLOCK_LABELS, type TeachingBlockKind } from './block-kinds';
export interface InputBlockMetadata {
  bindingKey: string;
  name: string;
  targetKind: 'scalar' | 'array' | 'logical-length';
}
export interface TeachingBlock extends Blockly.Block {
  inputBinding?: InputBlockMetadata;
}

const statement = (block: Blockly.Block, checks: string[] = ['Statement']) => {
  block.setPreviousStatement(true, checks);
  block.setNextStatement(true, 'Statement');
  block.setColour(155);
};
function value(block: Blockly.Block, name: string, label: string) {
  return block.appendValueInput(name).setCheck('Int').appendField(label);
}
function body(block: Blockly.Block, name: string, label: string) {
  return block.appendStatementInput(name).setCheck('Statement').appendField(label);
}
function text(block: Blockly.Block, input: string, label: string, name: string, initial: string) {
  return block
    .appendDummyInput(input)
    .appendField(label)
    .appendField(new Blockly.FieldTextInput(initial), name);
}
export function printArgumentCount(format: string): number {
  let count = 0;
  for (let index = 0; index < format.length; index++) {
    if (format[index] === '%') {
      index++;
      if (format[index] === 'd') count++;
    }
  }
  return count;
}
function updatePrint(block: Blockly.Block, count: number) {
  // Each %d consumes at least two source bytes, before arguments and syntax.
  // Oversized drafts remain visible and are explicitly rejected by the reader.
  if (!Number.isSafeInteger(count) || count < 0 || count > BLOCK_LIMITS.sourceBytes / 2) return;
  for (const input of [...block.inputList])
    if (/^ARG\d+$/.test(input.name) && Number(input.name.slice(3)) >= count)
      block.removeInput(input.name);
  for (let index = 0; index < count; index++)
    if (!block.getInput(`ARG${index}`)) value(block, `ARG${index}`, `整数 ${index + 1}`);
}
function updateOptional(
  block: Blockly.Block,
  name: string,
  enabled: boolean,
  label: string,
  isBody: boolean,
) {
  if (enabled && !block.getInput(name)) {
    if (isBody) body(block, name, label);
    else value(block, name, label);
  } else if (!enabled && block.getInput(name)) block.removeInput(name);
}

/** Only these twenty finite teaching blocks are registered; no JavaScript generator is installed. */
export function registerTeachingBlocks() {
  Blockly.setLocale(
    Object.fromEntries(
      Object.entries(Chinese).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  );
  if (Blockly.Blocks.cv_main) return;
  Blockly.Blocks.cv_main = {
    init(this: Blockly.Block) {
      this.appendDummyInput().appendField('主程序 int main');
      body(this, 'BODY', '执行');
      this.appendDummyInput().appendField('未返回时默认返回 0');
      this.setColour(180);
      this.setTooltip('整个工作区只能有一个主程序。语句顺次放入执行槽；生成的 C 代码只读。');
    },
  };
  Blockly.Blocks.cv_integer = {
    init(this: Blockly.Block) {
      text(this, 'HEAD', '整数', 'VALUE', '0');
      this.setOutput(true, 'Int');
      this.setColour(230);
      this.setTooltip('填非负十进制整数。负数请连接一元负号积木。');
    },
  };
  Blockly.Blocks.cv_declare = {
    init(this: TeachingBlock) {
      text(this, 'HEAD', '声明 int', 'NAME', 'x');
      this.getInput('HEAD')!
        .appendField(
          new Blockly.FieldCheckbox('TRUE', (enabled) => {
            updateOptional(this, 'INITIAL', enabled === 'TRUE', '初值', false);
            return enabled;
          }),
          'INITIALIZE',
        )
        .appendField('设置初值');
      value(this, 'INITIAL', '初值');
      statement(this, ['Statement', 'ForInit']);
      this.setTooltip(
        '声明一个整数。输入来源积木由课程提供，名字和绑定只读；删除后会明确报绑定错误。',
      );
    },
    saveExtraState(this: TeachingBlock) {
      return this.inputBinding
        ? { binding: this.inputBinding }
        : { hasInitial: !!this.getInput('INITIAL') };
    },
    loadExtraState(
      this: TeachingBlock,
      state: { binding?: InputBlockMetadata; hasInitial?: boolean },
    ) {
      if (state.binding) {
        this.inputBinding = { ...state.binding };
        this.setFieldValue(state.binding.name, 'NAME');
        this.setFieldValue('FALSE', 'INITIALIZE');
        this.getInput('HEAD')!.appendField('· 课程输入（按测试组实例化）');
        this.setEditable(false);
      } else this.setFieldValue(state.hasInitial === false ? 'FALSE' : 'TRUE', 'INITIALIZE');
    },
  };
  Blockly.Blocks.cv_variable = {
    init(this: Blockly.Block) {
      text(this, 'HEAD', '读取变量', 'NAME', 'x');
      this.setOutput(true, 'Int');
      this.setColour(230);
    },
  };
  Blockly.Blocks.cv_assign = {
    init(this: Blockly.Block) {
      text(this, 'HEAD', '赋值给', 'NAME', 'x');
      value(this, 'VALUE', '值');
      statement(this, ['Statement', 'ForInit', 'ForUpdate']);
    },
  };
  Blockly.Blocks.cv_unary = {
    init(this: Blockly.Block) {
      value(this, 'OPERAND', '一元').appendField(
        new Blockly.FieldDropdown([
          ['取正 +', '+'],
          ['取负 −', '-'],
          ['逻辑非 !', '!'],
        ]),
        'OP',
      );
      this.setOutput(true, 'Int');
      this.setColour(230);
    },
  };
  const binary = (kind: 'arithmetic' | 'compare' | 'logic', choices: [string, string][]) => {
    Blockly.Blocks[`cv_${kind}`] = {
      init(this: Blockly.Block) {
        value(this, 'LEFT', BLOCK_LABELS[kind]);
        value(this, 'RIGHT', '').appendField(new Blockly.FieldDropdown(choices), 'OP');
        this.setOutput(true, 'Int');
        this.setColour(kind === 'arithmetic' ? 230 : 275);
      },
    };
  };
  binary('arithmetic', [
    ['+', '+'],
    ['−', '-'],
    ['×', '*'],
    ['÷', '/'],
    ['余数 %', '%'],
  ]);
  binary('compare', [
    ['<', '<'],
    ['≤', '<='],
    ['>', '>'],
    ['≥', '>='],
    ['等于 ==', '=='],
    ['不等于 !=', '!='],
  ]);
  binary('logic', [
    ['并且 &&', '&&'],
    ['或者 ||', '||'],
  ]);
  Blockly.Blocks.cv_if = {
    init(this: Blockly.Block) {
      value(this, 'CONDITION', '如果');
      body(this, 'THEN', '成立时');
      this.appendDummyInput('CHOICE')
        .appendField(
          new Blockly.FieldCheckbox('FALSE', (enabled) => {
            updateOptional(this, 'ELSE', enabled === 'TRUE', '否则', true);
            return enabled;
          }),
          'HAS_ELSE',
        )
        .appendField('包含否则分支');
      statement(this);
      this.setColour(35);
    },
    saveExtraState(this: Blockly.Block) {
      return { hasElse: !!this.getInput('ELSE') };
    },
    loadExtraState(this: Blockly.Block, state: { hasElse?: boolean }) {
      this.setFieldValue(state.hasElse ? 'TRUE' : 'FALSE', 'HAS_ELSE');
    },
  };
  Blockly.Blocks.cv_while = {
    init(this: Blockly.Block) {
      value(this, 'CONDITION', '当');
      body(this, 'BODY', '重复执行');
      statement(this);
      this.setColour(35);
    },
  };
  Blockly.Blocks.cv_for = {
    init(this: Blockly.Block) {
      this.appendStatementInput('INIT')
        .setCheck('ForInit')
        .appendField('for 初始化（声明或赋值，可空）');
      value(this, 'CONDITION', '继续条件（空表示一直成立）');
      this.appendStatementInput('UPDATE')
        .setCheck('ForUpdate')
        .appendField('每轮更新（单个赋值，可空）');
      body(this, 'BODY', '循环体');
      statement(this);
      this.setColour(35);
      this.setTooltip(
        '初始化与更新各至多一块；初始化只能整数声明或赋值，更新只能赋值。不能使用 ++ 或数组声明。',
      );
    },
  };
  for (const kind of ['break', 'continue'] as const)
    Blockly.Blocks[`cv_${kind}`] = {
      init(this: Blockly.Block) {
        this.appendDummyInput().appendField(BLOCK_LABELS[kind]);
        statement(this);
        this.setColour(35);
        this.setTooltip('必须连接在 while 或 for 循环体内；放在循环外会报错。');
      },
    };
  Blockly.Blocks.cv_array_declare = {
    init(this: TeachingBlock) {
      text(this, 'HEAD', '声明 int 数组', 'NAME', 'values');
      text(this, 'LENGTH_ROW', '固定长度', 'LENGTH', '3');
      text(this, 'VALUES_ROW', '初值列表（逗号分隔；空为不初始化）', 'VALUES', '0, 0, 0');
      statement(this);
    },
    saveExtraState(this: TeachingBlock) {
      return this.inputBinding ? { binding: this.inputBinding } : null;
    },
    loadExtraState(this: TeachingBlock, state: { binding?: InputBlockMetadata } | null) {
      if (state?.binding) {
        this.inputBinding = { ...state.binding };
        this.setFieldValue(state.binding.name, 'NAME');
        this.removeInput('LENGTH_ROW');
        this.removeInput('VALUES_ROW');
        this.getInput('HEAD')!.appendField('· 课程输入（长度和值按测试组实例化）');
        this.setEditable(false);
      }
    },
  };
  Blockly.Blocks.cv_array_read = {
    init(this: Blockly.Block) {
      text(this, 'HEAD', '读取数组', 'NAME', 'values');
      value(this, 'INDEX', '下标');
      this.setOutput(true, 'Int');
      this.setColour(230);
    },
  };
  Blockly.Blocks.cv_array_write = {
    init(this: Blockly.Block) {
      text(this, 'HEAD', '写入数组', 'NAME', 'values');
      value(this, 'INDEX', '下标');
      value(this, 'VALUE', '新值');
      statement(this);
    },
  };
  Blockly.Blocks.cv_print = {
    init(this: Blockly.Block) {
      this.appendDummyInput('HEAD')
        .appendField('输出格式')
        .appendField(
          new Blockly.FieldTextInput('%d\\n', (format) => {
            updatePrint(this, printArgumentCount(format));
            return format;
          }),
          'FORMAT',
        );
      updatePrint(this, 1);
      statement(this);
      this.setColour(300);
      this.setTooltip('只支持 %d、%% 与 \\n、\\\\、\\"。每个 %d 连接一个整数表达式。');
    },
    saveExtraState(this: Blockly.Block) {
      return { arguments: printArgumentCount(String(this.getFieldValue('FORMAT'))) };
    },
    loadExtraState(this: Blockly.Block, state: { arguments?: number }) {
      updatePrint(this, state.arguments ?? 0);
    },
  };
  Blockly.Blocks.cv_return = {
    init(this: Blockly.Block) {
      value(this, 'VALUE', '返回');
      statement(this);
      this.setColour(180);
    },
  };
  Blockly.Blocks.cv_scope = {
    init(this: Blockly.Block) {
      body(this, 'BODY', '独立作用域');
      statement(this);
      this.setColour(155);
    },
  };
}

export function teachingToolbox(
  allowed: readonly TeachingBlockKind[] = BLOCK_TYPES,
): Blockly.utils.toolbox.ToolboxInfo {
  const category = (name: string, colour: string, kinds: TeachingBlockKind[]) => ({
    kind: 'category',
    name,
    colour,
    contents: kinds.map((kind) => ({
      kind: 'block',
      type: `cv_${kind}`,
      enabled: allowed.includes(kind),
    })),
  });
  return {
    kind: 'categoryToolbox',
    contents: [
      category('程序与作用域', '#438f85', ['main', 'scope', 'return']),
      category('整数与变量', '#5b70bc', ['integer', 'declare', 'variable', 'assign']),
      category('运算与判断', '#8d62b4', ['unary', 'arithmetic', 'compare', 'logic']),
      category('条件与循环', '#b88235', ['if', 'while', 'for', 'break', 'continue']),
      category('数组与输出', '#9d5f93', ['array_declare', 'array_read', 'array_write', 'print']),
    ],
  };
}
