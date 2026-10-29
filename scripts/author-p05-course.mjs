import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Authoring tool only. Published tests contain literal inputs/expectations;
// this tool does not evaluate user programs or enter the browser bundle.
const read = async (path) => JSON.parse(await readFile(path, 'utf8'));
const old = await read('content/c/p0/course-1.0.1.json');
const caseSource = await read('content/c/p0/case-source-1.0.1.json');
const clone = (value) => globalThis.structuredClone(value);
const ref = (id, version = '1.0.0') => ({ id, version });
const lang = ref('lang.c');
const c = (body) => `#include <stdio.h>\nint main(void) {\n${body}\n    return 0;\n}\n`;
const integer = (key, min = -999, max = 999) => ({ key, kind: 'integer', min, max });
const sequence = (minItems = 0) => ({
  key: 'values',
  kind: 'sequence',
  min: -999,
  max: 999,
  minItems,
  maxItems: 30,
});
const scalarBinding = (name) => ({
  bindingKey: `param.${name}`,
  inputKey: name,
  targetName: name,
  targetKind: 'scalar',
  from: 'field',
});
const arrayBindings = [
  {
    bindingKey: 'param.n',
    inputKey: 'values',
    targetName: 'n',
    targetKind: 'logical-length',
    from: 'length-of',
  },
  {
    bindingKey: 'param.values',
    inputKey: 'values',
    targetName: 'values',
    targetKind: 'array',
    from: 'field',
    emptyStorage: 'one-zero-placeholder',
  },
];
const lengthRelation = { kind: 'length-of', field: 'values', target: 'n' };
const test = (caseKey, input, expectedStdout, expectedArray) => ({
  caseKey,
  input,
  expectedStdout,
  expectedExitCode: 0,
  ...(expectedArray === undefined ? {} : { expectedArray }),
});
const listLine = (values) => `${values.join(' ')}\n`;
const thirty999 = Array(30).fill(999);
const thirtyOne = Array(30).fill(1);
const descending30 = Array.from({ length: 30 }, (_, index) => 30 - index);
const ascending30 = Array.from({ length: 30 }, (_, index) => index + 1);
const sourceDocument = '项目文档/验收/P0.5-09-正文审校.md';

