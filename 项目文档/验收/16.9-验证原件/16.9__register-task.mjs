import fs from'node:fs';import assert from'node:assert/strict';
const save=(p,s)=>fs.writeFileSync(p,s+'\n',{flag:'wx'});
save('项目文档/架构决策/16.9-C++四经典问题与输入边界.md',`# DEC-P1-026 · C++四经典问题与输入边界

2026-10-31；root唯一负责16.9，开工先冻结。前置12.1/12.4及必要12.2/12.3、16.4—16.8交接已核，沿实际内存超集EXEC1.3/STEP1.2/DIAG1.2；不把12.4固定观察入口冒充新正式目录。

固定4个原创C++ case/program@1.0.0：case.cpp.hanoi、case.cpp.euclidean-gcd、case.cpp.trial-division-prime、case.cpp.palindrome-number，包catalog.cpp.classics@1.0.0。每例恰定长输入，无操作编码/隐藏头/源码替换。输入为有符号十进制整数，以空白或英文/中文逗号分隔，恰1或2项；草稿≤128字符，−0归0；空/缺/多参数、非十进制、越域禁跑，不截断。

汉诺塔恰1盘数0～5，默认3。0盘合法，0次移动。递归n−1/移动当前盘/n−1，柱号0/1/2，移动盘号1～n。真实positions[5]记录盘索引→柱号，moveState[4]分别移动计数/当前from/to/盘索引；两个数组以受支持的int[]别名传递，不复制，不使用引用或全局变量。positions写入与计数更新、候选from/to等是独立原子步骤，不提前补齐。图形只按当前数组安放盘，大小/排列是静态布局，不在前端计算移动序列。最多31移动、最多6辅助递归帧含0盘调用，加main最多7帧；原32帧上限不变。输出每次MOVE 盘号 from to，最后MOVES 次数。

GCD恰2整数−999..999，默认84 -30。先分别取绝对值，再while b!=0计算余数并更新a/b；负数输入输出非负结果。单零结果为另一数绝对值；本教学例明确gcd(0,0)=0约定，不冒称唯一数学定义。绝对值最大999，不触及INT_MIN取负。输出GCD 值。

朴素素数判断恰1整数−999..999，默认97。负数/0/1判非素数；从2逐整数尝试因子，条件d<=n/d，首次整除停止；不是筛法，不跳过任意候选。避免d*d溢出，d始终至少2，分母非0。源码divisor为发现的因子或0（尚未发现），isPrime为实际结果。输出PRIME 0或1。

回文数恰1整数−999..999，默认121。负数直接否，不去掉负号；0及个位是回文，尾零正数除0外否。非负数逐次取末位、完整十进制反转、与原数比较；最多3位，reversed及中间乘加≤999，int32溢出由输入域排除，不假称支持任意int32。输出PALINDROME 0或1。

四例实际源码自带对应DOMAIN检查，正常return0不等于prime/palindrome判断为真；受控汉诺塔越域输出DOMAIN/return1，缺参有真实E_INPUT_EXHAUSTED前缀。GUI不发送非法输入。三数值例原wire也限制±999；额外原始输入的未消费不作为GUI支持，界面严格定长。

统一使用MemoryExecutionClient/MemoryPlayer，复用原MemoryPanel和StackPanel，同一cursor与原源码UTF8范围；不把AlgorithmState强转为MemoryState。当前受信memory WASM SHA4f3cb075dc0b7da3a0afc9dd96f178b6a1b71184f125c726ddf0b81384f6b3a7，466663字节。原源码32KiB/请求64KiB/输入30/AST64/帧32/组合深256/函数32/参数8/步20k/fuel1M/活1MiB/输出16KiB/结果16MiB/总1000ms/WASM128MiB和全局单Worker保持；不改Rust/协议。

新web/src/classics七模块、5内容文件、必要App/Layout/CatalogPages、44+发布与当前生成指纹、专项验证、中央五资料和独立六文档及新增算法目录覆盖表由root独占。覆盖表逐项列原SRS22算法与当前稳定ID/证据，区分已验17项（本项验收后）/后续18.4/18.5的5项，另列四C语法演示，不重写历史验收。旧七C、六CPP排序、两栈队列、两节点、两对比、12.4观察及成就归属保持；SAVE7/DB7/15store、课程/奖励不改，新四例无学习事实、挑战/对比/快照。

6567开工文件/43的283受审源SHA留档；35—43、全部旧原件及外窗CI交接保护。不修CI、不派代理、不建聊天/工作树/自动化，不暂存/提交/推送，只16.9，不进入16.10/21。见[契约](../契约/16.9-C++经典案例与汉诺塔存储.md)与[16.8交接](../交接/16.8-交接.md)。`);
save('项目文档/契约/16.9-C++经典案例与汉诺塔存储.md',`# CLASSIC-CASE-01 1.0.0 · C++经典案例与汉诺塔存储

2026-10-31；root；[DEC-P1-026](../架构决策/16.9-C++四经典问题与输入边界.md)。目录schema1.0.0/catalog.cpp.classics@1.0.0，4例case.cpp.hanoi/euclidean-gcd/trial-division-prime/palindrome-number与相应program均1.0.0；元数据有cpp、标题/目标/知识/原创来源、inputArity/min/max/defaultInput、实际CPP、算法/空间/边界、源码阶段。汉诺塔max5/min0/arity1，GCD±999/arity2，其余±999/arity1。

输入准备只严格语法/域/定长检查和复制，≤128字符；有符号十进制、空白/中英逗号分隔，−0为0；不模拟任何算法，不生成答案/移动/递归，不在源码嵌入输入或换成C。准备后source与显示/复制原文完全相同，无模板替换。request沿MemoryExecutionClient显式cpp/engine.rust.memory、EXEC1.3/STEP1.2/DIAG1.2/整数1.0，受信构建、身份/原文/字节范围/封闭结果校验全部保持。

汉诺塔main的positions[5]和moveState[4]为真实int数组。positions[i]是第i+1大小盘当前柱号，只有main.n个盘有效，其余槽是实际存储但不画成盘。0盘图为空。moveState索引0为已计移动数，1/2/3为源码当前from/to/盘索引；独立赋值中可能尚未匹配当前位置，不伪造已完成移动箭头或提前加计数。图只接当前MemoryState/types/本步delta和静态盘大小规则，不接原始输入或求解函数。静态按盘大小安放每柱，来源是当前positions值，不是第二份游戏状态。

main变量/数组从该真实帧的活对象读取，未初始化null与数0分开，死对象不显示旧值；从终态后退恢复。GCD/素数/回文只展示真实标量、输出、计数及源步骤，不由前端重新求值。素数divisor=0只表示源码尚未发现因子；结果0是非素数/非回文，不是运行错误。所有教学地址来自真实baseAddress/types，非宿主地址。

唯一ClassicController拥有一个MemoryExecutionClient/MemoryPlayer与可取消计时链。输入/案例/新运行/清档/卸载同步invalidate，晚到成功不能复活；取消/截止/模块/结果错误沿原客户端语义。六速、前后退/滑块/重播只消费delta；图形/原内存/栈同state/cursor，选调用者不seek。返回步当前活动帧是调用者、源码是实际return，StackPanel的active-first顺序和返回提示保持。完整恢复自动对象/墓碑、别名、帧/作用域、allocator、输出、计数和inputCursor。

正常输出MOVE/MOVES、GCD、PRIME、PALINDROME均为真实cout；DOMAIN/非零返回/运行错误或限制前缀分别显示，不冒称自然路径成功。源代码只读，未接入挑战/对比/快照，不产生课程/积分/成就事件，无新档案/迁移。

验收：汉诺塔n0..5全部真实执行，移动数/合法盘序、每次实际位置改变、同一对象别名及递归/返回/全原子逆恢复；GCD单/双零、符号、等值、互质与域端；素数负/0/1/2、平方合数与有限大质/合数；回文负/0/个位/尾零/对称/非对称/端点。非法空/多参/小数/指数/越域不创建Worker。原始缺参/汉诺塔域错误受控真实诊断。四例源码/语言/身份/受信SHA、高亮/当前状态及多视图、取消/失效/超时/晚到/旧路径/15store无副作用；Chrome/minimal三宽与算法覆盖表逐项可核对。`);
const p='项目文档/任务进度与交接.md';let t=fs.readFileSync(p,'utf8');assert.match(t,/\| 16\.9 \|[^\n]+\| 未开始 \|/);const at=t.indexOf('\n');t=t.slice(0,at+1)+`\n16.9领取（2026-10-31）：root按协调唯一派发，仅16.9，不进16.10/21。守则→裁决→台账→任务包及12.1/12.4、必要12.2/12.3和16.4—16.8交接已核。6567文件/43的283源SHA基线见.artifacts/16.9/baseline.json。先冻结[DEC-P1-026](./架构决策/16.9-C++四经典问题与输入边界.md)/[CLASSIC-CASE-01](./契约/16.9-C++经典案例与汉诺塔存储.md)：四例、汉诺塔0..5真实位置数组/GCD±999双零约定0/素数低于2否/回文负否且最多三位反转，定长输入≤2；原memory协议/预算。root独占新classics七模块/5内容文件、必要三共享入口、44+发布/生成指纹、专项验证、中央五资料/独立交接/算法目录覆盖表；旧案例/观察/成就/三引擎/学习/SAVE保持。35—43/旧原件/外窗CI保护，不修CI，无代理/新聊天/工作树/自动化/暂存/提交/推送；HEAD ec023619，空暂存/待推送链0。\n`+t.slice(at+1);t=t.replace(/^(\| 16\.9 \|[^\n]*?)\| 未开始 \|[^\n]*$/m,'$1| 进行中 | root | 2026-10-31唯一领取；6567文件/283源基线；DEC-P1-026/CLASSIC-CASE-01先冻结，四经典例/原预算/真实memory C++与同游标栈；仅本项 |');fs.writeFileSync(p,t);console.log('16.9 scope and ownership registered.');
