import type { DiagnosticCode } from '../engine/protocol';

export interface DiagnosticMessage {
  summary: string;
  explanation: string;
  action: string;
}
const message = (summary: string, explanation: string, action: string): DiagnosticMessage => ({
  summary,
  explanation,
  action,
});

/** Local teaching copy; the interpreter alone decides which error occurred. */
export const diagnosticMessages = {
  E_LEX_INVALID: message(
    '无法识别字符或字面量',
    '解释器在把源码读成单词和符号时停下了；字符、数字、字符串或注释可能不符合当前子集。',
    '检查标记处的字符，以及前面的引号、注释和转义。',
  ),
  E_PARSE_INVALID: message(
    '语句结构不完整或顺序不正确',
    '字符已被读到，但不能组成当前需要的语句结构。标记处是发现问题的位置，遗漏也可能在前一行。',
    '核对分号、括号、花括号和表达式，保留原稿逐处修正。',
  ),
  E_UNSUPPORTED_SYNTAX: message(
    '当前教学子集不支持这段写法',
    '这不一定是标准语言中的错误，但当前解释器不能执行它。',
    '参考本课支持范围，改用已支持的语法。',
  ),
  E_NAME_INVALID: message(
    '名称声明或使用不正确',
    '名称可能尚未声明、在同一作用域重复，或使用了保留名称。',
    '核对拼写、声明位置和作用域，不要只修改报错行。',
  ),
  E_TYPE_INVALID: message(
    '值或对象的类型不符合要求',
    '该位置需要的值与提供的变量、数组或初始化方式不匹配。',
    '检查数组长度、初值数量以及整数与数组的使用方式。',
  ),
  E_FORMAT_INVALID: message(
    '输出格式与参数不匹配',
    'printf 的格式或参数不符合当前支持范围，%d 需要对应整数参数，%% 表示百分号。',
    '逐一核对格式占位符和后面的参数。',
  ),
  E_UNINITIALIZED: message(
    '读取了尚未初始化的值',
    '变量或数组元素还没有可读取的值，不能依赖一个碰巧出现的数。',
    '在所有可能读到它的路径上先赋值。',
  ),
  E_INDEX_BOUNDS: message(
    '数组下标越界',
    '当前读取或写入的下标超出了可访问的数组范围。',
    '核对本组输入和循环边界；长度为 n 时合法下标通常是 0 到 n−1。',
  ),
  E_DIV_ZERO: message(
    '除数为零',
    '除法或取余运算的右侧值在这一步变成了 0。',
    '检查除数的来源，运算前处理为 0 的情况。',
  ),
  E_INT_OVERFLOW: message(
    '整数运算超出范围',
    '本教学解释器使用有符号 32 位整数；这次运算的结果无法表示。',
    '检查操作数与运算顺序；不要依赖溢出后的数值。',
  ),
  E_INPUT_INVALID: message(
    '输入不符合要求',
    '本组输入的类型、数量或数值范围不符合约定。',
    '按本题输入说明修改输入。',
  ),
  E_INPUT_ORDER: message(
    '输入顺序不符合要求',
    '当前案例要求特定顺序，例如二分搜索需要有序数组。',
    '按案例要求整理输入后再运行。',
  ),
  E_BINDING_INVALID: message(
    '输入声明与本题约定不一致',
    '解释器无法把本组输入绑定到对应声明。',
    '保留受控输入声明的名称、类型、位置和初值。',
  ),
  E_CONTENT_MISMATCH: message(
    '题目与执行内容不一致',
    '本次请求的题目或内容版本未通过一致性检查。',
    '保留草稿，重新打开本题后重试。',
  ),
  E_PROTOCOL_VERSION: message(
    '执行接口版本不兼容',
    '页面与执行模块使用的版本不能配合，不能把结果当作有效运行。',
    '保留草稿，重新加载页面与模块后重试。',
  ),
  E_PROTOCOL_INVALID: message(
    '执行数据未通过校验',
    '请求或返回数据不符合接口约定；这不是已确认的源码语法错误。',
    '保留草稿并重试，持续出现时记录错误码。',
  ),
  E_TRACE_INVALID: message(
    '执行轨迹未通过校验',
    '返回的步骤无法被可靠恢复，因此不能继续播放或判为通过。',
    '重新运行；不要把当前无效轨迹当作执行结果。',
  ),
  E_SOURCE_LIMIT: message(
    '源码超过长度限制',
    '源码长度已达到当前教学环境的上限。',
    '缩短程序，拆分要观察的问题后重试。',
  ),
  E_REQUEST_LIMIT: message(
    '执行请求超过容量限制',
    '源码与输入等组成的完整请求过大。',
    '减少源码或输入规模后重试。',
  ),
  E_DEPTH_LIMIT: message(
    '语法嵌套超过限制',
    '括号、表达式或语句嵌套过深，解释器已安全停止。',
    '减少嵌套，分解表达式或控制结构。',
  ),
  E_FUEL_LIMIT: message(
    '解释执行工作量达到上限',
    '本次分析、执行或结果处理耗尽了有限计算预算；不等于已经证明有死循环。',
    '检查循环是否推进、是否能退出，并尝试更小的输入。',
  ),
  E_STEP_LIMIT: message(
    '执行步骤达到上限',
    '真实执行产生的教学步骤已达到限制。',
    '检查循环条件和更新，或缩小输入规模。',
  ),
  E_MEMORY_LIMIT: message(
    '虚拟内存达到上限',
    '程序要使用的教学对象存储超出配额，不是宿主真实内存地址。',
    '减少数组或动态对象数量，检查对象是否及时释放。',
  ),
  E_OUTPUT_LIMIT: message(
    '输出量达到上限',
    '本次程序输出过多，解释器停止继续输出。',
    '检查输出是否在反复循环中，减少输出次数。',
  ),
  E_RESULT_LIMIT: message(
    '执行结果达到容量上限',
    '轨迹和结果过大，不能继续生成或接收。',
    '减少输入规模与循环次数后重试。',
  ),
  E_DEADLINE: message(
    '本次处理超过时限',
    '从发起到接收结果的处理超过安全时限；这不能单独证明程序存在死循环。',
    '检查循环与输入规模，也可以保留原稿重试。',
  ),
  E_CANCELLED: message(
    '本次操作已取消',
    '这次操作没有作为成功执行继续接收。',
    '需要时重新运行；取消不会修改源码。',
  ),
  E_MODULE_LOAD: message(
    '执行模块加载失败',
    '运行环境尚未就绪，不能据此判断源码有语法错误。',
    '保留草稿，检查页面资源是否可用后重试。',
  ),
  E_WORKER_FAILURE: message(
    '执行工作线程未能完成',
    '浏览器中的执行线程出现故障。',
    '保留草稿并重试；持续出现时重新加载页面。',
  ),
  E_WASM_TRAP: message(
    '执行模块异常停止',
    '底层模块无法继续完成这次操作，不能把它归为正常结束。',
    '保留草稿并重试；持续出现时记录本例和错误码。',
  ),
  E_ENCODING_FAILURE: message(
    '执行数据编码失败',
    '执行结果不能被安全编码或传递。',
    '保留草稿，缩小程序后重试。',
  ),
  J_STDOUT_MISMATCH: message(
    '输出未符合本题预期',
    '程序可以正常结束，但实际输出与测试要求不同，空格和换行也参与比较。',
    '对照实际与预期输出，检查计算和格式。',
  ),
  J_EXIT_NONZERO: message(
    '返回值未符合本题要求',
    '本题要求程序正常返回 0。',
    '检查实际执行到的 return 语句。',
  ),
  J_TEACHING_TARGET: message(
    '尚未满足本题教学目标',
    '只有输出相同还不够；有限教学检查尚未确认要求的输入贡献或控制路径。',
    '按本题目标检查真实读取、计算和分支循环。',
  ),
  J_BINDING_MISMATCH: message(
    '教学判定的输入或节点映射不一致',
    '本题判定缺少一致的输入绑定或源码节点证据，不能默认通过。',
    '检查受控输入声明与积木同步状态后重试。',
  ),
} satisfies Record<DiagnosticCode, DiagnosticMessage>;

