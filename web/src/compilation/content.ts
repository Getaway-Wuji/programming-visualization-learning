// Authored teaching illustrations. No text here is compiler output or a DIAG packet.
export const compilationStages = [
  {
    title: '预处理',
    input: '源文件与头文件',
    output: '展开后的源码（.i）',
    job: '先整理编译器将要读到的文本：处理头文件包含、宏替换与条件编译。',
    change:
      'BASE 来自教学头文件 values.h，示意展开后变为 2。真实头文件通常有更多声明；这里省略与目标无关的细节。',
    reminder:
      '这一步不执行 main，也不计算程序的运行结果。实际工具可能直接传递内部记号，不必把 .i 写入磁盘。',
  },
  {
    title: '编译',
    input: '展开后的源码（.i）',
    output: '汇编文本（.s）',
    job: '检查语法与语义，把程序翻译成目标机器的汇编表示，并可能优化。',
    change:
      '本示例用“取常量、相加、返回”表达指令意图。真实指令、寄存器和优化结果由目标架构与编译选项决定。',
    reminder: '这里“编译”指四阶段中的编译本身；日常说“编译整个项目”也可能包含后面的汇编和链接。',
  },
  {
    title: '汇编',
    input: '汇编文本（.s）',
    output: '目标文件（.o）',
    job: '把汇编指令编码为目标机器的指令，并组织符号与必要的重定位信息。',
    change:
      '目标文件可能仍有外部符号等待解决。下方只列结构概念，没有生成机器字节，也不是可运行的 .o 文件。',
    reminder:
      '合法的目标文件通常仍不能作为完整程序直接启动；它需要与其他目标文件及必要支持一起链接。',
  },
  {
    title: '链接',
    input: '目标文件与必要的库、启动支持',
    output: '可执行文件（概念）',
    job: '组合目标文件，安排地址，处理符号引用与重定位，形成所需的程序文件。',
    change:
      '在这个可执行程序示例里，main 的定义与必要启动支持组合。使用动态库时，部分依赖还会在加载或运行时解析。',
    reminder:
      '链接完成不等于程序已经运行。运行后才会产生输出、返回值或除零等运行错误；这里不会启动任何原生程序。',
  },
] as const;

const normalSource = '#include "values.h"\nint main(void) {\n    return BASE + 3;\n}';
const normalExpanded = 'int main(void) {\n    return 2 + 3;\n}';
const normalAssembly = 'main:\n    取常量 2\n    加上常量 3\n    将结果作为返回值\n    返回调用者';
const normalObject =
  'main.o · 结构示意\n定义的符号：main\n指令区：由目标架构编码（此处不生成字节）\n符号与重定位：由真实工具按需记录';
const executable =
  '程序文件 · 概念示意\n组成：main.o 与必要启动支持\nmain 的定义：已提供\n是否已经运行：否\n未生成可执行文件，也未产生运行返回值';

export const compilationScenarios = [
  { id: 'normal', title: '正常流程', fault: null },
  { id: 'header', title: '预处理：找不到头文件', fault: 0 },
  { id: 'semicolon', title: '编译：遗漏分号', fault: 1 },
  { id: 'instruction', title: '汇编：文本被手工改坏', fault: 2 },
  { id: 'symbol', title: '链接：函数缺少定义', fault: 3 },
] as const;
export type CompilationScenario = (typeof compilationScenarios)[number];

export function compilationStageChange(scenario: CompilationScenario, index: number) {
  if (scenario.id === 'symbol') {
    if (index === 0) return '这里没有头文件或宏需要展开。helper 的声明原样传给下一阶段。';
    if (index === 1)
      return 'helper 的声明让编译阶段可以检查调用，并留下对外部函数的引用。函数体并未出现在当前这份源码中。';
    if (index === 3)
      return '链接时需要找到 helper 的定义来解决这个引用。输入只有调用方的目标文件，因此不会得到程序文件。';
  }
  if (scenario.id === 'header' && index === 0)
    return '找不到 missing.h 就无法完成包含指令。此情景不会得到可送入下一阶段的展开源码。';
  if (scenario.id === 'semicolon' && index === 1)
    return '展开后的 return 仍然缺少分号，语法检查到此停止，不会得到本例的汇编示意。';
  return compilationStages[index].change;
}

export function compilationExample(scenario: CompilationScenario) {
  let source = normalSource,
    expanded = normalExpanded,
    assembly = normalAssembly,
    object = normalObject;
  const header = 'values.h · 教学头文件\n#define BASE 2';
  if (scenario.id === 'header') source = normalSource.replace('values.h', 'missing.h');
  if (scenario.id === 'semicolon') {
    source = normalSource.replace('BASE + 3;', 'BASE + 3');
    expanded = normalExpanded.replace('2 + 3;', '2 + 3');
  }
  if (scenario.id === 'instruction')
    assembly = '手工改坏的伪汇编 · 非编译器真实产物\nmain:\n    MYSTERY 未知指令\n    返回调用者';
  if (scenario.id === 'symbol') {
    source = 'int helper(void);\nint main(void) {\n    return helper();\n}';
    expanded = source;
    assembly = 'main:\n    调用外部函数 helper\n    将其结果作为返回值\n    返回调用者';
    object =
      'main.o · 结构示意\n定义的符号：main\n待解决的符号引用：helper\n只有声明，尚未提供 helper 的实现';
  }
  const artifacts = [expanded, assembly, object, executable];
  return { source, header: scenario.id === 'symbol' ? null : header, artifacts };
}

export const compilationFaults = [
  {
    title: '头文件没有找到',
    detail:
      'main.c 包含 missing.h，但本示例只提供 values.h。真实工具可能因为文件名、路径或搜索位置不正确而停止。',
    repair: '核对头文件名与搜索路径；本演示可恢复正常示例中的 values.h。',
  },
  {
    title: 'return 语句缺少分号',
    detail: '预处理可以完成文本展开，但遗漏的分号让后续语法检查停止。错误发现的位置可能在下一行。',
    repair: '在 return BASE + 3 后补分号；无需改动链接库。',
  },
  {
    title: '汇编文本含未知指令',
    detail:
      '这个情景故意把教学伪汇编手工改坏。真实汇编器也可能因错误指令、操作数或目标架构不匹配而停止；这不是本页调用工具得到的诊断。',
    repair: '核对指令写法与目标架构；本演示可恢复未损坏的示意文本。',
  },
  {
    title: 'helper 只有声明，没有定义',
    detail:
      '编译和汇编可以留下待解决的外部符号。若链接时找不到 helper 的实现，就无法完成这个程序；声明并不是函数实现。',
    repair: '提供函数定义并加入相应目标文件或库；本演示可恢复不调用 helper 的正常示例。',
  },
] as const;