// Each entry carries a distinct learning objective, worked state account,
// misconception and boundary reasoning. Existing six identities are added below.
const lessons = [
  {
    order: '01.01',
    lesson: 'first-program',
    exercise: 'first-output',
    title: '第一个程序与正常结束',
    rule: 'entry-output',
    target: '实际执行printf输出Hello, C!和换行，正常返回0。',
    fields: [],
    exampleInput: {},
    source: c('    printf("Hello, C!\\n");'),
    tests: [test('only', {}, 'Hello, C!\n')],
    knowledge: ['entry', 'output'],
    blocks: [],
    display: 'code',
    objectives: [
      '辨认main入口、语句和花括号的作用',
      '解释文字输出与换行的区别',
      '把正常结束与运行出错分开',
    ],
    why: '程序是一组按顺序执行的指令。机器不会根据屏幕上的文字猜测你的意图，因此“让它显示一句话”也必须写成准确的语句。main是这份教学程序唯一的入口；花括号圈定它的主体。先学会观察一个很小的完整程序，后面增加变量和循环时就能识别哪些部分真正改变了行为。',
    walk: '进入main时还没有输出。执行printf后，输出区追加Hello, C!及一个换行；执行return 0后正常结束。0是交给调用环境的结束码，不会自动打印到输出区。#include <stdio.h>是本平台识别的教学头文件行，不会让程序获得任意系统库或文件访问能力。',
    io: '本题没有输入字段，输入对象确实为空。期望输出只有Hello, C!和换行；不输入引号，不加空格或额外提示。正文中的字符串只用于printf字面量，并不表示支持字符串变量。',
    mistakes: [
      '把Hello, C!写在引号外，解释器无法把它当作输出文字。',
      '遗漏语句末尾分号或main的右花括号，会在真正运行前被诊断。',
      '把return 0当成输出0；它控制结束状态，不产生屏幕文字。',
    ],
    boundaries: [
      '大写H、大写C、逗号、空格、感叹号和换行都按字节检查。',
      '本题无需伪造输入变量；浏览课程或看示例不产生练习通过。',
    ],
    hints: [
      '先找到main主体中的输出位置。',
      '使用printf，文字放在双引号内，末尾需要换行。',
      '输出语句是printf("Hello, C!\\n");，随后正常返回0。',
    ],
  },
  {
    order: '01.03',
    lesson: 'printf-layout',
    exercise: 'printf-layout',
    title: '整数格式与多值输出',
    rule: 'printf-integer-layout',
    target: '真实读取输入x和y，以指定格式输出，并用%%产生百分号。',
    fields: [integer('x'), integer('y')],
    exampleInput: { x: 7, y: -2 },
    source: c('    int x = 7;\n    int y = -2;\n    printf("x=%d,y=%d\\n100%%\\n", x, y);'),
    tests: [
      test('mixed', { x: 7, y: -2 }, 'x=7,y=-2\n100%\n'),
      test('zero', { x: 0, y: 0 }, 'x=0,y=0\n100%\n'),
      test('limits', { x: -999, y: 999 }, 'x=-999,y=999\n100%\n'),
    ],
    knowledge: ['output', 'variables', 'input'],
    blocks: [],
    display: 'code',
    objectives: [
      '建立%d与整数参数从左到右的一一关系',
      '区分输出文字、占位符和转义字符',
      '按题目格式输出两个真实输入',
    ],
    why: '同一个整数可以被嵌在不同文字里。printf先读格式，再依次取参数替换%d；只改变量值，格式就能复用。这样你不必为每种输入写一段固定输出。对学习程序而言，输出格式也是接口：多一个空格、少一个换行，都会改变程序交付的结果。',
    walk: '声明后x为7、y为-2。第一个%d读取x，第二个读取y，得到第一行x=7,y=-2。格式中的\\n结束这一行；100%%中的两个百分号合成一个文字百分号，第二个\\n结束第二行。可以拆成多条printf，只要参数实际来自对应输入且拼接结果完全相同。',
    io: 'x、y都是-999到999的整数。第一行的逗号两侧没有空格；第二行是100%。输入(0,0)时仍保留两行，不省略零。',
    mistakes: [
      '把两个参数顺序颠倒，第一行就会变成x=-2,y=7。',
      '直接在格式中写单个%，它会被解释为格式起点；文字百分号使用%%。',
      '打印7和-2两个常量，只碰巧符合示例，不能表达随输入变化的程序。',
    ],
    boundaries: [
      '负数的负号是整数十进制表示的一部分，无需手工补。',
      '格式与参数数量或类型不匹配会被诊断，不靠截取输出掩盖。',
    ],
    hints: [
      '列出固定文字与会变化的两处整数。',
      '格式中放两个%d，参数顺序为x、y；文字百分号写%%。',
      '可用printf("x=%d,y=%d\\n100%%\\n", x, y);一次输出两行。',
    ],
  },
  {
    order: '01.04',
    lesson: 'statement-order',
    exercise: 'ordered-updates',
    title: '语句顺序与当前值',
    rule: 'ordered-output-dependency',
    target: '同一变量先输出原值，再先后有效加1、加2并输出各版本。',
    fields: [integer('x')],
    exampleInput: { x: 4 },
    source: c(
      '    int x = 4;\n    printf("%d\\n", x);\n    x = x + 1;\n    printf("%d\\n", x);\n    x = x + 2;\n    printf("%d\\n", x);',
    ),
    tests: [
      test('normal', { x: 4 }, '4\n5\n7\n'),
      test('zero', { x: 0 }, '0\n1\n3\n'),
      test('lower', { x: -999 }, '-999\n-998\n-996\n'),
      test('upper', { x: 999 }, '999\n1000\n1002\n'),
    ],
    knowledge: ['variables', 'output', 'expressions'],
    blocks: ['arithmetic'],
    display: 'code',
    objectives: [
      '按执行先后追踪同一变量的多个值版本',
      '解释赋值先读右边再写左边',
      '用三次输出观察真实更新',
    ],
    why: '语句顺序决定你读取哪个时刻的值。把三条输出全放在两次赋值之后，会三次读到最后的值；把赋值放到输出之间，才会记录三个不同状态。变量是可变的存储位置，不是写下后永远不变的数学符号。',
    walk: 'x初始化为4，第一次输出读取4。x=x+1先读4，计算5再写回，第二次输出读取5。下一条x=x+2读的是5而非最初的4，所以写回7，第三次输出7。回放时可以在每次赋值前后停下，核对变量面板与已追加的输出；后退应同时恢复两者。',
    io: '输入范围-999到999。输出分三行，依次为x、原x+1、原x+3；第三行不是原x+2。输入上限999可得到1002，输入限制并非中间结果的限制。',
    mistakes: [
      '把第二次更新写成x=原输入+2，跳过了第一次加1的效果。',
      '用三个互不相关常量拼出示例输出，没有更新同一变量。',
      '在每次printf前重新声明x，观察的是不同声明而非同一格子的版本。',
    ],
    boundaries: ['0和负数同样按先后更新，无特殊分支。', '结果仍在int32内，不需要截断到999。'],
    hints: [
      '画三行状态表：第一次读、第一次写后、第二次写后。',
      '同一个x声明保留不变，把两条赋值分别放在三次printf之间。',
      '顺序为输出x；x=x+1；输出x；x=x+2；输出x，每次末尾换行。',
    ],
  },
  {
    order: '02.01',
    lesson: 'initialization-assignment',
    exercise: 'reassign-value',
    title: '声明、初始化与再次赋值',
    rule: 'scalar-reassignment',
    target: '局部result从输入x初始化并先输出，再对同一声明赋值x+3并输出。',
    fields: [integer('x')],
    exampleInput: { x: -2 },
    source: c(
      '    int x = -2;\n    int result = x;\n    printf("%d\\n", result);\n    result = x + 3;\n    printf("%d\\n", result);',
    ),
    tests: [
      test('normal', { x: -2 }, '-2\n1\n'),
      test('zero', { x: 0 }, '0\n3\n'),
      test('limits', { x: 999 }, '999\n1002\n'),
    ],
    knowledge: ['variables', 'expressions', 'output'],
    blocks: ['arithmetic'],
    display: 'code',
    objectives: [
      '区分创建变量与修改已有变量',
      '用另一个变量的当前值完成初始化',
      '核对同一局部声明的前后输出',
    ],
    why: '声明负责创建名字和存储，初始化在创建时提供第一个可读值，赋值则修改已经存在的存储。将这三件事分开理解，能避免在循环中误建新变量，也能解释为什么读取未初始化变量会出错。本题的result专门承接计算结果，让输入x保持原意。',
    walk: '输入声明建立x=-2；int result=x创建第二个对象并复制-2。第一次输出result得到-2。随后result=x+3计算1并写回已有result，第二次输出1。x仍是-2，改变result不会反过来改变x，因为整数赋值复制的是值。',
    io: 'x为-999到999。输出两行，第一行来自result的初始化版本，第二行来自它的再次赋值版本；例如999得到999、1002。',
    mistakes: [
      '第一次就把result初始化为x+3，两行都输出新值，丢失初始化版本。',
      '再次写int result会重复声明，或在新作用域制造另一个对象。',
      '只输出x和x+3却从不修改result，不满足本节的赋值目标。',
    ],
    boundaries: [
      '输入0仍须经过初始化和再次赋值，输出0、3。',
      '允许透明复制和安全括号，但初始值和更新值必须真正进入输出。',
    ],
    hints: [
      '为结果单独建立一个局部变量，并先给它输入的当前值。',
      '第一次输出后，用不带int的赋值语句修改这个变量。',
      'int result=x；先输出；result=x+3；再输出。',
    ],
  },
  {
    order: '02.02',
    lesson: 'temporary-swap',
    exercise: 'swap-with-temp',
    title: '临时变量与交换',
    rule: 'temporary-swap',
    target: '先用临时局部保存一个旧值，再真实交换输入绑定x/y并输出新值。',
    fields: [integer('x'), integer('y')],
    exampleInput: { x: 3, y: -2 },
    source: c(
      '    int x = 3;\n    int y = -2;\n    int temp = x;\n    x = y;\n    y = temp;\n    printf("%d %d\\n", x, y);',
    ),
    tests: [
      test('different', { x: 3, y: -2 }, '-2 3\n'),
      test('same', { x: 5, y: 5 }, '5 5\n'),
      test('zero', { x: 0, y: 7 }, '7 0\n'),
      test('limits', { x: -999, y: 999 }, '999 -999\n'),
    ],
    knowledge: ['variables', 'output'],
    blocks: [],
    display: 'code',
    objectives: [
      '解释覆盖一个旧值会造成的信息丢失',
      '用临时变量保留稍后仍需使用的值',
      '区分改变状态与倒序打印',
    ],
    why: '交换需要同时保留两个旧值，而赋值只能一次写一个位置。若先x=y，旧x就已被覆盖；下一条y=x读到的是新x，无法找回旧x。临时变量像中转位置，先保存会被覆盖的值，使后续两次写入都有可靠来源。',
    walk: '起初x=3、y=-2。temp=x使temp保存3；x=y后x=-2而temp仍为3；y=temp后y=3，交换完成。输出读取交换后的x和y，得到-2 3。仅printf(y,x)虽然输出相同，却没有改变两个绑定的状态，所以不是交换练习。',
    io: '两个输入都在-999到999。结果用一个空格分隔，一行换行。允许先保存y再按相反顺序写回；关键是两个真实对象互换旧值。',
    mistakes: [
      '直接x=y；y=x会把两者都变成原y。',
      '保存temp后又在交换前覆盖temp，保存动作失效。',
      '使用相加相减交换可能引入溢出且不符合本节临时变量目标。',
    ],
    boundaries: [
      '同值(5,5)输出不变，但仍必须执行有效交换流程。',
      '0、负值和两端输入不影响复制语义。',
    ],
    hints: [
      '先判断哪个旧值会在第一条写入时消失。',
      '把它保存到temp，再进行两次赋值。',
      '可依次写int temp=x；x=y；y=temp，最后按x y输出。',
    ],
  },
  {
    order: '02.03',
    lesson: 'scope-shadowing',
    exercise: 'shadowed-values',
    title: '块作用域与同名遮蔽',
    rule: 'scope-shadow-output',
    target: '祖先/子块中同名不同声明；内层输出x+1后退出，再输出外层的x。',
    fields: [integer('x')],
    exampleInput: { x: 7 },
    source: c(
      '    int x = 7;\n    int value = x;\n    {\n        int value = x + 1;\n        printf("%d\\n", value);\n    }\n    printf("%d\\n", value);',
    ),
    tests: [
      test('normal', { x: 7 }, '8\n7\n'),
      test('zero', { x: 0 }, '1\n0\n'),
      test('upper', { x: 999 }, '1000\n999\n'),
    ],
    knowledge: ['variables', 'output'],
    blocks: ['scope', 'arithmetic'],
    display: 'code',
    objectives: [
      '识别两个同名变量对应两个声明和存储',
      '说明名字在内层优先指向哪个声明',
      '观察退出作用域后的变量恢复可见',
    ],
    why: '名字只是程序寻找对象的线索。进入更内层的花括号后，可以出现一个同名的新声明；它遮住外层名字，但没有删除外层对象。理解这一点能避免把局部更新误认为外层值已改变，也为观察变量的建立和销毁打下基础。',
    walk: '外层value从x复制7。进入独立块，内层value从x+1得到8，此时printf中的value指向内层声明，所以先输出8。离开右花括号，内层对象被销毁；后面的value重新指向一直保留7的外层对象，于是输出7。回退跨过退出步骤时，两个对象及可见范围应一起恢复。',
    io: 'x为-999到999；先输出x+1，再输出x，各占一行。两个局部必须同名，使用inside和outside两个不同名字不能体现遮蔽。',
    mistakes: [
      '在同一个块里重复声明value，而没有建立内层作用域。',
      '把int value=x+1写成int value=value+1，初始化时可能读到尚未初始化的新声明。',
      '把内层声明写成赋值value=x+1，会修改外层对象而非遮蔽。',
    ],
    boundaries: [
      'x=0的两行是1和0，不会因为0是假值而跳过独立块。',
      '本题的内层花括号是作用域，不是条件或循环。',
    ],
    hints: [
      '保留输入x，另建一个外层局部量保存x。',
      '在内层花括号中声明同名局部量并设为x+1，输出后退出。',
      '外层int value=x；内层int value=x+1并输出；块外再输出value。',
    ],
  },
  {
    order: '02.04',
    lesson: 'integer-safety',
    exercise: 'wide-product',
    title: 'int32范围与安全计算',
    rule: 'safe-wide-product',
    target: '输入x实际乘以1000000并影响输出，所有计算在有符号int32内。',
    fields: [integer('x')],
    exampleInput: { x: 7 },
    source: c('    int x = 7;\n    int result = x * 1000000;\n    printf("%d\\n", result);'),
    tests: [
      test('positive', { x: 7 }, '7000000\n'),
      test('zero', { x: 0 }, '0\n'),
      test('lower', { x: -999 }, '-999000000\n'),
      test('upper', { x: 999 }, '999000000\n'),
    ],
    knowledge: ['variables', 'expressions'],
    blocks: ['arithmetic'],
    display: 'code',
    objectives: [
      '区分输入允许范围和整数计算结果范围',
      '在计算前估计最大绝对值',
      '识别溢出与未初始化读取的不同诊断',
    ],
    why: '平台输入面板限制x在±999，并不意味着结果也只能在这个范围内。整数计算使用有符号32位范围[-2147483648,2147483647]。先估计最大结果999×1000000=999000000，便能证明本题所有合法输入都安全；这比运行一个例子后就认定没有溢出更可靠。',
    walk: 'x=7先形成真实输入值，乘法产生7000000并写入result，输出读取这个值。x=-999时同一乘法得到-999000000；没有向0截断或自动绕回。下方附加错误示例故意把2147483647加1，会报告整数溢出；另一个错误示例读取未初始化变量，会在读取处终止，两者不能当作正常答案。',
    io: '输出一行完整十进制整数。乘法两侧可交换，也可经过透明临时量，但死乘法后再打印固定数不能证明结果来自输入。',
    extraExamples: [
      {
        label: '故意的溢出示例',
        code: c('    int value = 2147483647;\n    value = value + 1;\n    printf("%d\\n", value);'),
        diagnostic: 'E_INT_OVERFLOW',
        explanation: '第一条声明合法，下一次加法超出int32上界；赋值不提交，不产生该输出。',
      },
      {
        label: '故意的未初始化示例',
        code: c('    int value;\n    printf("%d\\n", value);'),
        diagnostic: 'E_UNINITIALIZED',
        explanation: '声明了名字不等于已经有可读取的值；读取在输出提交前失败。',
      },
    ],
    mistakes: [
      '把结果限制到±999，混淆了输入域与存储整数域。',
      '先读取一个没有初始化的result，再把它乘以输入。',
      '认为溢出会自然绕回负数；本教学语义明确报错并保留有效前缀。',
    ],
    boundaries: [
      '0乘任何整数为0，但仍需实际读取输入并执行有效乘法。',
      'INT_MIN=-2147483648，INT_MAX=2147483647；本题不要求让提交溢出。',
    ],
    hints: [
      '先用绝对值估计最大结果是否超过int32上界。',
      '用一个局部变量接收x与1000000的乘积。',
      'int result=x*1000000；再printf("%d\\n", result)。',
    ],
  },
  {
    order: '03.02',
    lesson: 'quotient-remainder',
    exercise: 'quotient-remainder',
    title: '整数除法与余数',
    rule: 'integer-quotient-remainder',
    target: '相同输入a/b实际参与除法和余数运算，并分别进入输出。',
    fields: [integer('a'), integer('b', 1, 9)],
    exampleInput: { a: -7, b: 3 },
    source: c(
      '    int a = -7;\n    int b = 3;\n    int quotient = a / b;\n    int remainder = a % b;\n    printf("%d %d\\n", quotient, remainder);',
    ),
    tests: [
      test('positive', { a: 7, b: 3 }, '2 1\n'),
      test('negative', { a: -7, b: 3 }, '-2 -1\n'),
      test('exact', { a: 9, b: 3 }, '3 0\n'),
      test('zero', { a: 0, b: 3 }, '0 0\n'),
      test('lower', { a: -999, b: 1 }, '-999 0\n'),
      test('upper', { a: 999, b: 9 }, '111 0\n'),
    ],
    knowledge: ['expressions', 'output'],
    blocks: ['arithmetic'],
    display: 'code',
    objectives: ['用向0截断规则求整数商', '用a=(a/b)*b+a%b核对余数', '区分除数非法输入与运行除零'],
    why: '整数除法只保留整数商，不能用小数结果直接替代。负数时“向0截断”与“向下取整”不同，余数也因此可能为负。商与余数合起来仍能还原被除数，这个恒等式是检查手算是否一致的工具。',
    walk: 'a=-7、b=3时，a/b为-2，因为-2比-3更接近0；a%b为-1，因为-7=(-2)*3+(-1)。两个运算都读取真实输入，并分别写入quotient和remainder；输出为-2 -1。整除9/3时余数0，被除数0也得到商0、余数0。',
    io: 'a为-999到999，b限定1到9，输入b=0会先被输入校验拒绝。正文也演示负除数，不把本题域悄悄扩大：a=7,b=-3的商-2、余数1。',
    extraExamples: [
      {
        label: '负除数对照',
        code: c('    int a = 7;\n    int b = -3;\n    printf("%d %d\\n", a / b, a % b);'),
        stdout: '-2 1\n',
        explanation: '余数跟随被除数7的符号，7=(-2)*(-3)+1。',
      },
    ],
    mistakes: [
      '把-7/3算为-3，套用了向下取整。',
      '认为余数总是非负；本平台沿C整数向0截断规则。',
      '用同一个商打印两次，或者只用减法拼出部分固定测试。',
    ],
    boundaries: [
      'b=1时任何合法a余数为0。',
      '本题输入不会出现INT_MIN/-1；完整int32运算遇到该溢出组合会诊断。',
    ],
    hints: [
      '先分别写出/和%两个运算，操作数都用a、b。',
      '用两个局部变量保存商和余数，按单空格输出。',
      'printf("%d %d\\n", a/b, a%b)也可直接读取两个真实结果。',
    ],
  },
  {
    order: '03.03',
    lesson: 'boolean-logic',
    exercise: 'boolean-flags',
    title: '比较结果与逻辑组合',
    rule: 'boolean-classification',
    target: 'x参与边界比较与&&形成第一标志，并通过!=或==配!形成非零标志。',
    fields: [integer('x')],
    exampleInput: { x: 5 },
    source: c(
      '    int x = 5;\n    int inRange = x >= 0 && x <= 10;\n    int nonzero = x != 0;\n    printf("%d %d\\n", inRange, nonzero);',
    ),
    tests: [
      test('below', { x: -1 }, '0 1\n'),
      test('left', { x: 0 }, '1 0\n'),
      test('inside', { x: 5 }, '1 1\n'),
      test('right', { x: 10 }, '1 1\n'),
      test('above', { x: 11 }, '0 1\n'),
    ],
    knowledge: ['expressions', 'conditions'],
    blocks: ['comparison', 'logical'],
    display: 'code',
    objectives: [
      '说明比较和逻辑运算的结果为0或1',
      '用&&表达两个条件同时成立',
      '把非零值与规范化逻辑结果区分',
    ],
    why: '条件运算不仅能控制分支，也能产生一个可以保存和输出的整数标志。0表示假，非0表示真；但比较、&&、||和!产生的结果规范为0或1。将范围判断写成两个比较再组合，比把数学的连锁比较照抄到C里更清楚。',
    walk: 'x=5时，x>=0和x<=10都为1，&&得到1；x!=0也得到1，输出1 1。x=0仍在闭区间内，第一标志为1，但第二标志为0。x=-1或11都在区间外，第一标志为0，非零标志仍为1。',
    io: '输入为-999到999整数。第一标志描述[0,10]，两端都包含；第二标志只问是否非0，与正负无关。要求表达式实际参与结果，不用if打印常量替代本节目标。',
    mistakes: [
      '写0<=x<=10：先得到0/1，再与10比较，几乎总为真。',
      '把x直接当第二标志打印，输入5会输出5而非规范化的1。',
      '把&&误写成||，区间外的值也可能被接受。',
    ],
    boundaries: [
      '0和10是区间端点，必须同时满足两侧比较。',
      '负数也是非零，不能将第二标志写成x>0。',
    ],
    hints: [
      '第一标志拆成下界和上界两问，第二标志单独问是否等于0。',
      '用&&连接范围比较；用x!=0或!(x==0)规范化非零结果。',
      '可保存inRange=x>=0&&x<=10与nonzero=x!=0，再按两个%d输出。',
    ],
  },
  {
    order: '03.04',
    lesson: 'short-circuit-safety',
    exercise: 'guarded-division',
    title: '短路与安全求值顺序',
    rule: 'short-circuit-guard',
    target: '同一&&中先对x作非零守卫，右侧实际计算12/x>0；0组必须跳过除法。',
    fields: [integer('x')],
    exampleInput: { x: 3 },
    source: c('    int x = 3;\n    int flag = x != 0 && 12 / x > 0;\n    printf("%d\\n", flag);'),
    tests: [
      test('zero', { x: 0 }, '0\n'),
      test('negative', { x: -3 }, '0\n'),
      test('positive', { x: 3 }, '1\n'),
      test('quotient-zero', { x: 13 }, '0\n'),
    ],
    knowledge: ['expressions', 'conditions'],
    blocks: ['comparison', 'logical', 'arithmetic'],
    display: 'code',
    objectives: [
      '解释&&从左到右和假时跳过右侧',
      '把安全前提放在危险运算之前',
      '用真实求值轨迹区分未执行与执行结果为假',
    ],
    why: '有些表达式只有在前提成立时才安全，例如除法要求除数非0。&&的短路规则提供了顺序保证：左侧为假就不求右侧。这个保证比“最终结果碰巧为0”更强，因为危险运算根本没有发生。',
    walk: 'x=0时左侧x!=0为假，flag立即得到0，12/x不执行，不触发除零。x=-3时守卫为真，右侧确实求商-4，再比较大于0得到假。x=3求商4得到真。x=13虽然是正数，但整数商12/13为0，最后仍是假。',
    io: 'x在-999到999内，0是合法输入。输出一个0/1和换行；不能因为担心除零而把0从输入域删除，也不能把题意简化为x>0。',
    mistakes: [
      '先算12/x，再检查x!=0，安全前提来得太晚。',
      '写成逻辑或，x=0时反而会去计算危险右侧。',
      '将flag写成x>0忽略向0截断，使x=13误判。',
    ],
    boundaries: [
      '0组应观察不到除法求值，而负非0组必须观察到除法。',
      '每次运行都按当前输入重新判断，不复用旧值的安全结论。',
    ],
    hints: [
      '将“除数非0”写在&&左侧。',
      '右侧放12/x>0，别提前保存在另一个变量里。',
      'int flag=x!=0&&12/x>0；然后按%d和换行输出flag。',
    ],
  },
  {
    order: '04.01',
    lesson: 'single-if',
    exercise: 'absolute-with-if',
    title: '单分支if与条件写入',
    rule: 'if-positive-normalize',
    target: '用无else的输入相关if，仅负数时有效取反，非负时跳过，输出当前值。',
    fields: [integer('x')],
    exampleInput: { x: -7 },
    source: c('    int x = -7;\n    if (x < 0) {\n        x = -x;\n    }\n    printf("%d\\n", x);'),
    tests: [
      test('negative', { x: -7 }, '7\n'),
      test('zero', { x: 0 }, '0\n'),
      test('positive', { x: 9 }, '9\n'),
      test('limits', { x: -999 }, '999\n'),
    ],
    knowledge: ['conditions', 'variables'],
    blocks: ['if', 'comparison'],
    display: 'code',
    objectives: [
      '理解条件为假时可以什么都不做',
      '区分条件读取与条件成立后的写入',
      '用无else分支实现输入归一化',
    ],
    why: '不是每个判断都需要两套动作。求非负绝对值时，负数需要改成相反数，0和正数保留原值即可。单分支if准确表达了“只在需要时修改”，也让轨迹清楚显示哪些输入触发写入、哪些输入直接越过分支。',
    walk: 'x=-7时比较x<0为真，进入块后读取旧x并取反，再把7写回同一x；块外输出7。x=9或0时比较为假，不执行赋值，输出保留的9或0。if之后的printf不在分支内部，因此所有合法输入都有一行结果。',
    io: 'x为-999到999，输出非负绝对值。题目明确练习无else的if；使用if/else可能算对输出，却不体现这节“跳过写入”的结构目标。',
    mistakes: [
      '把printf也放进if中，非负输入就没有输出。',
      '无条件x=-x会把正数变成负数。',
      '写if(x<0);导致空语句，后面的赋值可能变成无条件执行。',
    ],
    boundaries: [
      '0既不为负也不需要取反，输出0。',
      '输入不含INT_MIN，避免对最小int32取反溢出；正文的安全范围已明确。',
    ],
    hints: [
      '从“负数才需要改”提炼条件。',
      'if的块只做一次取反赋值，输出放在块后。',
      'if(x<0){x=-x;}之后printf("%d\\n",x)。',
    ],
  },
  {
    order: '04.03',
    lesson: 'nested-conditions',
    exercise: 'sign-classification',
    title: '嵌套分支与三路分类',
    rule: 'nested-sign-branches',
    target: '实际嵌套if/else区分负、零、正三路，路径和输入相关并覆盖。',
    fields: [integer('x')],
    exampleInput: { x: 0 },
    source: c(
      '    int x = 0;\n    if (x < 0) {\n        printf("-1\\n");\n    } else {\n        if (x == 0) {\n            printf("0\\n");\n        } else {\n            printf("1\\n");\n        }\n    }',
    ),
    tests: [
      test('negative', { x: -7 }, '-1\n'),
      test('zero', { x: 0 }, '0\n'),
      test('positive', { x: 9 }, '1\n'),
    ],
    knowledge: ['conditions', 'expressions'],
    blocks: ['if', 'comparison'],
    display: 'blocks',
    objectives: [
      '将三类互斥情况组织成两级判断',
      '说明内层条件只在外层某路成立后求值',
      '核对每条路径恰好产生一行输出',
    ],
    why: '一次二选一判断只能分出两类；若某一类还需要细分，就在该路径内继续判断。嵌套分支把“先知道什么，再问什么”写进结构，避免三个独立if互相重叠或漏掉边界。',
    walk: '先问x<0。负数直接输出-1，不进入后面的内层判断。否则已经知道x>=0，再问x==0：成立输出0，不成立只剩正数，输出1。输入0的轨迹依次经过外层else、内层then；输入9经过两个else。只有一条路径生效。',
    io: 'x在-999到999内。输出符号分类-1、0或1，而不是原输入。允许先分正数再分0/负数，但必须保留实际嵌套和三路有效覆盖。',
    mistakes: [
      '写三个互不相关条件，不能清楚表达本节嵌套结构。',
      '将内层条件写成x>=0，外层else里的所有值都会输出0。',
      '漏掉内层else，正数组没有结果。',
    ],
    boundaries: [
      '0既不是负数也不是正数，需要独立一路。',
      '内层声明或输出只在对应路径执行，未走路径不算覆盖。',
    ],
    hints: [
      '先把输入分为负数和非负数。',
      '在非负的else内部再区分0与正数。',
      '外层if(x<0)输出-1；else内if(x==0)输出0，否则输出1。',
    ],
  },
  {
    order: '04.04',
    lesson: 'interval-boundaries',
    exercise: 'in-closed-range',
    title: '闭区间与组合条件',
    rule: 'interval-membership',
    target: '同一if/else条件组合上下界比较，实际区分[-3,7]内外。',
    fields: [integer('x')],
    exampleInput: { x: -3 },
    source: c(
      '    int x = -3;\n    if (x >= -3 && x <= 7) {\n        printf("1\\n");\n    } else {\n        printf("0\\n");\n    }',
    ),
    tests: [
      test('below', { x: -4 }, '0\n'),
      test('left', { x: -3 }, '1\n'),
      test('inside', { x: 0 }, '1\n'),
      test('right', { x: 7 }, '1\n'),
      test('above', { x: 8 }, '0\n'),
    ],
    knowledge: ['conditions', 'expressions'],
    blocks: ['if', 'comparison', 'logical'],
    display: 'code',
    objectives: [
      '从闭区间文字推导包含端点的比较',
      '区分包含条件与排除条件的逻辑连接',
      '用两侧外点和两个端点检验边界',
    ],
    why: '区间判断容易只记住中间样例而忽略边界。方括号表示端点包含，所以-3和7都应进入同一“区间内”路径。将下界和上界分别表达为比较，再用逻辑组合，能让边界是否包含直接呈现在代码中。',
    walk: '输入-3时，下界比较为真，上界比较也为真，执行then输出1；输入7同样如此。-4不满足下界，&&短路后进入else输出0；8满足下界但不满足上界，也输出0。0位于内部，只用于确认正常路径，不能替代端点测试。',
    io: '输出1表示在[-3,7]内，否则0，末尾换行。也可用x<-3||x>7描述“区间外”并反转输出分支；两种有限表达形式都必须真实组合两个边界。',
    mistakes: [
      '使用严格大于/小于会错误排除-3和7。',
      '把包含条件用||连接，区间外的多数值也会满足一侧。',
      '写-3<=x<=7，比较链会先产生0/1，语义与数学不同。',
    ],
    boundaries: [
      '固定覆盖-4、-3、0、7、8，五组分别对应两外侧、两端点、内部。',
      '负数常量的一元负号属于已支持表达式，不需要额外语言特性。',
    ],
    hints: [
      '分别写“至少-3”和“至多7”。',
      '区间内用&&，区间外用||，不要混淆它们。',
      'if(x>=-3&&x<=7)输出1，否则输出0。',
    ],
  },
  {
    order: '05.01',
    lesson: 'while-countdown',
    exercise: 'while-countdown',
    title: 'while倒计时与零轮循环',
    rule: 'while-countdown',
    target: '实际while驱动从n到1的递减值逐项输出，n=0不进入循环。',
    fields: [integer('n', 0, 30)],
    exampleInput: { n: 4 },
    source: c(
      '    int n = 4;\n    int current = n;\n    while (current > 0) {\n        if (current < n) {\n            printf(" ");\n        }\n        printf("%d", current);\n        current = current - 1;\n    }\n    printf("\\n");',
    ),
    tests: [
      test('zero', { n: 0 }, '\n'),
      test('one', { n: 1 }, '1\n'),
      test('normal', { n: 4 }, '4 3 2 1\n'),
      test('maximum', { n: 30 }, listLine(descending30)),
    ],
    knowledge: ['loops', 'conditions', 'output'],
    blocks: ['while', 'if', 'comparison', 'arithmetic'],
    display: 'blocks',
    objectives: [
      '完整安排循环的初始状态、条件和更新',
      '追踪每轮输出使用的计数值',
      '正确处理0次循环与分隔符',
    ],
    why: 'while先检查条件再执行主体，因此循环可以一次也不执行。倒计时的三个要素很直观：从n开始，只要当前值大于0就输出，每轮减1。把它们写清楚，既能保证结束，也能说明为什么0输入只留下最后的换行。',
    walk: 'n=4时current从4开始。四次进入主体分别输出4、3、2、1，每次输出之后减1；current变0，下一次条件为假退出。用current<n判断是否已输出过一项，因此第一项前没有空格，后续项前各一个空格。循环外统一换行，所以n=0时仍有一行空输出。',
    io: 'n为0到30，不修改受保护输入n，使用current保存倒计时状态。输出数字以单空格分隔，无前导/尾随空格。题目指定while，不能用for替代该学习目标。',
    mistakes: [
      '忘记current减1，循环不会接近结束条件，最终触发预算保护。',
      '先减再输出，第一项变成n-1且可能输出0。',
      '每项后都输出空格，会产生题目未允许的尾空格。',
    ],
    boundaries: [
      'n=1只输出1和换行；n=0没有数字、没有空格。',
      'n=30仍是有限30轮，输出值必须来自当前迭代而非整段固定字符串。',
    ],
    hints: [
      '复制n到一个可变的current，想清输出在减1之前还是之后。',
      'while(current>0)中先处理分隔符和输出，再current=current-1。',
      '非首项可用current<n判断，循环外printf("\\n")统一收尾。',
    ],
  },
  {
    order: '05.03',
    lesson: 'loop-control',
    exercise: 'odd-sum-until-stop',
    title: 'break、continue与有效累加',
    rule: 'break-continue-odd-sum',
    target: '遍历1..n，超过stop真实break，偶数真实continue，其余奇数有效累加。',
    fields: [integer('n', 0, 30), integer('stop', 0, 30)],
    exampleInput: { n: 7, stop: 3 },
    source: c(
      '    int n = 7;\n    int stop = 3;\n    int sum = 0;\n    for (int i = 1; i <= n; i = i + 1) {\n        if (i > stop) {\n            break;\n        }\n        if (i % 2 == 0) {\n            continue;\n        }\n        sum = sum + i;\n    }\n    printf("%d\\n", sum);',
    ),
    tests: [
      test('empty', { n: 0, stop: 5 }, '0\n'),
      test('break-first', { n: 7, stop: 0 }, '0\n'),
      test('break-middle', { n: 7, stop: 3 }, '4\n'),
      test('continue', { n: 7, stop: 7 }, '16\n'),
      test('maximum', { n: 30, stop: 30 }, '225\n'),
    ],
    knowledge: ['loops', 'conditions', 'expressions'],
    blocks: ['for', 'if', 'comparison', 'arithmetic', 'break', 'continue'],
    display: 'blocks',
    objectives: [
      '分清结束循环与只跳过本轮',
      '安排停止检查、跳过检查和累加的顺序',
      '用真实奇数贡献解释最后的和',
    ],
    why: '循环主体不一定每轮都完整执行。break结束最内层循环；continue跳过本轮余下语句并进入循环的下一次更新/判断。它们必须放在产生贡献之前，才能真正改变哪些数被累加。做完后再打印公式虽然可能数值正确，却没有展示这节控制流目标。',
    walk: 'n=7、stop=3时，i=1累加到1；i=2因偶数continue，sum保持1；i=3累加到4；i=4先满足超过stop而break，循环结束，输出4。for的continue仍会执行i=i+1，因此不会卡在偶数。break之后不再进行后续i值的读取或累加。',
    io: 'n和stop各为0到30，目标是1..n中不超过stop的奇数和。stop可以大于n，无需把输入强行改小；在原n边界结束即可。',
    mistakes: [
      '把累加写在continue之前，偶数仍会进入结果。',
      '用continue代替超过stop的break，只跳过而没有提前结束。',
      '在while版本里把更新放在continue之后，容易跳过更新形成无限循环。',
    ],
    boundaries: [
      'n=0没有迭代，sum保留初始化0；stop=0在i=1即break。',
      'n=30、stop=30累加1到29的15个奇数，结果225。',
    ],
    hints: [
      '先处理超过停止位置，再处理不需要的偶数。',
      '两种转移都应发生在sum=sum+i之前。',
      '循环1..n，if(i>stop)break；if(i%2==0)continue；剩余路径累加i。',
    ],
  },
  {
    order: '05.04',
    lesson: 'nested-loops',
    exercise: 'grid-count',
    title: '嵌套循环逐格计数',
    rule: 'nested-grid-count',
    target: '内层循环位于外层体，每个真实网格位置给同一计数器贡献1。',
    fields: [integer('rows', 0, 10), integer('cols', 0, 10)],
    exampleInput: { rows: 3, cols: 4 },
    source: c(
      '    int rows = 3;\n    int cols = 4;\n    int count = 0;\n    for (int row = 0; row < rows; row = row + 1) {\n        for (int col = 0; col < cols; col = col + 1) {\n            count = count + 1;\n        }\n    }\n    printf("%d\\n", count);',
    ),
    tests: [
      test('empty-rows', { rows: 0, cols: 5 }, '0\n'),
      test('empty-cols', { rows: 5, cols: 0 }, '0\n'),
      test('one', { rows: 1, cols: 1 }, '1\n'),
      test('normal', { rows: 3, cols: 4 }, '12\n'),
      test('maximum', { rows: 10, cols: 10 }, '100\n'),
    ],
    knowledge: ['loops', 'variables'],
    blocks: ['for', 'comparison', 'arithmetic'],
    display: 'blocks',
    objectives: [
      '解释外层一轮为何包含完整内层循环',
      '在正确位置初始化内层计数',
      '区分逐格计数与直接使用乘法公式',
    ],
    why: '两层重复适合表达“每一行中的每一列”。数学上rows×cols能直接得到总数，但本节关心的是程序如何逐格到达该结果。把加1放在内层主体，就能用真实迭代次数解释计数增长，也能看到一维语句结构如何组织二维问题而无需多维数组。',
    walk: 'rows=3、cols=4时，row=0包含col的0、1、2、3四轮，count从0到4。row=1时重新声明col=0，再走四轮到8；row=2走到12。外层结束后输出12。内层变量每次建立/退出，外层count则一直保留累计值。',
    io: 'rows、cols各为0到10。任意一项为0都没有网格贡献，结果0。可以使用for或while，但内层必须实际嵌套并逐格加1，不能做完无关循环后用乘法覆盖。',
    mistakes: [
      '把内层循环放在外层之后，得到相加次数而非乘积次。',
      '把count=0放进外层主体，每行都会抹掉之前结果。',
      'while写法忘记每行重置col，只有第一行会遍历。',
    ],
    boundaries: [
      'rows=0时内层完全不建立；cols=0时外层可运行但count仍不变。',
      '10×10最多100次贡献，在原运行预算内。',
    ],
    hints: [
      '先写一行的cols次计数，再用rows次外循环包住它。',
      'count在两层外初始化，列计数在每行开始处初始化。',
      '两层循环主体最深处只做count=count+1，最后统一输出count。',
    ],
  },
  {
    order: '06.01',
    lesson: 'array-initialization',
    exercise: 'partial-array-init',
    title: '数组容量、初值与补零',
    rule: 'partial-array-initialization',
    target: '局部容量5数组恰用7,-2两项列表初始化，实际读取五槽含后三项补零。',
    fields: [],
    exampleInput: {},
    source: c(
      '    int values[5] = {7, -2};\n    for (int i = 0; i < 5; i = i + 1) {\n        if (i > 0) {\n            printf(" ");\n        }\n        printf("%d", values[i]);\n    }\n    printf("\\n");',
    ),
    tests: [test('partial', {}, '7 -2 0 0 0\n')],
    knowledge: ['arrays', 'variables', 'output'],
    blocks: ['declare-array', 'read-array', 'for', 'if', 'comparison', 'arithmetic'],
    display: 'code',
    objectives: [
      '区分数组容量和初始化列表长度',
      '说明部分初始化会将余下元素补零',
      '从真实槽读取验证初始化后的完整状态',
    ],
    why: '容量决定数组有多少个存储位置，列表决定显式给出了哪些初值。int values[5]={7,-2}创建五个元素，前两项使用列表值，其余三项补为0。补零是初始化语义，不是未初始化变量的随机值，也不是输出时临时猜出的默认值。',
    walk: '数组建立完成后索引0到4依次保存7、-2、0、0、0。循环i从0到4，每次读取真实values[i]并输出；i>0时先加分隔空格。i变5后条件失败，不读取values[5]。输出7 -2 0 0 0和换行，可在同一状态中逐项核对。',
    io: '本题没有外部输入，数组是学习者在程序里声明的局部数组。容量必须5，显式初值恰两项7和-2；写满五项虽输出相同，却不体现“补零”目标。',
    mistakes: [
      '以为列表只有两项，数组容量也只有2。',
      '把后三项当未初始化并认为不能读取；部分列表初始化已将它们补零。',
      '不读取数组，直接打印固定字符串，掩盖真实初始化过程。',
    ],
    boundaries: [
      '五个合法下标为0..4，5等于容量却已经越界。',
      '仅支持一维固定容量数组；不引入可变长数组或多维数组。',
    ],
    hints: [
      '把容量写在方括号里，两个显式初值写在花括号里。',
      '循环读取五项，别把后三个0手工加进初始化列表。',
      'int values[5]={7,-2}；i从0到4逐项printf，最后换行。',
    ],
  },
  {
    order: '06.03',
    lesson: 'array-traversal-output',
    exercise: 'print-logical-array',
    title: '遍历逻辑数组并输出',
    rule: 'logical-array-print',
    target: '实际循环按0..n-1顺序读取源数组并输出每个逻辑元素，空无占位读。',
    fields: [sequence()],
    relations: [lengthRelation],
    exampleInput: { values: [3, 0, -2, 3] },
    source: c(
      '    int n = 4;\n    int values[4] = {3, 0, -2, 3};\n    for (int i = 0; i < n; i = i + 1) {\n        if (i > 0) {\n            printf(" ");\n        }\n        printf("%d", values[i]);\n    }\n    printf("\\n");',
    ),
    tests: [
      test('empty', { values: [] }, '\n'),
      test('one', { values: [7] }, '7\n'),
      test('mixed', { values: [3, 0, -2, 3] }, '3 0 -2 3\n'),
      test('maximum', { values: thirty999 }, listLine(thirty999)),
    ],
    knowledge: ['arrays', 'loops', 'output'],
    blocks: ['declare-array', 'read-array', 'for', 'if', 'comparison', 'arithmetic'],
    display: 'blocks',
    objectives: [
      '用逻辑长度n控制下标遍历',
      '让每个真实元素按原顺序进入输出',
      '正确安排空数组与分隔空格',
    ],
    why: '遍历把“对每个元素做同一件事”变成有限循环。读取顺序也是结果的一部分：不能排序后再输出，不能漏掉0或重复值。输入派生的n表示真实元素数量，物理容量只保证程序能存放它们，尤其空输入时两者不能混为一谈。',
    walk: '示例n=4。i=0读取3，i=1读取0，i=2读取-2，i=3读取另一个3；每轮结束后i加1，最后i=4退出。两个3位置不同，必须各输出一次。先判断i>0再输出分隔空格，避免行首和行尾多余空格。',
    io: 'values长度0..30、元素-999..999。空输入显示n=0，物理数组用容量1的0占位；循环不进入，不读取占位，只输出换行。受保护n不能由学习者改为其他长度。',
    mistakes: [
      '使用i<=n，多读取一个逻辑位置。',
      '从1开始遍历，漏掉首元素。',
      '每项后输出空格，最后留下尾空格；或跳过值为0的元素。',
    ],
    boundaries: [
      '单项7只输出一次；重复值保持重复，负号保持原样。',
      '30个999都需要实际读取，不能用重复固定字符串替代数据流。',
    ],
    hints: [
      '先从i=0建立循环，继续条件是i<n。',
      '每轮只读取当前values[i]，不要改数组。',
      'i>0先输出空格，再输出当前整数，循环结束统一输出换行。',
    ],
  },
  {
    order: '06.04',
    lesson: 'logical-length-guards',
    exercise: 'safe-array-access',
    title: '逻辑长度与安全下标',
    rule: 'guarded-array-access',
    target: 'n/k逻辑范围守卫支配读取；合法读values[k]，非法无源数组读取并输出invalid。',
    fields: [sequence(), integer('k', -1, 30)],
    relations: [lengthRelation],
    exampleInput: { values: [3, 8], k: 1 },
    source: c(
      '    int n = 2;\n    int values[2] = {3, 8};\n    int k = 1;\n    if (k >= 0 && k < n) {\n        printf("%d\\n", values[k]);\n    } else {\n        printf("invalid\\n");\n    }',
    ),
    tests: [
      test('empty', { values: [], k: 0 }, 'invalid\n'),
      test('negative-index', { values: [3], k: -1 }, 'invalid\n'),
      test('first', { values: [3, 8], k: 0 }, '3\n'),
      test('last', { values: [3, 8], k: 1 }, '8\n'),
      test('past-end', { values: [3, 8], k: 2 }, 'invalid\n'),
      test('maximum', { values: thirty999, k: 30 }, 'invalid\n'),
    ],
    knowledge: ['arrays', 'conditions', 'input'],
    blocks: ['declare-array', 'read-array', 'if', 'comparison', 'logical'],
    display: 'blocks',
    objectives: [
      '用0<=k<n表示完整逻辑下标范围',
      '在真正读取之前验证边界',
      '区分物理可读位置与合法用户元素',
    ],
    why: 'k是一个整数，并不自动是合法下标。安全读取需要同时排除负数和不小于n的值；把判断放在读取之后没有保护作用。空序列的物理占位0虽然位于容量范围，却没有对应用户元素，所以也必须拒绝访问。',
    walk: '示例n=2、k=1。下界和上界都成立，读取values[1]=8并输出。k=2等于n，条件失败；k=-1也失败，均只输出invalid，不能先取值再决定格式。n=0、k=0时物理容量可能是1，但k<n仍是假，源数组不应发生任何读取。',
    io: 'values长度0..30，k允许-1..30，越出逻辑范围是本题正常待判断情况，不是提前被输入面板剔除的值。输出合法整数或invalid，各带换行。',
    mistakes: [
      '只检查k<n，负数仍可能进入读取。',
      '使用k<=n误把第n项当成合法。',
      '先保存int value=values[k]，再写if；潜在越界已经发生。',
    ],
    boundaries: [
      '合法首项为0，合法末项为n-1；n=0没有任何合法下标。',
      'n=30、k=30仍非法，不能因为数组达到最大长度就放宽。',
    ],
    hints: [
      '把两个必须同时满足的条件列出来。',
      '只有守卫成立的分支才出现values[k]。',
      'if(k>=0&&k<n)输出values[k]；else输出invalid和换行。',
    ],
  },
  {
    order: '07.02',
    lesson: 'array-extrema',
    exercise: 'array-extrema',
    title: '扫描数组求最小与最大',
    rule: 'array-extrema',
    target: '最小/最大候选均来自首逻辑元素，实际扫描比较与更新后输出两个候选。',
    fields: [sequence(1)],
    relations: [lengthRelation],
    exampleInput: { values: [3, -2, 8, 0] },
    source: c(
      '    int n = 4;\n    int values[4] = {3, -2, 8, 0};\n    int minimum = values[0];\n    int maximum = values[0];\n    for (int i = 1; i < n; i = i + 1) {\n        if (values[i] < minimum) {\n            minimum = values[i];\n        }\n        if (values[i] > maximum) {\n            maximum = values[i];\n        }\n    }\n    printf("%d %d\\n", minimum, maximum);',
    ),
    tests: [
      test('one', { values: [7] }, '7 7\n'),
      test('mixed', { values: [3, -2, 8, 0] }, '-2 8\n'),
      test('duplicates', { values: [4, 4] }, '4 4\n'),
      test('negative', { values: [-9, -2, -7] }, '-9 -2\n'),
      test('maximum', { values: [-999, 999, ...Array(28).fill(0)] }, '-999 999\n'),
    ],
    knowledge: ['arrays', 'loops', 'conditions'],
    blocks: ['declare-array', 'read-array', 'for', 'if', 'comparison', 'arithmetic'],
    display: 'blocks',
    objectives: [
      '从真实首元素建立两个候选',
      '维护“已扫描前缀的最小/最大”不变式',
      '解释全负数组为何不能从0初始化最大值',
    ],
    why: '扫描问题通常维护一个小状态来概括已看过的数据。minimum和maximum不需要保存全部历史，只需在新元素更小时或更大时更新。用首元素初始化保证候选确实来自输入，不会让0这种并不存在的数据污染全负或全正数组。',
    walk: '输入[3,-2,8,0]先令两候选都为3。读-2后最小变-2、最大仍3；读8后最大变8；读0后两者不变。每轮结束，候选准确概括已扫描部分，最终输出-2 8。可以一轮同时求，也可两轮分别求，只要实际比较和更新都来自逻辑数组。',
    io: '本题数组明确非空，长度1..30，元素-999..999；空数组没有定义本节要输出的两个极值，会作为输入非法拒绝。输出格式为min max和换行。',
    mistakes: [
      '把minimum或maximum初始化为0，全负或全正数据会出错。',
      '两个比较写成else if可能在特定初始化/变体中漏掉需要独立判断的目标。',
      '只比较第一和最后一项，忽略中间极值。',
    ],
    boundaries: [
      '单项[7]的最小和最大都为7，无后续迭代也合法。',
      '重复值[4,4]保持4 4；全负[-9,-2,-7]最大为-2而非0。',
    ],
    hints: [
      '先取values[0]作为两个候选，之后从下标1扫描。',
      '每个新值分别与两个候选比较，只更新需要变化的那一个。',
      'if(values[i]<minimum)minimum=values[i]；最大值相反，最后按min max输出。',
    ],
  },
  {
    order: '07.03',
    lesson: 'array-counting',
    exercise: 'count-positive',
    title: '条件计数与严格正数',
    rule: 'array-positive-count',
    target: '每个逻辑元素真实作严格>0判断，真分支的+1有效贡献到输出计数。',
    fields: [sequence()],
    relations: [lengthRelation],
    exampleInput: { values: [-1, 0, 3, 3] },
    source: c(
      '    int n = 4;\n    int values[4] = {-1, 0, 3, 3};\n    int count = 0;\n    for (int i = 0; i < n; i = i + 1) {\n        if (values[i] > 0) {\n            count = count + 1;\n        }\n    }\n    printf("%d\\n", count);',
    ),
    tests: [
      test('empty', { values: [] }, '0\n'),
      test('none', { values: [-2, 0] }, '0\n'),
      test('all', { values: [1, 2] }, '2\n'),
      test('mixed', { values: [-1, 0, 3, 3] }, '2\n'),
      test('maximum', { values: thirtyOne }, '30\n'),
    ],
    knowledge: ['arrays', 'loops', 'conditions'],
    blocks: ['declare-array', 'read-array', 'for', 'if', 'comparison', 'arithmetic'],
    display: 'blocks',
    objectives: [
      '区分数值总和与符合条件的元素个数',
      '每个命中元素只贡献1',
      '正确处理0、重复值和空序列',
    ],
    why: '求和累加的是元素值，计数累加的是满足条件的次数。两个3应该贡献两次1，而不是合成6；0不是严格正数，不应贡献。先明确累加单位是什么，再把条件与更新结合，能避免把相似循环机械套用到不同问题。',
    walk: 'count从0开始。读-1不大于0，保持0；读0仍保持0；读第一个3后变1；再读第二个3后变2。循环完成后输出2。每个元素都参与一次判断，即使判断为假也属于必须处理的数据。',
    io: 'values长度0..30、元素-999..999。结果必在0..n内。空输入不读物理占位，保留count=0；不对元素去重，也不只检查首项。',
    mistakes: [
      '写成>=0，将0也计为正数。',
      'count=count+values[i]算的是正数和，不是数量。',
      '每次遇到正数就count=1，会覆盖已累计次数。',
    ],
    boundaries: ['[-2,0]结果0，[1,2]结果2，[-1,0,3,3]结果2。', '30个1需要30次有效+1，结果30。'],
    hints: [
      '定义count表示已经看过的元素中正数的个数。',
      '循环每项，只有values[i]>0时才count加1。',
      'count在循环外初始化0；主体if(values[i]>0){count=count+1;}，最后输出。',
    ],
  },
  {
    order: '07.04',
    lesson: 'linear-search-first',
    exercise: 'linear-search-first',
    title: '顺序查找第一次匹配',
    rule: 'linear-first-index',
    target: '按递增下标线性比较元素与target，返回首次命中索引；未命中检查全部逻辑项。',
    fields: [sequence(), integer('target')],
    relations: [lengthRelation],
    exampleInput: { values: [4, 2, 2, 9], target: 2 },
    source: c(
      '    int n = 4;\n    int values[4] = {4, 2, 2, 9};\n    int target = 2;\n    int answer = -1;\n    for (int i = 0; i < n; i = i + 1) {\n        if (values[i] == target) {\n            answer = i;\n            break;\n        }\n    }\n    printf("%d\\n", answer);',
    ),
    tests: [
      test('empty', { values: [], target: 2 }, '-1\n'),
      test('first', { values: [2, 3], target: 2 }, '0\n'),
      test('middle', { values: [4, 2, 9], target: 2 }, '1\n'),
      test('last', { values: [4, 9, 2], target: 2 }, '2\n'),
      test('duplicate', { values: [4, 2, 2, 9], target: 2 }, '1\n'),
      test('absent', { values: [4, 9], target: 2 }, '-1\n'),
    ],
    knowledge: ['arrays', 'loops', 'conditions'],
    blocks: ['declare-array', 'read-array', 'for', 'if', 'comparison', 'arithmetic', 'break'],
    display: 'blocks',
    objectives: ['按原输入顺序逐项比较', '用-1区分未找到与合法下标0', '在重复值中保留第一次命中'],
    why: '顺序查找不要求数组有序，因为它不跳过尚未比较的位置。返回第一次匹配意味着越小的下标优先，找到后可立即break；如果继续扫描，也必须保护已有答案，不让后面的重复值覆盖。-1不属于合法下标，适合表示未找到。',
    walk: '在[4,2,2,9]中找2，i=0比较4与2不等；i=1比较命中，将answer设为1并break，后面的2不再改变答案。找不存在的值时，每个逻辑元素都比较过，answer仍为-1。空数组没有比较，初始-1直接进入输出。',
    io: 'values长度0..30，无排序要求；target与元素均在-999..999。输出0基首次下标或-1和换行，不能输出第几项的人类序号1..n。',
    mistakes: [
      '找到后继续无条件覆盖answer，最终返回最后一次出现。',
      'answer初始化为0，未找到就伪装成首项命中。',
      '未比较所有项就宣布不存在，或用二分代替本节线性目标。',
    ],
    boundaries: [
      '首项命中返回0，末项命中返回n-1。',
      '重复测试必须返回较小下标；空输入不得读取占位。',
    ],
    hints: [
      '答案先设为一个不合法的下标-1。',
      '从0递增比较，第一次相等时保存当前i并退出。',
      'if(values[i]==target){answer=i;break;}，循环后输出answer。',
    ],
  },
  {
    order: '08.01',
    lesson: 'adjacent-order',
    exercise: 'check-nondecreasing',
    title: '相邻比较与非递减',
    rule: 'adjacent-order-check',
    target: '按实际相邻项比较判断有序，直到首逆序或遍历完整区间，输出依赖比较。',
    fields: [sequence()],
    relations: [lengthRelation],
    exampleInput: { values: [1, 3, 2, 4] },
    source: c(
      '    int n = 4;\n    int values[4] = {1, 3, 2, 4};\n    int ordered = 1;\n    for (int i = 0; i < n - 1; i = i + 1) {\n        if (values[i] > values[i + 1]) {\n            ordered = 0;\n            break;\n        }\n    }\n    printf("%d\\n", ordered);',
    ),
    tests: [
      test('empty', { values: [] }, '1\n'),
      test('one', { values: [7] }, '1\n'),
      test('equal', { values: [2, 2] }, '1\n'),
      test('ordered', { values: [-2, 0, 3] }, '1\n'),
      test('inversion', { values: [1, 3, 2, 4] }, '0\n'),
    ],
    knowledge: ['arrays', 'sorting', 'conditions'],
    blocks: ['declare-array', 'read-array', 'for', 'if', 'comparison', 'arithmetic', 'break'],
    display: 'blocks',
    objectives: [
      '用每对相邻不下降定义非递减',
      '从一个逆序对推出整体无序',
      '为排序与二分明确输入前提',
    ],
    why: '非递减不是“每项都不同”，相等也允许。若每对相邻元素都满足左<=右，整个序列就非递减；发现一对左>右便足以否定。这个检查只读取数组，不做交换，与“把数组排序好”是不同任务。',
    walk: '对[1,3,2,4]，先比较1和3没有逆序；再比较3和2发现左大右小，将ordered从1改0并结束检查。虽然首项1小于末项4，仍不能说明整体有序。[-2,0,3]的两对都通过，标志保持1。',
    io: 'values长度0..30。输出1表示非递减，否则0。空或单项没有相邻对可违反要求，按定义输出1；不得为此读物理占位或越界相邻元素。',
    mistakes: [
      '只比较首尾，漏掉中间逆序。',
      '用>=作为逆序条件，把相等元素判无序。',
      '循环到i<n再读i+1，最后一次访问越界。',
    ],
    boundaries: [
      '[2,2]是有序；[1,3,2,4]不是。',
      '检查有序性不改变输入；排序或换成固定数组后再检查会偏离目标。',
    ],
    hints: [
      '把ordered先设为1，只在找到反例时改0。',
      '相邻比较使用values[i]和values[i+1]，i必须小于n-1。',
      '发现values[i]>values[i+1]时ordered=0，可break；最后输出标志。',
    ],
  },
  {
    order: '08.02',
    lesson: 'bubble-sort',
    exercise: 'bubble-sort',
    title: '冒泡排序与逐轮缩尾',
    rule: 'bubble-ascending',
    target:
      '按冻结冒泡方案相邻严格大于才交换，逐轮缩尾、不提前退出；真实源数组最终升序且多重集合保持。',
    fields: [sequence()],
    relations: [lengthRelation],
    exampleInput: { values: [7, -3, 0, 5, -3, 2, 9] },
    source: caseSource.catalogs.find((entry) => entry.program.id === 'program.c.bubble-sort')
      .program.sourceExample,
    tests: [
      test('empty', { values: [] }, '\n', []),
      test('one', { values: [7] }, '7\n', [7]),
      test('ordered', { values: [-2, 0, 3] }, '-2 0 3\n', [-2, 0, 3]),
      test('reverse', { values: [4, 3, 2, 1] }, '1 2 3 4\n', [1, 2, 3, 4]),
      test('mixed', { values: [3, -1, 3, 0] }, '-1 0 3 3\n', [-1, 0, 3, 3]),
      test('maximum', { values: descending30 }, listLine(ascending30), ascending30),
    ],
    knowledge: ['sorting', 'arrays', 'loops'],
    blocks: ['declare-array', 'read-array', 'write-array', 'for', 'if', 'comparison', 'arithmetic'],
    display: 'blocks',
    objectives: [
      '解释一轮相邻交换为何确定右端最大值',
      '用end逐轮缩短尚未确定区间',
      '核对实际数组变化与输出而非只看结果字符串',
    ],
    why: '排序把无序数据组织为非递减顺序。冒泡每次只处理相邻一对，较大值通过连续交换向右移动，一整轮后最右端就已确定。下一轮无需再碰已经确定的尾部，所以end递减。此课程采用固定完整轮次，不加入“本轮无交换即停止”的优化，以便各输入的比较序列一致可审查。',
    walk: '可先用[3,1,2]手算：比较3与1并交换成[1,3,2]；再比较3与2并交换成[1,2,3]，第一轮确定尾部3。下一轮只比较1与2，不交换，结束。完整示例使用7项含负数和重复值，最终为[-3,-3,0,2,5,7,9]。每次交换先保存左值，再两次数组写入；同值用严格>比较，不交换。',
    io: '数组长度0..30，元素-999..999。需要原地改变同一个源数组，保持元素出现次数；输出所有排序后元素、单空格、无尾空格、末尾换行。仅打印另一份已排序常量不能通过销毁前数组检查。',
    mistakes: [
      '交换时未保存旧左值，两次写入得到重复值而丢失一个元素。',
      '内层条件写j<=end，访问j+1时越界。',
      '使用>=会对相等项做不必要交换，偏离本课程冻结方案。',
    ],
    boundaries: [
      '空输入不读占位、只换行；单项无需比较与交换。',
      '有序、逆序、重复、负数和30项都使用同一方案，安全预算保持。',
    ],
    hints: [
      '先写一次相邻交换，确认临时变量保护两个旧值。',
      '外层end从n-1减到1，内层j从0走到end-1。',
      '仅当values[j]>values[j+1]时用temp交换，完成所有轮次后遍历输出。',
    ],
  },
  {
    order: '08.03',
    lesson: 'selection-sort',
    exercise: 'selection-sort',
    title: '选择排序与最小下标',
    rule: 'selection-ascending',
    target: '剩余区扫描保留首个最小下标，只有minIndex!=i才交换；真实源数组最终升序且多重集合保持。',
    fields: [sequence()],
    relations: [lengthRelation],
    exampleInput: { values: [7, -3, 0, 5, -3, 2, 9] },
    source: caseSource.catalogs.find((entry) => entry.program.id === 'program.c.selection-sort')
      .program.sourceExample,
    tests: [
      test('empty', { values: [] }, '\n', []),
      test('one', { values: [7] }, '7\n', [7]),
      test('ordered', { values: [-2, 0, 3] }, '-2 0 3\n', [-2, 0, 3]),
      test('reverse', { values: [4, 3, 2, 1] }, '1 2 3 4\n', [1, 2, 3, 4]),
      test('duplicate', { values: [2, 1, 1, 3] }, '1 1 2 3\n', [1, 1, 2, 3]),
      test('maximum', { values: descending30 }, listLine(ascending30), ascending30),
    ],
    knowledge: ['sorting', 'arrays', 'loops'],
    blocks: ['declare-array', 'read-array', 'write-array', 'for', 'if', 'comparison', 'arithmetic'],
    display: 'blocks',
    objectives: [
      '维护剩余区首个最小元素的下标',
      '解释扫描完成后才交换的原因',
      '区分不自交换与稳定排序的概念',
    ],
    why: '选择排序把问题拆为“先确定应放在当前位置的元素，再交换”。minIndex记录候选位置，比较时用数组该位置的值。只在严格更小才更新，便保留剩余区首个最小下标；扫描后若候选已在当前位置，无需自交换。这个规则减少无效写入，但并不保证整个算法对相等元素稳定。',
    walk: '对[3,1,2]，i=0从minIndex=0开始，扫描到1后候选变1，再看2不更新；交换位置0和1得[1,3,2]。i=1扫描剩余区发现2，交换得[1,2,3]。对[2,1,1,3]，第一次遇到下标1的1后，另一个相等1不会替换候选。比较轨迹与写入顺序都来自当前运行。',
    io: '长度0..30、元素-999..999。原地升序、保留多重集合，输出单空格无尾空格。正文与练习沿已冻结案例方案，不加入不同排序算法来替代本节扫描过程。',
    mistakes: [
      '用<=更新候选，会改成最后一个最小下标。',
      '扫描尚未结束就反复交换，变成另一种过程。',
      '遗漏minIndex!=i的条件，对已经在位的元素执行自交换。',
    ],
    boundaries: [
      '空和单项没有外层轮次；已排序输入每轮候选常常不移动。',
      '本算法不承诺稳定性；整数相等不能被解读为对象顺序已获保证。',
    ],
    hints: [
      '每轮从i开始设minIndex=i，再扫描i+1..n-1。',
      '只在新元素严格小于当前候选时更新minIndex。',
      '扫描后if(minIndex!=i)用temp交换values[i]与values[minIndex]，再进入下一轮。',
    ],
  },
  {
    order: '08.04',
    lesson: 'binary-search-first',
    exercise: 'binary-search-first',
    title: '二分查找首次匹配',
    rule: 'binary-first-index',
    target:
      '非递减输入上闭区间迭代，安全中点，比较缩区间；命中保存候选并继续左侧，输出首次下标或-1。',
    fields: [sequence(), integer('target')],
    relations: [lengthRelation, { kind: 'nondecreasing', field: 'values' }],
    exampleInput: { values: [-2, 0, 0, 4, 8], target: 0 },
    source: old.programs.find((entry) => entry.id === 'program.c.binary-search-first')
      .sourceExample,
    tests: [
      test('empty', { values: [], target: 2 }, '-1\n'),
      test('one-hit', { values: [2], target: 2 }, '0\n'),
      test('one-miss', { values: [2], target: 3 }, '-1\n'),
      test('first', { values: [-2, 0, 3], target: -2 }, '0\n'),
      test('last', { values: [-2, 0, 3], target: 3 }, '2\n'),
      test('duplicate', { values: [-2, 0, 0, 0, 3], target: 0 }, '1\n'),
      test('absent-low', { values: [1, 3], target: -1 }, '-1\n'),
      test('absent-high', { values: [1, 3], target: 4 }, '-1\n'),
      test('absent-middle', { values: [1, 3], target: 2 }, '-1\n'),
    ],
    knowledge: ['binary-search', 'arrays', 'conditions', 'loops'],
    blocks: ['declare-array', 'read-array', 'while', 'if', 'comparison', 'arithmetic'],
    display: 'blocks',
    objectives: [
      '说明二分必须依赖输入非递减前提',
      '用闭区间及安全中点排除不可能区域',
      '在重复值中命中后仍向左寻找首次位置',
    ],
    why: '顺序查找逐个检查，二分利用有序性一次排除一段区域。如果中点值小于目标，左侧所有值也不可能匹配；若大于或等于目标，首次匹配只能在中点及左侧。要求“首次”时，命中不能立即返回，而应保存候选后继续缩向左边。',
    walk: '示例[-2,0,0,4,8]找0：初始left=0、right=4，中点2命中，answer=2，right变1；再看中点0值-2较小，left变1；中点1再次命中，answer改1，right变0。此时left>right，输出1。中点使用left+(right-left)/2，表达区间偏移并避免直接相加潜在溢出。',
    io: 'values长度0..30，必须已经非递减，乱序会被输入校验拒绝而不会替你排序。输出首次0基下标或-1。target和元素在-999..999；九组固定测试包含空、单项、两端、重复及各种未命中。',
    mistakes: [
      '一命中就结束，重复值可能返回中间而非首次。',
      '更新为right=mid或left=mid，区间可能不缩小。',
      '将未找到初始化为0，或将线性扫描伪装成二分目标。',
    ],
    boundaries: [
      '空输入right=-1，while一次不进，不读占位，输出-1。',
      '未找到时即使目标位于两值之间也返回-1；原输入不会被修改或排序。',
    ],
    hints: [
      '使用闭区间[0,n-1]和answer=-1。',
      '当values[mid]>=target时向左缩；若相等先保存mid。',
      '命中后right=mid-1；较小时left=mid+1；循环条件left<=right，最后输出answer。',
    ],
  },
];