export const memoryMessages: Record<string, DiagnosticMessage> = {
  E_BOUNDS: diagnosticMessages.E_INDEX_BOUNDS,
  E_OVERFLOW: diagnosticMessages.E_INT_OVERFLOW,
  E_UNSUPPORTED_VERSION: diagnosticMessages.E_PROTOCOL_VERSION,
  E_ARGUMENTS: message(
    '函数实参不符合要求',
    '调用时提供的参数与函数声明不匹配。',
    '核对参数的数量和类型。',
  ),
  E_DUPLICATE: message(
    '名称重复声明',
    '当前作用域已有相同名称的声明。',
    '使用不同名称或检查重复声明。',
  ),
  E_UNDECLARED: message(
    '使用了未声明的名称',
    '当前位置找不到可见的对应声明。',
    '核对名称拼写及作用域。',
  ),
  E_INPUT_EXHAUSTED: message(
    '输入数据已用完',
    '程序继续读取时，本组已没有更多输入。',
    '核对读取次数和输入数量。',
  ),
  E_RETURN_MISSING: message(
    '函数缺少返回值',
    '函数执行结束时没有提供要求的返回值。',
    '检查每条可能执行的路径是否返回正确类型的值。',
  ),
  E_HEAP_LIMIT: message(
    '动态对象达到上限',
    '本次动态分配已经达到教学环境的配额。',
    '减少分配并检查对象释放路径。',
  ),
  E_OBJECT_LIMIT: message(
    '对象数量达到上限',
    '程序创建的对象数量达到教学环境的限制。',
    '减少对象数量和反复创建操作。',
  ),
  E_FIELD_LIMIT: message(
    '结构体字段达到上限',
    '结构体字段数量超过当前子集的限制。',
    '减少字段，使用本案例支持的结构。',
  ),
  E_STRUCT_LIMIT: message(
    '结构体定义达到上限',
    '结构体定义数量超过当前子集的限制。',
    '减少结构体定义。',
  ),
  E_FUNCTION_LIMIT: message(
    '函数数量达到上限',
    '函数定义数量超过当前子集的限制。',
    '减少函数定义，缩小观察程序。',
  ),
  E_PARAMETER_LIMIT: message(
    '函数参数达到上限',
    '参数数量超过当前子集的限制。',
    '减少函数参数数量。',
  ),
  E_NULL_POINTER: message(
    '访问了空指针',
    '空指针没有指向可访问的对象。',
    '先让指针指向存活对象，再解引用。',
  ),
  E_DANGLING_POINTER: message(
    '访问了已失效的对象',
    '指针指向的对象已经离开作用域或被释放。',
    '检查对象的生命期，不再通过旧指针访问它。',
  ),
  E_POINTER_BOUNDS: message(
    '指针超出可访问范围',
    '尾后位置可以作为边界，但不能解引用。',
    '核对指针偏移和对象范围。',
  ),
  E_INVALID_DELETE: message(
    '不能释放这个指针',
    '当前子集只能释放由单对象 new 获得的原始指针。',
    '核对分配来源，不释放局部变量或偏移后的指针。',
  ),
  E_DOUBLE_DELETE: message(
    '对象被重复释放',
    '同一对象已经释放，不能再次 delete。',
    '检查释放路径，避免重复释放。',
  ),
  E_STACK_LIMIT: message(
    '活动调用帧达到上限',
    '本环境最多允许 32 个同时活动的调用帧。',
    '检查递归终止条件，后退观察参数如何变化。',
  ),
};

