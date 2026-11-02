# 基础 C 课程来源

`course-1.0.1.json` 保存原创基础课程及其稳定身份：3 章、6 小节、6 题、七个 C 案例、10 个知识点和 20 类积木映射。现行扩充课程复用这些身份，保护旧学习记录与奖励去重关系。

| 章节         | 小节 ID                   | 目标与必修题                                                                     | 案例/程序                                                                        |
| ------------ | ------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 变量与表达式 | lesson.c.variables-output | 变量声明、初始化、赋值、输出和块作用域；echo                                     | assignment；REF-01、07                                                           |
| 变量与表达式 | lesson.c.expressions      | 四则/余数、优先级、负数整除、比较/短路、溢出/除零；two-x-plus-three              | REF-02                                                                           |
| 条件与循环   | lesson.c.conditions       | 0/非0、if/else、零边界和复合条件；nonnegative                                    | branch；REF-03                                                                   |
| 条件与循环   | lesson.c.loops            | while/for 的初始化、判断、更新、零次执行、作用域及 break/continue；two-loop-sums | loops；REF-04                                                                    |
| 数组与综合   | lesson.c.array-update     | 固定容量、0基下标、部分初始化、未初始化/越界、逻辑长度；increment-at-index       | REF-05                                                                           |
| 数组与综合   | lesson.c.array-sum        | 遍历和累加、空输入、结果/轨迹复盘及算法前提；array-sum                           | array-traversal、bubble-sort、selection-sort、binary-search-first；REF-06、08—10 |

## 来源和路径约定

课程讲解和案例说明由项目独立编写。教学来源的 `document` 使用仓库根相对路径，`locator` 使用下方稳定小节或案例 ID。

历史程序元数据仍保留原有引用 `../架构决策/01.3-正反样例清单.md`；读取器将它明确映射到 [参考程序](../../../shared/fixtures/reference-programs.md) 中的 REF-01 至 REF-10。机器协议和固定输入见 [shared/contracts](../../../shared/contracts/README.md)。

### 六节内容定位

`lesson.c.variables-output`：main 作为入口，int 变量像带名字的盒子；先存值再读，printf 的 `%d` 与换行对应真实输出；内层同名变量具有独立作用域。

`lesson.c.expressions`：先算乘除余、再算加减，括号改变次序；整数除法向零截断；比较/逻辑结果为 0/1，短路能跳过危险右侧。故意除零/溢出示例明确标为错误演示。

`lesson.c.conditions`：条件为零走假路，其余整数走真路，0 属于非负；`if/else` 两路均由题目测试覆盖，不能用数学式连锁比较表达区间。

`lesson.c.loops`：对照 while/for 的真实累加与两行输出；n=0 两个循环均不迭代，n=30 都输出465。补充示例逐项说明 continue 和 break 对本轮/循环的作用。

`lesson.c.array-update`：数组容量为正整数常量；部分常量列表未列出的项补0，完全未初始化的数组不能读取。逻辑 n 与占位容量分开，指定项加一还必须保持其余元素。

`lesson.c.array-sum`：下标区间 `[0,n)` 与累加保持对应，空输入不读取占位单元；排序与搜索沿用以下案例规则。

### 七案例定位

- `case.c.assignment`：默认 x=3，加2后输出5，观察真实写入与输出。
- `case.c.branch`：默认 x=-3 输出0；正/零/负输入检验两路。
- `case.c.loops`：默认 n=5，while/for 分别输出15；零次边界输出两行0。
- `case.c.array-traversal`：默认 `[3,-1,2]`，累计3、2、4，输出4；空输入输出0。
- `case.c.bubble-sort`：默认 `[3,1,2]` 输出 `1 2 3`；相邻严格大于才交换、每轮缩短尾部、无提前退出优化。
- `case.c.selection-sort`：同一默认数组；严格更小才更新最小下标，只在不同下标时交换，不承诺稳定排序。
- `case.c.binary-search-first`：默认 `[-2,0,0,4,8]` 查0输出1；输入必须非递减，命中继续向左，返回首次0基下标，空/未找到输出-1。

## 校验

`tests/unit/course-content.test.ts` 及 `engine/core/tests/course_content_acceptance.rs` 使用实际 Rust 解释器检查课程代码、正常与错误示例、输出、状态和轨迹。配置检查与真实运行验证分别执行；配置合法不等于任意用户解答正确。
