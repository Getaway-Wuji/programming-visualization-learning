import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';
const dir='.artifacts/16.8',json=p=>JSON.parse(readFileSync(p)),real=json(`${dir}/real-linked-nodes-summary.json`),visual=json(`${dir}/visual.json`),registration=json('content/c/p0/blockly-release-1.0.43.json');assert.equal(real.runs,23);assert.equal(real.uniqueCaseInputs,22);assert.equal(registration.files.length,283);
const save=(p,s)=>writeFileSync(p,s+'\n',{flag:'wx'}),max=k=>Math.max(...real.rows.map(r=>r[k]));
save('项目文档/交付/16.8-C++链表与BST使用说明.md',`# 16.8 C++链表与BST使用说明

2026-10-31；正式1.0.43。进入“算法与演示”中的单链表或二叉搜索树（BST）；路由/#/nodes/case.cpp.singly-linked-list和/#/nodes/case.cpp.binary-search-tree。源码为受支持C++子集的真实Rust内存执行，第21步通用语言学习闭环仍未完成。

两个案例最多同时存活7个业务Node；每行一条操作，空行忽略，整个空序列写[]。参数为−999～999的十进制整数，用ASCII正负号；最多1024字符和30个编码整数槽，不是30次任意操作。格式或槽数非法时禁跑且明确提示，不截断。参数域/格式由前端检查，容量、位置与重复判断交给实际C++。

单链表例子：

    插 0 7
    插 1 -3
    插 1 0
    遍历
    删 0
    遍历

插 位置 值编码[1,pos,value]占3槽，删 位置编码[2,pos]占2槽，遍历编码[3]占1槽。位置零起始，插入合法段[0,size]，删除[0,size)；允许重复值，按位置操作。先检查位置再容量，因此满时非法位置仍为RANGE；有效位置但满为FULL。实际成功输出INSERT v或DELETE v；遍历输出LIST加按next读取的各值。

BST例子：

    插 4
    插 2
    插 6
    查 2
    前序
    中序
    后序

插 值编码[1,v]、查 值编码[2,v]，各占2槽；前序/中序/后序为[3]/[4]/[5]各占1槽。严格小值在左、大值在右，重复拒绝。先查重再判满，满树旧值为DUP，新值为FULL。查找输出FOUND或MISS；三遍历输出PRE/IN/POST。这里只做插入、查找和三遍历，没有平衡树或交互式树删除。

点击运行C++节点操作，只有编码长度实例化到源码，真实cin读取原序列。业务拒绝继续后续命令，所有参数仍实际消费。正常处理末尾由真实delete清理剩余节点再输出END；程序正常结束不表示每条业务操作都成功。未知原始码会INVALID并return1，界面不会生成它；运行错误/限制显示实际停止前缀。

节点图的每条边来自当前对象中的真实next/left/right指针，main.head/root与递归同名形参按帧区分。新分配未连入、断链尚未释放的Node仍是存活节点；图和逐对象字段明确显示当前是否从主入口连通。size更新和指针发布是不同步骤，暂时不一致不补齐。new Node{}初始化为真实0/typed-null；未初始化槽、空指针、有效指针、悬空和尾后状态不同。墓碑只有ID/类型/地址，没有旧值。清理期间指针可暂时指向墓碑，但不作为有效连接或可读旧节点。

图形区域可横向滚动，首次有真实节点或改变屏宽时将根附近居中；后续单步保留用户横向位置。下方逐对象记录给出全部字段。教学用虚拟地址、对象大小和指针边界不是宿主地址或ABI。链表Node实际12教学字节，树Node20；最多7节点，偏斜树递归辅助链含空孩子最多8帧，加main共9活动帧，沿原32帧等限制。

节点连接、内存对象和调用栈共用同一MemoryPlayer及游标。选视图不重跑；内存可分页选择对象/值槽，栈显示当前帧在前及真实参数/局部。后退、前进、滑块、回到初态、查看末步完整恢复连接、生命期、帧/作用域、分配器、输出和计数。六速只改回放；聚焦观察区可用空格播放暂停、左右键单步，隐藏页面/观察区暂停。修改输入、切案例、重跑、清档或离页同步撤销旧运行，取消/失败/超时需显式重跑。当前输出与完整结果分开。

只作观察，不保存操作草稿/源码/轨迹为学习事实，不新增档案、积分、奖励或迁移。没有自动接入挑战、对比或快照。原七C、六C++排序、两个栈队列、两种对比及32节/40题172组/20块保持。

见[独立验收](../验收/16.8-C++链表与BST验收.md)、[界面复核](../验收/16.8-界面复核.md)、[交接](../交接/16.8-交接.md)。`);
save('项目文档/验收/16.8-界面复核.md',`# 16.8 界面复核

2026-10-31；Chrome156.0.8078.76/minimal，沿已采用framed-sheet/seed1060963509与原工作台，不重绘全站。两页1440/768/390以真实C++运行、真实滑块在完整轨迹中间位置准备；Inspector原probe/rules保持，仅适配节点选择器与实际滑块最大值。原gradient许可沿用，没有新增规则豁免。

最终两报告合计${visual.fail}FAIL/${visual.warn}WARN，已打开并查看两页三宽六份最终蒙太奇及首轮六张完整节点截图。初次Inspector也0/0，人工看图仍发现手机BST初始横向窗口未居中，补了纯滚动区居中，新增六宽根节点可见断言后复验，所有最终截图重新生成。移动图保留横向滚动，逐对象字段完整，不将大树缩成不可读文字；页面本身无横向溢出。长实际源码与轨迹通过原工作台纵向查看。

源UI lint扫描新七模块及App/Layout/CatalogPages共10文件，0FAIL/1WARN；WARN为CatalogPages原C课程顺序padStart(2,'0')，该既有编号保留，没有新增装饰编号。ESLint0错误/0警告，类型/格式通过。

节点身份/值/来源边界、有效连接、当前未连通节点、释放墓碑、实际输出/计数与源码UTF8范围均有浏览器断言。图/内存/栈共用同游标，栈按既有设计当前帧在前。首轮两测试误用root-first，失败截图/两份本地ZIP SHA及更正复验原件均保留，没有改旧StackPanel。

隐藏页覆盖原监听；若headless原生后台仍visible，则记录为隔离DOM visibility事件，不冒称自然后台覆盖，不注入播放器状态。未重跑六主题/全部明暗、物理DPI/人工缩放、触屏和读屏器矩阵。

见[验证原件](./16.8-验证原件/index.json)、[独立验收](./16.8-C++链表与BST验收.md)。`);
save('项目文档/验收/16.8-C++链表与BST验收.md',`# 16.8 C++链表与BST验收

2026-10-31，root唯一写入；16.8已验收，第16整块尚未完成，16.9未领取，第21步0/10。先按DEC-P1-024/NODE-CASE-01冻结2例、容量7、域−999..999、1024字符/30编码整数、位置及拒重优先规则。实际操作/错误/空间/复杂度见[使用说明](../交付/16.8-C++链表与BST使用说明.md)。

单链表按零起始位置插入/删除/遍历；BST插入、迭代查找及前中后序递归，拒绝重复。全部同一份显示C++原文由MemoryExecutionClient/Rust内存分支执行，真实new/delete/typed-pointer/Node字段、墓碑与自动对象生命期。前端只做语法编码和当前对象图布局，不维护第二份链表/BST或遍历答案；不以数组或静态边代替指针。图/MemoryPanel/StackPanel共享一个MemoryPlayer与游标。

正式1.0.43/283受审源，继承42的270源，加3内容文件、7节点模块、2内容/发布输入脚本及1契约；35—42和旧16.1—16.7原件保持。当前memory SHA${registration.memoryEngine.wasmSha256}，${registration.memoryEngine.wasmBytes}字节；EXEC1.3/STEP1.2/DIAG1.2/整数1.0。P0及算法分支的源/构建SHA也保持，没有协议、Rust或预算改动。

最终86单元/6套通过：新真实C++边界/故障25、真实结果控制器5、内存协议36、客户端10、内存视图4、调用栈6。每个原子步核真实Node字段/来源指针、对象生命期/堆上限；完整命令提交时按测试端独立列表/BST参考核顺序/结构、输出、size/outcome/消费；全量原子逆恢复、同游标往返成立。受控原始未知码真实INVALID/return1，无END；缺参数真实E_INPUT_EXHAUSTED、可逆前缀，GUI不制造它们。

候选45/45和正式45/45 Chrome唯一场景通过，0重试/跳过/失败，不累计重复批次为更多唯一场景。正式捕获23次边界执行原包，22种case/input组合（空序列与公开空样例是同一编码的两条UI采样路径，未冒称两个不同输入）。覆盖全部计划操作、空/单节点、头中尾、负/大位置、重复/拒重、未找到/删不到、容量7/第8拒绝、满时优先级、删除再分配、升/降偏斜、最大30槽、端点与三遍历；严格语法不分配Worker；取消/编辑/换案例/清档/离页/到期迟到及Worker失败重试、六速/键盘/隐藏、两页三宽、分配未发布/断链/释放/墓碑逆恢复、同游标三视图、目录/身份和旧路径回归齐备。

23个正式原包另离线独立解码，直接从原typed字段验证每次提交的链表顺序和BST左右连接、输出/输入消费、所有Node最终释放、自动对象死亡、无旧值墓碑与完整原子逆恢复；不是再次执行或前端重算操作。最多${max('steps')}步、结果${max('resultBytes')}字节、活动帧${max('maxFrames')}、活heap Node${max('maxHeap')}、活动教学字节${max('maxLiveBytes')}；链表12字节/Node、树20字节/Node。最大辅助递归链8加main=9，原32帧/组合深256不变。

正式观察最大post→response ${real.timingMax.postToResponseMs.toFixed(1)}ms、点击→Worker终止${real.timingMax.clickToTerminateMs.toFixed(1)}ms；含观察器复制，不含Playwright断言/离线解码，不是分别仪器测量的Rust耗时或完整设备性能矩阵。单组1000ms及原源码32KiB/请求64KiB/输入30/步20k/fuel1M/结果16MiB/输出16KiB/存活1MiB/heap128/累计对象4096/WASM128MiB等保持。

真实新分配未连入、断链未释放与size发布中间态不补齐；死Node没有当前值。清理时尚存父字段/局部指向墓碑按悬空展示，不画为有效边。虚拟地址与类型布局来自当前结果，非宿主地址/ABI。当前图形/输出/计数/源码/内存/帧在回退时全部恢复。

原生15store运行前后完整快照相等，没有新学习事件/档案/奖励/迁移。32节/40题172组/20块、七C、六C++排序、两个栈队列及两对比保持；新节点案例不接挑战/对比/快照。三宽Inspector${visual.fail}FAIL/${visual.warn}WARN；源UI lint0FAIL/1项原课程编号WARN已说明。类型/ESLint/格式、正式构建及自有dev/preview通过；启动记录实际浏览器/工具链。完整Rust507通过/1原忽略和引擎极限继承前置，仅SHA核对，未冒称本轮重跑。未重跑完整前端/Firefox/主题/11.4设备与首屏性能矩阵，DPI/人工缩放/触屏/读屏器/自然满盘断电未测；既有大包提示不抬阈值。

失败与修正：首25项4处漏算main，明确8辅助+main=9后25/25及86/86通过，没有放宽预算；首Chrome43/45的两栈顺序测试预期改为既有active-first，再全45通过，旧StackPanel不改。早期路由接入、未用测试变量、测试command map类型检查失败均有日志。内容setup最初缺search讲解、写manifest前工具失败，补入口后成功；该工具输出在本聊天，未伪造本地失败日志。两浏览器ZIP留本地SHA，所有失败/首轮/最终原件分开。

实际文件：content/algorithms/cpp的linked-nodes-1.0.0.json及两CPP；web/src/node-cases的content/controller/presentation/NodeGraph/NodeCaseCatalog/NodeCasePage/nodes.css；App/Layout/CatalogPages必要接入；scripts的linked-nodes-content/release-inputs/browser、register-linked-nodes及build-p05-course/restore-release-evidence；两新单元与linked-nodes浏览器套件；43登记/当前生成指纹、六独立文档与中央五资料。旧MemoryPanel/StackPanel、引擎/协议/学习存储和既有案例实现不改。

6138开工文件按归属SHA审计，无删除；完整新增/修改清单见原件。外窗CI交接SHA709c620f3300703138b4d1de0e96c2912a6091c3305319e87a5c8d3a6e6ec75c保持，不修CI。HEAD ec023619c4f49509360ead2365233b9c768b6df4/main，空暂存/待推送链0；无代理/新聊天/工作树/自动化/暂存/提交/推送/真实用户清档。

见[决议](../架构决策/16.8-C++链表与BST操作序列.md)、[契约](../契约/16.8-C++节点案例与真实指针投影.md)、[界面复核](./16.8-界面复核.md)、[43凭据](./发布凭据/16.8-1.0.43/index.json)、[验证原件](./16.8-验证原件/index.json)、[最终复核](./16.8-最终复核.json)和[交接](../交接/16.8-交接.md)。`);
save('项目文档/交接/16.8-交接.md',`# 16.8 交接

2026-10-31；root按协调唯一派发完成16.8后结束。16.9未领取，第16整块尚未完成，第21步0/10。

交付两个真实C++容量7节点案例：单链表零起始位置插/删/遍历，BST拒重插入/查找/前中后三遍历。严格逐行语法只编码，30输入整数槽/−999..999保持；位置/容量/重复/未找到均由C++裁决。实际new Node{}/delete、Node*字段/入口和类型布局来自当前memory Rust，而不是P1数组强转或前端重做算法。size与连接独立更新，待链接/断链未释放/墓碑/悬空保真，死Node无旧值。

独立NodeCaseController只持一个MemoryExecutionClient/MemoryPlayer与计时链；同游标图形、复用12.3内存/12.4栈，切视图不重跑。正常末尾实际清理，完整连接/生命期/帧/作用域/分配器/输出/计数/输入游标可逆。原七C、六CPP排序、两个栈队列、两对比和SAVE7/DB7/15store/32课40题172组20块不变，无新学习/奖励/迁移或节点挑战/对比/快照。

正式43/283源，86相关单元和45唯一正式Chrome，23正式真实原包（22种case/input）独立字段/结构与全原子逆恢复；两页三宽Inspector${visual.fail}FAIL/${visual.warn}WARN，源UI lint0FAIL/1项原课程编号WARN。类型/ESLint/格式/正式构建/自有dev与preview通过。三Rust/WASM与所有原协议/预算SHA保持，完整Rust和引擎极限继承前置，未重复声称新跑。帧口径为8辅助+main=9，不提高32帧预算。实际文件、失败与复验、未测细目见[独立验收](../验收/16.8-C++链表与BST验收.md)，入口和语法见[使用说明](../交付/16.8-C++链表与BST使用说明.md)。

下一窗口按守则/裁决/台账/第16任务包和12.1/12.4、最新16.4—16.8交接核对，再由协调唯一领取16.9：汉诺塔、辗转相除法、朴素素数判断和回文数，先固定数量/域/预算/真实C++路径，勿顺手扩展21或树其他类型。不能把本项7节点上限、布局投影或观察案例当作通用语言/容器能力。

6138开工文件和当前42的270源SHA、35—42及全部旧原件、外窗CI交接保持，无删除；完整归属与新原件清单见[验证原件](../验收/16.8-验证原件/index.json)，两首轮浏览器ZIP只留本地SHA。见[DEC-P1-024](../架构决策/16.8-C++链表与BST操作序列.md)/[NODE-CASE-01](../契约/16.8-C++节点案例与真实指针投影.md)、[43凭据](../验收/发布凭据/16.8-1.0.43/index.json)和[最终复核](../验收/16.8-最终复核.json)。

HEAD ec023619c4f49509360ead2365233b9c768b6df4/main，空暂存、待推送链0；无代理/新聊天/工作树/自动化/暂存/提交/推送/真实用户清档，不修CI。整块未完成不触发Git提交规则。当前原67/88、主路线67/98、P1 26/28、P0.5 9/9、第21步0/10。`);
const summary=`16.8真实C++单链表与BST已验收：各容量7，位置插删/遍历与拒重插入/查找/三遍历，真实Node*/new/delete、待链接/断链/墓碑及全原子回退；图形/原内存/栈同游标。正式1.0.43（283源），86相关单元、45唯一正式Chrome、23正式原包（22种case/input）独立结构/全逆复核；两页三宽Inspector${visual.fail}FAIL/${visual.warn}WARN，源UI lint0FAIL/1原编号WARN已说明，类型/格式/ESLint/正式构建/自有dev与preview通过。SAVE7/DB7/15store、32节40题172组20块、七C/六CPP排序/两栈队列/两对比、三Rust/WASM/协议和原预算保持；无新学习奖励/节点挑战/对比/快照。原67/88、主路线67/98、P1 26/28、P0.5 9/9、第21步0/10；16.9未领取，第16整块未完成。`;
for(const file of ['README.md','项目守则.md',...['需求覆盖与范围裁决','任务进度与交接','开发路线与依赖'].map(n=>`项目文档/${n}.md`)]){
 let text=readFileSync(file,'utf8');assert.ok(!text.includes('16.8当前验收（'));const prefix=file.startsWith('项目文档/')?'./':'项目文档/',ref=`见[独立验收](${prefix}验收/16.8-C++链表与BST验收.md)、[使用说明](${prefix}交付/16.8-C++链表与BST使用说明.md)、[交接](${prefix}交接/16.8-交接.md)、[43凭据](${prefix}验收/发布凭据/16.8-1.0.43/index.json)与[验证原件](${prefix}验收/16.8-验证原件/index.json)。`;
 const at=text.indexOf('\n');text=text.slice(0,at+1)+`\n16.8当前验收（2026-10-31）：${summary} ${ref}6138开工文件按归属保护、无删除，35—42及全部旧原件/外窗CI交接保持。不修CI、无Git写入/代理/新聊天/工作树/自动化/真实用户清档；HEAD ec023619，空暂存/待推送链0。下方旧时点记录保留历史含义。\n`+text.slice(at+1);text=text.replace('16.7当前验收（','16.7历史验收（');
 if(file==='项目守则.md')text=text.replace('当前原66/88、新增21为0/10分别记录，主路线66/98。','当前原67/88、新增21为0/10分别记录，主路线67/98。');
 if(file==='项目文档/任务进度与交接.md'){text=text.replace('16.8领取（2026-10-31）：','16.8领取（2026-10-31，现已结束）：').replace(/^(\| 16\.8 \|[^\n]*?)\| 进行中 \|[^\n]*$/m,'$1| 已验收 | root | 2026-10-31；正式43/283源，两例容量7真实C++节点；86单元/45唯一Chrome/23正式原包（22输入组合）与全逆，交接/原件齐备；下一16.9未领取 |');assert.match(text,/\| 16\.8 \|[^\n]+\| 已验收 \|/);}
 writeFileSync(file,text);
}
console.log(JSON.stringify({docs:6,central:5,next:'16.9 unclaimed',progress:{original:'67/88',main:'67/98',p1:'26/28',p05:'9/9',language21:'0/10'}}));