const expectations: Record<string, string> = {
  'closing block comment delimiter': '注释缺少结束标记 */。',
  'closing string quote': '字符串缺少结束双引号。',
  'string without raw newline or NUL': '字符串中不能直接换行；输出换行请使用转义 \\n。',
  'escape: newline, backslash or quote': '当前只支持换行、反斜杠或双引号的转义。',
  'P0-C character': '这个字符不属于当前 C 教学子集支持的字符。',
  'statement semicolon': '这条语句之后需要分号 ;。',
  'semicolon after return value': 'return 返回值之后需要分号 ;。',
  'semicolon after jump': '跳转语句之后需要分号 ;。',
  'printf semicolon': 'printf 调用之后需要分号 ;。',
  'closing block brace': '当前代码块缺少右花括号 }。',
  'opening block brace': '这里需要用左花括号 { 开始代码块。',
  'condition closing parenthesis': '条件之后需要右括号 )。',
  'expression closing parenthesis': '表达式之后需要右括号 )。',
  'index closing bracket': '数组下标之后需要右方括号 ]。',
  'for initializer semicolon': 'for 初始化之后需要分号 ;。',
  'for condition semicolon': 'for 条件之后需要分号 ;。',
  'unique object name in this scope': '同一作用域内已经声明过这个名称。',
  'nonreserved ASCII object identifier': '对象名需要使用非保留的 ASCII 标识符。',
  'object declared and visible before this reference':
    '这个名称在当前位置尚未声明或已不在作用域内。',
  'positive fixed array length': '固定数组的声明长度必须为正数。',
  'initializer count within array capacity': '给出的数组初值数量超过了声明容量。',
};
export function diagnosticMessage(code: string, expected?: string | number): DiagnosticMessage {
  const base = Object.hasOwn(diagnosticMessages, code)
    ? diagnosticMessages[code as DiagnosticCode]
    : Object.hasOwn(memoryMessages, code)
      ? memoryMessages[code]
      : message(
          '本次操作未能完成',
          '这个错误码尚无专门的教学解释，以下仅展示收到的诊断。',
          '保留原稿，结合原始诊断检查或重试。',
        );
  const precise =
    typeof expected === 'string' && Object.hasOwn(expectations, expected)
      ? expectations[expected]
      : null;
  return precise ? { ...base, explanation: `${precise} ${base.explanation}` } : base;
}
