import fs from'node:fs';import assert from'node:assert/strict';
const save=(p,s)=>fs.writeFileSync(p,s+'\n',{flag:'wx'});
save('项目文档/架构决策/16.8-C++链表与BST操作序列.md',`# DEC-P1-024 · C++链表与BST操作序列

2026-10-31；root按协调唯一派发，只16.8，先冻结范围。前置12.1/12.2/12.3及必要12.4已验收，按当前实际EXEC1.3/STEP1.2/DIAG1.2内存分支，不沿用旧交接的过期构建SHA。

固定2例：单链表遍历/位置插入/位置删除；二叉搜索树插入/查找/前中后三种遍历。不加其他树类型、平衡/删除树节点、泛型容器或其他语言。case/program均1.0.0，新包catalog.cpp.linked-nodes@1.0.0，实际同源C++，new Node{}和delete均由Rust执行。每例最多同时存活7个业务Node；列表Node为int value/Node* next（12教学字节），BST为int value/Node* left/right（20字节），从types实际确认，不是宿主ABI。

逐行中文操作，空行忽略，[]为整个空序列，空白无效。草稿≤1024字符，所有参数为−999..999十进制整数，原输入向量≤30整数，不加隐藏头。链表：插 位置 值→[1,pos,value]，删 位置→[2,pos]，遍历→[3]；位置零起始，合法插入[0,size]，删除[0,size)。重复值允许，按位置操作，不按值猜匹配。位置格式/域只由前端校验；负位置/大于当前size的业务RANGE由真实CPP判断。插入先检查位置，再判断容量。

BST：插 值→[1,value]，查 值→[2,value]，前序→[3]，中序→[4]，后序→[5]。重复值拒绝，先真实查重再判断满；满树已有值返回DUP，满树新值返回FULL。BST按严格小/大链接；插入与三遍历/释放采用已支持递归，查找迭代。最多7节点偏斜，最长活动递归链含空孩子≤8帧，仍受32帧/组合深256/原燃料等限制，不提高预算。

业务结果真实cout：INSERT v/DELETE v/FULL v/RANGE pos/DUP v/FOUND v/MISS v每行；链表遍历LIST后按链输出空格加值再换行；树为PRE/IN/POST同式。最后清理真实heap并输出END。outcome标量0处理中、1插入、2删除、3遍历、4满、5位置非法、6重复、7找到、8未找到、9未知内部码。业务拒绝继续下一条，参数仍实际消费；未知原始码INVALID并return1，不假称正常清理。缺参数为真实E_INPUT_EXHAUSTED前缀。GUI编码不会制造未知码。

主程序真实size/processed/consumed与指针链接分属不同原子步骤；不得提前使size与可达数相等。新分配未链接、断链后未释放、释放后墓碑及清理过程中的悬空局部/字段均按当前状态展示。只从存活对象读取值，死亡对象不展示旧数据。new Node{}的默认0/typed-null来自zeroInitialized/types，不把未初始化null当nullptr。main结束自动对象死亡，heap由delete结束；所有变化完全可逆。

前端图布局只根据同游标Node对象及实际指针边/入口定位，允许受界限的连通性/层级布局，不模拟插删、BST查找、排序或三遍历，不产生遍历答案。每个实际指针保留对象ID/偏移/来源边界/类型及空/悬空/尾后/未初始化状态。教学虚拟地址不是宿主地址。新增工作区只持一个MemoryExecutionClient/MemoryPlayer，复用12.3 MemoryPanel和12.4 StackPanel，同游标切图形/内存/栈不重跑。

当前受信memory WASM SHA4f3cb075dc0b7da3a0afc9dd96f178b6a1b71184f125c726ddf0b81384f6b3a7，466663字节，执行前重新核对。原源码32KiB/请求64KiB/输入30/AST64/帧32/组合深256/函数32/参数8/步20k/fuel1M/存活1MiB/heap128/累计对象4096/输出16KiB/结果16MiB/单组1000ms/WASM128MiB保持，全局单Worker槽。

新node-cases模块与3内容文件，必要App/Layout/CatalogPages、后继43+发布和当前生成指纹、专项验证、中央五资料及本项独立文档由root唯一维护。旧七C/六C++排序/两个栈队列/两对比、三引擎/协议/预算/SAVE7/DB7/15store/课程奖励不改，不接挑战/对比/快照。6138开工文件与当前42的270受审源SHA留档，35—42及16.1—16.7原件和外窗CI交接保护。不修CI，不派代理，不建新聊天/工作树/自动化，不暂存/提交/推送；只16.8，16.9/21未领取。

见[操作契约](../契约/16.8-C++节点案例与真实指针投影.md)、[前置12.2](../契约/12.2-内存执行与可逆对象.md)与[16.7交接](../交接/16.7-交接.md)。`);
save('项目文档/契约/16.8-C++节点案例与真实指针投影.md',`# NODE-CASE-01 1.0.0 · C++节点案例与真实指针投影

2026-10-31；root；[DEC-P1-024](../架构决策/16.8-C++链表与BST操作序列.md)。新目录schema1.0.0、catalog.cpp.linked-nodes@1.0.0，case.cpp.singly-linked-list / case.cpp.binary-search-tree与相应program.cpp.*均1.0.0。每例真实CPP、语言cpp、容量7、域−999..999、目标/空间/复杂度/知识/原创来源、默认逐行操作、UTF8阶段及边界样例。

输入编码1.0.0固定：list插pos v=[1,pos,v]/删pos=[2,pos]/遍历=[3]；BST插v=[1,v]/查v=[2,v]/前序=[3]/中序=[4]/后序=[5]。忽略空行，[]整个空序列；最多1024字符和30编码整数，−0规范为0。前端仅严格语法/域/槽数检查并原顺序编码，不能检查当前容量/位置/重复/查找答案，不能隐藏长度头；源码只将唯一{{n}}替换为编码长度，cin实际消费。

采用MemoryExecutionClient/MemoryPlayer与EXEC1.3.0/STEP1.2.0/DIAG1.2.0/整数1.0.0、engine.rust.memory@0.1.0及当前受信WASM；不用AlgorithmState强转。types/objects/alive/storage/zeroInitialized/cells/typed-pointer/frames/scopes/control/allocator/counters全部沿原内存契约，nodeMap保持同一源码原文UTF8范围，所有事件及检查点由原封闭消费者验证。

图形投影只接收已验证的当前MemoryState、types、本步delta和静态案例布局；不接操作序列、不执行C++、不重算插删/查找/遍历。主main帧活head/root对象为入口，不把递归同名形参当主入口；实际存活heap Node连线来自next/left/right原槽。按实际边做有界层级/连通布局只为可读，不冒称业务操作或遍历答案。所有存活但当前不从入口连通的Node明确保留，不误当已释放。死Node仅墓碑ID/类型/地址，无旧value/连接。

null未初始化值与typed-null不同；空/有效/悬空/尾后/目标不存在分别标明，并保留objectId/byteOffset/lowerBound/upperBound/pointeeType。引用死亡墓碑不等于可解引用；图中不能把悬空边画成有效连接。虚拟基址/偏移按types投影，不展示宿主指针。计数只读真实counters，同值写无cell差异仍可计写；size与连接发布独立，当前数量不人为补齐。

outcome与输出只读当前真实状态，业务拒绝与正常程序结束分开；正常清理后END，未知原始码return1和真实运行错误/限制不假称成功。每条完整命令processed递增，consumed更新与cin游标各有自身原子步骤。main自动对象及heap墓碑、连接、调用帧/作用域、allocator、计数、输入游标和输出全可逆。

唯一controller拥有一个client/player和一个可取消计时链；新运行/草稿/案例/清档/卸载同步失效，旧成功晚到不能复活。取消/截止/模块失败按原客户端拒绝；六速/暂停/前后退/重播/滑块只消费轨迹。图形/12.3内存/12.4栈是同state/cursor，切换不重跑/不另建播放器。源码只读，无持久化/新学习事件/奖励/迁移/挑战/对比/快照。

验收：两个案例计划操作、空/单节点、链表头中尾/位置非法/删除空、重复值、BST重复拒绝/找到未找到/三遍历、7节点/第8节点拒绝、正反序偏斜及30槽、端点和语法失败。真实Node分配、入口/前驱/左右边更新、断链/删除及墓碑、递归帧/遍历输出可逐步核对；每原子状态和全逆恢复、同游标多视图、取消/超时/失败/迟到/跨页失效/旧路径无学习副作用。Chrome/minimal与1440/768/390，原预算/受信SHA和全部历史原件保持。`);
const p='项目文档/任务进度与交接.md';let s=fs.readFileSync(p,'utf8');assert.match(s,/\| 16\.8 \|[^\n]+\| 未开始 \|/);const at=s.indexOf('\n');s=s.slice(0,at+1)+`\n16.8领取（2026-10-31）：root按协调唯一派发，仅16.8，不进16.9/21。守则→裁决→台账→任务包及12.1/12.2/12.3、必要12.4与16.7前置已核。6138文件和42的270受审源含生成SHA基线见.artifacts/16.8/baseline.json，HEAD ec023619/空暂存/待推送链0。先冻结[DEC-P1-024](./架构决策/16.8-C++链表与BST操作序列.md)/[NODE-CASE-01](./契约/16.8-C++节点案例与真实指针投影.md)：两例/容量7，位置链表与拒重BST/查找/三遍历，原30整数输入槽/真实内存分支与预算。root独占新node-cases/3内容文件、必要App/Layout/CatalogPages/43+发布及生成指纹、专项验证/中央五资料/独立交接；复用既有MemoryPanel/StackPanel，不改引擎/协议/学习/SAVE7与旧案例。35—42、旧原件和外窗CI交接保护。不修CI，无代理/新聊天/工作树/自动化/暂存/提交/推送。\n`+s.slice(at+1);s=s.replace(/^(\| 16\.8 \|[^\n]*?)\| 未开始 \|[^\n]*$/m,'$1| 进行中 | root | 2026-10-31唯一领取；6138文件/270源SHA；DEC-P1-024/NODE-CASE-01先冻结，两例容量7、30输入槽，真实memory C++及同游标面板；仅本项 |');fs.writeFileSync(p,s);console.log('16.8 registered and two scope documents frozen.');