const chapters = [
  ['values', '程序入门与输出'],
  ['state', '变量与程序状态'],
  ['expressions', '表达式与逻辑'],
  ['control', '条件与分支'],
  ['loops', '循环与重复'],
  ['arrays', '一维数组基础'],
  ['array-problems', '数组问题求解'],
  ['sorting-search', '排序与搜索入门'],
];
const existing = [
  ['01.02', 'variables-output', 'echo'],
  ['03.01', 'expressions', 'two-x-plus-three'],
  ['04.02', 'conditions', 'nonnegative'],
  ['05.02', 'loops', 'two-loop-sums'],
  ['06.02', 'array-update', 'increment-at-index'],
  ['07.01', 'array-sum', 'array-sum'],
];
assert.equal(lessons.length, 26);
const course = clone(old);
course.contractVersion = '1.1.0';
course.packageId = 'content.c.p05';
course.packageVersion = '1.0.0';
course.lessons = [];
course.exercises = [];
course.chapters = [];

// Merge exact reviewed case entities/programs, preserving intermediate program versions.
for (const entry of caseSource.catalogs) {
  const programIndex = course.programs.findIndex((program) => program.id === entry.program.id);
  if (programIndex >= 0) course.programs[programIndex] = clone(entry.program);
  else course.programs.push(clone(entry.program));
  if (!course.inputSpecs.some((spec) => spec.id === entry.inputSpec.id))
    course.inputSpecs.push(clone(entry.inputSpec));
}
course.cases = caseSource.catalogs.map((entry) => ({
  ...clone(entry.subject),
  version: '1.1.0',
  acceptedPriorVersions: ['case.c.bubble-sort', 'case.c.selection-sort'].includes(entry.subject.id)
    ? ['1.0.1', '1.0.2']
    : ['1.0.1'],
  relatedLessonRefs: entry.subject.relatedLessonRefs.map((value) => ref(value.id, '1.1.0')),
}));

const guidance = [];
const references = [];
const commonBlocks = [
  'main',
  'integer',
  'declare-int',
  'read-variable',
  'assign-variable',
  'unary',
  'printf',
  'return',
];
const knownBlockIds = new Set(course.blocks.map((block) => block.id));
const blockRefs = (extras) =>
  [...new Set([...commonBlocks, ...extras])]
    .map((id) => ref(`block.c.${id}`))
    .filter((value) => knownBlockIds.has(value.id));
const paragraph = (value) => value.replace(/\r\n/g, '\n');

for (const entry of lessons) {
  const chapterIndex = Number(entry.order.slice(0, 2)) - 1;
  const chapterId = `chapter.c.${chapters[chapterIndex][0]}`;
  const oldChapter = old.chapters.find((chapter) => chapter.id === chapterId);
  const chapterRef = ref(chapterId, oldChapter ? '1.1.0' : '1.0.0');
  const lessonId = `lesson.c.${entry.lesson}`;
  const exerciseId = `exercise.c.${entry.exercise}`;
  const programId = `program.c.practice-${entry.exercise}`;
  const judgeId = `judge.c.${entry.exercise}`;
  const inputId = `input.c.${entry.exercise}`;
  const knowledgeRefs = entry.knowledge.map((id) => ref(`knowledge.c.${id}`));
  const source = paragraph(entry.source);
  const binds = entry.fields.flatMap((field) =>
    field.kind === 'sequence' ? clone(arrayBindings) : [scalarBinding(field.key)],
  );
  const blocks = blockRefs(entry.blocks);
  const extraExamples = (entry.extraExamples ?? [])
    .map(
      (example) =>
        `### ${example.label}\n\n${example.explanation}\n\n\`\`\`c\n${example.code}\`\`\`\n`,
    )
    .join('\n');
  const explanation = `## 为什么学习这一节\n\n${entry.why}\n\n## 完整示例\n\n${entry.io}\n\n\`\`\`c\n${source}\`\`\`\n\n## 按状态理解执行\n\n${entry.walk}\n\n先预测，再运行上面的完整程序。源码中的初始化值就是本例输入；练习输入面板会为当前运行生成对应可见声明。正文给出的过程是理解提示，实际步骤、变量和输出以同一次Rust执行轨迹为准。\n\n${extraExamples}## 如何独立练习\n\n先从独立练习的无答案骨架尝试，保留题目输入声明。题内积木显示由你选择，代码与积木是同一程序的两种编辑入口。需要帮助时可在练习中主动打开分层提示，先看思路，再看结构，最后才看关键操作。\n\n运行本组用于观察，提交练习才检查全部固定测试和教学目标；保存成功后才确认持久通过。浏览本节、看参考答案或反复复盘都不会自动完成学习。`;
  course.inputSpecs.push({
    id: inputId,
    version: '1.0.0',
    title: `${entry.title}输入`,
    fields: clone(entry.fields),
    relations: clone(entry.relations ?? []),
  });
  course.programs.push({
    id: programId,
    version: '1.0.0',
    title: `${entry.title}参考`,
    languageRef: lang,
    subsetRef: ref('subset.c.p0'),
    inputRef: ref(inputId),
    exampleInput: clone(entry.exampleInput),
    sourceExample: source,
    bindings: binds,
    blockRefs: blocks,
    reference: { document: sourceDocument, locator: `${entry.order}；项目原创；受P0-C约束` },
  });
  course.judgeProfiles.push({
    id: judgeId,
    version: '1.0.0',
    title: `${entry.title}教学检查`,
    rule: entry.rule,
    targetDescription: entry.target,
  });
  course.exercises.push({
    id: exerciseId,
    version: '1.0.0',
    title: entry.title,
    languageRef: lang,
    lessonRef: ref(lessonId),
    learningRevision: 1,
    acceptedPriorVersions: [],
    knowledgeRefs,
    programRef: ref(programId),
    judgeRef: ref(judgeId),
    prompt: `${entry.io}\n\n教学目标：${entry.target}\n\n所有测试都须正常结束且main返回0。必须让当前真实执行的数据与控制过程满足目标，不能用固定答案、死读取或未执行结构代替。`,
    tests: clone(entry.tests),
    rewardRef: ref('reward.exercise.first-pass'),
  });
  course.lessons.push({
    id: lessonId,
    version: '1.0.0',
    title: entry.title,
    languageRef: lang,
    chapterRef,
    learningRevision: 1,
    acceptedPriorVersions: [],
    knowledgeRefs,
    requiredExerciseRefs: [ref(exerciseId)],
    optionalExerciseRefs: [],
    caseRefs: [],
    blockRefs: blocks,
    teaching: {
      objectives: entry.objectives,
      explanation,
      exampleProgramRefs: [ref(programId)],
      commonMistakes: entry.mistakes,
      boundaryNotes: entry.boundaries,
      source: {
        document: sourceDocument,
        locator: `${entry.order}；${lessonId}；项目原创讲解与示例`,
      },
    },
    rewardRef: ref('reward.lesson.first-completion'),
  });
  guidance.push({
    order: entry.order,
    lessonRef: ref(lessonId),
    exerciseRef: ref(exerciseId),
    preferredEditor: entry.display,
    hints: entry.hints,
    source,
    extraExamples: entry.extraExamples ?? [],
  });
  references.push({
    order: entry.order,
    lessonRef: ref(lessonId),
    exerciseRef: ref(exerciseId),
    source,
  });
}

const retainedHints = {
  echo: [
    '找到输入x的声明与当前值。',
    '将变量读取放进printf的%d参数。',
    '输出x和一个换行，不能输出示例常量。',
  ],
  'two-x-plus-three': [
    '先列出乘以2和加3的先后关系。',
    '输入x必须真实参与两种运算并影响输出。',
    '可令result=2*x+3，再输出result和换行。',
  ],
  nonnegative: [
    '非负包括0，分界条件是x>=0。',
    '使用同一个if/else在不同输入下覆盖两路。',
    'then输出1，else输出0，每条结果都换行。',
  ],
  'two-loop-sums': [
    '建立两个独立从0开始的累加器。',
    '一个while、一个for各遍历1..n，输出两行。',
    '每轮把当前计数+1系数累入对应和；n=0时两个和都保持0。',
  ],
  'increment-at-index': [
    '只允许修改源数组的第k项。',
    '读取values[k]，加1，再写回同一位置。',
    '其余元素保持，输出更新后的values[k]并换行。',
  ],
  'array-sum': [
    '从0开始累加所有逻辑元素。',
    '下标0..n-1逐项读取，空输入不读占位。',
    '循环中sum=sum+values[i]，最后输出sum和换行。',
  ],
};
const correctionEdits = {
  'first-output': [['Hello, C!', 'Hello,C!']],
  'printf-layout': [['x, y);', 'y, x);']],
  'ordered-updates': [['x = x + 1;', 'x = x + 2;']],
  'reassign-value': [['result = x + 3;', 'result = x + 2;']],
  'swap-with-temp': [['int temp = x;', 'int temp = y;']],
  'shadowed-values': [['int value = x + 1;', 'int value = x + 2;']],
  'wide-product': [['x * 1000000', 'x * 100000']],
  'quotient-remainder': [['int remainder = a % b;', 'int remainder = a / b;']],
  'boolean-flags': [['x <= 10', 'x < 10']],
  'guarded-division': [['12 / x > 0', '12 / x >= 0']],
  'absolute-with-if': [['if (x < 0)', 'if (x > 0)']],
  'sign-classification': [['if (x == 0)', 'if (x > 0)']],
  'in-closed-range': [['x <= 7', 'x < 7']],
  'while-countdown': [['while (current > 0)', 'while (current > 1)']],
  'odd-sum-until-stop': [['i % 2 == 0', 'i % 2 != 0']],
  'grid-count': [['count = count + 1;', 'count = count + 2;']],
  'partial-array-init': [['{7, -2}', '{7, -2, 1}']],
  'print-logical-array': [['i < n;', 'i < n - 1;']],
  'safe-array-access': [['k < n', 'k <= n']],
  'array-extrema': [['int minimum = values[0];', 'int minimum = 0;']],
  'count-positive': [['values[i] > 0', 'values[i] >= 0']],
  'linear-search-first': [['            break;\n', '']],
  'check-nondecreasing': [['values[i] > values[i + 1]', 'values[i] >= values[i + 1]']],
  'bubble-sort': [['values[j] > values[j + 1]', 'values[j] < values[j + 1]']],
  'selection-sort': [['values[j] < values[minIndex]', 'values[j] > values[minIndex]']],
  'binary-search-first': [['answer = mid;', 'answer = mid + 1;']],
  echo: [['"%d\\n"', '"%d"']],
  'two-x-plus-three': [['(2 * x)', '(1 * x)']],
  nonnegative: [['if (x >= 0)', 'if (x > 0)']],
  'two-loop-sums': [
    ['while (i <= n)', 'while (i < n)'],
    ['j <= n;', 'j < n;'],
  ],
  'increment-at-index': [['values[k] + 1', 'values[k] + 0']],
  'array-sum': [['int sum = 0;', 'int sum = 1;']],
};
for (const [order, lessonSuffix, exerciseSuffix] of existing) {
  const lesson = clone(old.lessons.find((value) => value.id === `lesson.c.${lessonSuffix}`));
  const exercise = clone(
    old.exercises.find((value) => value.id === `exercise.c.${exerciseSuffix}`),
  );
  const chapterIndex = Number(order.slice(0, 2)) - 1;
  const chapterId = `chapter.c.${chapters[chapterIndex][0]}`;
  const chapterVersion = old.chapters.some((value) => value.id === chapterId) ? '1.1.0' : '1.0.0';
  lesson.version = exercise.version = '1.1.0';
  lesson.acceptedPriorVersions = exercise.acceptedPriorVersions = ['1.0.1'];
  lesson.chapterRef = ref(chapterId, chapterVersion);
  lesson.requiredExerciseRefs = [ref(exercise.id, '1.1.0')];
  lesson.caseRefs = lesson.caseRefs.map((value) => ref(value.id, '1.1.0'));
  exercise.lessonRef = ref(lesson.id, '1.1.0');
  const program = course.programs.find((value) => value.id === exercise.programRef.id);
  const hints = retainedHints[exerciseSuffix];
  lesson.teaching.explanation += `\n\n## 本节完整参考程序\n\n以下保留原题目目标与输入绑定。新增细分课程用于补充讲解，不改变已经通过本节的完成条件。\n\n\`\`\`c\n${program.sourceExample}\`\`\`\n\n在练习中可主动打开三层提示；独立练习默认只保留输入骨架，不替你填答案。课程移动到新章节后，旧同ID的有效学习记录仍按显式兼容链保留。只有新的真实提交或主动学习确认才产生当天事实；移章、刷新、查看本段不会重新发首次积分。`;
  lesson.teaching.source = {
    document: sourceDocument,
    locator: `${order}；保留原目标与正文，补充完整示例及复习说明；项目原创`,
  };
  course.lessons.push(lesson);
  course.exercises.push(exercise);
  guidance.push({
    order,
    lessonRef: ref(lesson.id, '1.1.0'),
    exerciseRef: ref(exercise.id, '1.1.0'),
    preferredEditor: ['01.02', '03.01', '04.02'].includes(order) ? 'code' : 'blocks',
    hints,
    source: program.sourceExample,
    extraExamples: [],
  });
  references.push({
    order,
    lessonRef: ref(lesson.id, '1.1.0'),
    exerciseRef: ref(exercise.id, '1.1.0'),
    source: program.sourceExample,
  });
  assert.deepEqual(exercise.tests, old.exercises.find((value) => value.id === exercise.id).tests);
}
guidance.sort((a, b) => a.order.localeCompare(b.order));
references.sort((a, b) => a.order.localeCompare(b.order));
const guidanceResource = {
  guidanceVersion: '1.0.0',
  packageRef: ref('content.c.p05'),
  entries: guidance.map((entry) => {
    let correctionSource = entry.source;
    const suffix = entry.exerciseRef.id.slice('exercise.c.'.length);
    assert.ok(correctionEdits[suffix], `Missing correction edit ${suffix}`);
    for (const [before, after] of correctionEdits[suffix]) {
      assert.ok(
        correctionSource.includes(before),
        `Correction edit missing source token ${suffix}: ${before}`,
      );
      correctionSource = correctionSource.replace(before, after);
    }
    assert.notEqual(correctionSource, entry.source);
    return {
      exerciseRef: entry.exerciseRef,
      hints: entry.hints,
      correctionSource,
      preferredEditor: entry.preferredEditor,
    };
  }),
};
const lessonOrder = new Map(guidance.map((entry) => [entry.lessonRef.id, entry.order]));
const exerciseOrder = new Map(guidance.map((entry) => [entry.exerciseRef.id, entry.order]));
course.lessons.sort((a, b) => lessonOrder.get(a.id).localeCompare(lessonOrder.get(b.id)));
course.exercises.sort((a, b) => exerciseOrder.get(a.id).localeCompare(exerciseOrder.get(b.id)));
course.chapters = chapters.map(([suffix, title], index) => {
  const id = `chapter.c.${suffix}`;
  return {
    id,
    version: old.chapters.some((value) => value.id === id) ? '1.1.0' : '1.0.0',
    title,
    languageRef: lang,
    order: index + 1,
    lessonRefs: course.lessons
      .filter((value) => value.chapterRef.id === id)
      .map((value) => ref(value.id, value.version)),
  };
});
assert.equal(course.lessons.length, 32);
assert.equal(course.exercises.length, 32);
assert.ok(course.chapters.every((value) => value.lessonRefs.length === 4));
assert.equal(new Set(course.lessons.map((value) => value.id)).size, 32);
assert.equal(new Set(course.exercises.map((value) => value.id)).size, 32);
for (const group of ['programs', 'inputSpecs', 'judgeProfiles']) {
  assert.equal(new Set(course[group].map((value) => value.id)).size, course[group].length);
}
for (const original of old.exercises) {
  assert.deepEqual(
    course.exercises.find((value) => value.id === original.id).tests,
    original.tests,
  );
  assert.deepEqual(
    course.programs.find((value) => value.id === original.programRef.id),
    old.programs.find((value) => value.id === original.programRef.id),
  );
  assert.deepEqual(
    course.judgeProfiles.find((value) => value.id === original.judgeRef.id),
    old.judgeProfiles.find((value) => value.id === original.judgeRef.id),
  );
}
await mkdir('content/c/p05', { recursive: true });
await mkdir('.artifacts/P0.5-09', { recursive: true });
await writeFile('content/c/p05/course-1.0.0.json', `${JSON.stringify(course, null, 2)}\n`);
await writeFile(
  'content/c/p05/practice-guidance-1.0.0.json',
  `${JSON.stringify(guidanceResource, null, 2)}\n`,
);
await writeFile(
  '.artifacts/P0.5-09/reference-solutions.json',
  `${JSON.stringify({ task: 'P0.5-09', purpose: 'developer-public-reference-programs', solutions: references }, null, 2)}\n`,
);
await writeFile(
  '.artifacts/P0.5-09/course-authoring-aid.json',
  `${JSON.stringify({ task: 'P0.5-09', purpose: 'developer-content-review-only', entries: guidance }, null, 2)}\n`,
);
await writeFile(
  'tests/fixtures/p05-reference-solutions.json',
  `${JSON.stringify({ task: 'P0.5-09', purpose: 'developer-public-reference-programs', solutions: references }, null, 2)}\n`,
);
await writeFile(
  'tests/fixtures/p05-authoring-examples.json',
  `${JSON.stringify({ task: 'P0.5-09', purpose: 'developer-content-review-only', entries: guidance }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    chapters: course.chapters.length,
    lessons: course.lessons.length,
    exercises: course.exercises.length,
    cases: course.cases.length,
    programs: course.programs.length,
    tests: course.exercises.reduce((total, value) => total + value.tests.length, 0),
  }),
);
