import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const dir='.artifacts/16.9',json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
for(const name of ['r169-formal44','r169-real-summary','r169-startup-final'])assert.equal(Number(readFileSync(`${dir}/${name}.exit`,'utf8').trim()),0,name);
const real=json(`${dir}/real-classics-summary.json`);assert.equal(real.runs,29);assert.equal(real.uniqueCaseInputs,29);
const report=json(`${dir}/r169-formal44.json`);assert.equal(report.stats.expected,60);assert.equal(report.stats.unexpected+report.stats.skipped+report.stats.flaky,0);
const startup=json(`${dir}/startup-formal44.json`);assert.equal(startup.ownedProcessesStopped,true);assert.equal(startup.userPreviewPort4173Untouched,true);
const write=(path,text)=>{assert.equal(existsSync(path),false,path);writeFileSync(path,text+'\n',{flag:'wx'});};
write('项目文档/交付/16.9-C++经典问题使用说明.md',`# 16.9 C++经典问题使用说明

2026-10-31；本批四个正式观察案例位于“案例”目录的C++经典问题区。显示、复制和实际执行均为同一份原创C++源码，使用已验收Rust内存分支；不是前端算法动画。包catalog.cpp.classics@1.0.0，四个case及对应program均1.0.0。

| 案例与入口 | 输入与约定 | 算法与空间 |
|---|---|---|
| 汉诺塔，/#/classics/case.cpp.hanoi | 恰1个0～5整数；默认3；0盘合法0次移动 | n−1/当前盘/n−1递归，2^n−1移动；时间O(2^n)、递归O(n)。真实positions[5]+moveState[4]共36教学字节，另有参数/局部；最多6辅助帧含0盘调用，加main共7帧 |
| GCD，/#/classics/case.cpp.euclidean-gcd | 恰2个−999～999整数；默认84 -30；取绝对值，单零为另一数绝对值；本教学例约定gcd(0,0)=0 | 迭代辗转相除，O(log max绝对值)循环、常数辅助空间；域避免INT_MIN取负 |
| 朴素素数判断，/#/classics/case.cpp.trial-division-prime | 恰1个−999～999整数；默认97；负数/0/1否、2真 | 从2逐整数试除至d<=n/d，首次因子停止；O(sqrt(n))、常数辅助空间，不是筛法；除法条件避免d*d溢出 |
| 回文数，/#/classics/case.cpp.palindrome-number | 恰1个−999～999整数；默认121；负数否、0/个位真、其他尾零正数否 | 完整十进制反转比较，O(位数)、常数辅助空间；最多三位且全部反转中间值≤999，不能用于任意int32 |

复杂度为算法逻辑，不含轨迹生成、编码、校验和回放。输入草稿最多128字符，接受有符号十进制及空白/中英逗号分隔，−0归0；不接受空、缺/多参数、方括号、小数、指数、十六进制或越域。非法输入先提示，不创建Worker，不偷偷截断或加隐藏长度头。恢复示例或选边界样例会使旧运行失效。

点击“运行C++经典案例”后，可前后单步、滑动、回到首尾、重播或六档调速。代码高亮和讲解对应当前真实原子步。数值与过程、原内存和调用栈共享同一状态/游标；查看调用者不会跳步或重新运行。键盘焦点在工作台时可用既有控制快捷键，页面隐藏暂停。输入改变、换案例、取消、清除和离页均使旧结果失效，迟到结果不能恢复旧画面。

汉诺塔柱号0/1/2；positions[i]是大小i+1的盘所在柱。只画实际n个盘，剩余真实数组槽仍可查看；0盘为空图。moveState依次为移动计数/from/to/盘索引。候选字段、positions改变、加次数与cout都是独立步骤，位置已变而计数/输出尚未更新是合法原子中间态。图只按当前真实positions安放盘，不生成移动序列。变量尚未初始化时显示未知，不能补0；main返回后对象死亡不显示旧值，后退才恢复。

GCD显示实际a/b/余数；素数divisor=0表示尚未发现因子；回文显示实际remaining/digit/reversed。PRIME 0与PALINDROME 0均是正常分类结果，不是执行失败。当前输出与完整运行输出分开，MOVE/MOVES、GCD、PRIME、PALINDROME来自真实cout。源码自身保留DOMAIN/return1保护，GUI只发送合法输入；诊断/资源限制按真实前缀呈现。

这是有限教学子集与固定案例，源码只读，不开放通用C++编辑，不接入新挑战、对比、快照或学习奖励。原12.4递归观察入口及成就归属保持。学习档案仍为浏览器本地SAVE7/DB7/15store；执行位置与“无传输”须按既有架构说明分别理解。虚拟地址是教学地址，不是宿主地址或真实ABI。

见[输入决议](../架构决策/16.9-C++四经典问题与输入边界.md)、[存储契约](../契约/16.9-C++经典案例与汉诺塔存储.md)、[验收](../验收/16.9-C++经典问题验收.md)与[算法目录覆盖表](../算法目录覆盖表.md)。`);
write('项目文档/验收/16.9-C++经典问题验收.md',`# 16.9 C++经典问题验收

2026-10-31，root按协调唯一派发完成16.9。四例数量、语法、域与预算在产品实现前由DEC-P1-026/CLASSIC-CASE-01冻结。本项已验收，16.10未领取、第16整块尚未完成，第21步0/10。定义和使用边界见[使用说明](../交付/16.9-C++经典问题使用说明.md)。

正式1.0.44，298受审源：继承43的283源，加5个经典内容文件、7个classics模块、2个内容/发布输入脚本及1契约。四份C++源码原文直接执行，没有输入嵌入或C源码替换。MemoryExecutionClient/MemoryPlayer真实memory分支，EXEC1.3/STEP1.2/DIAG1.2/整数1.0；memory WASM SHA4f3cb075dc0b7da3a0afc9dd96f178b6a1b71184f125c726ddf0b81384f6b3a7、466663字节。P0/Algorithm/Memory三Rust源与构建SHA、原协议和预算保持。

105/105相关单元、6套通过：新经典44（40正常执行+4受控原始故障）、真实结果控制器5、内存协议36、客户端10、内存视图4、调用栈6。候选60/60及正式60/60 Chrome均0失败/跳过/重试，按60个唯一场景计数，不累加重复批次。29种正常case/input：汉诺塔0..5共6，GCD7、素数8、回文8；独立数值参考仅在测试端，产品前端不求解。严格域/定长语法不分配Worker，−0归一；原始缺参E_INPUT_EXHAUSTED可逆前缀和汉诺塔越域DOMAIN/return1有真实证据。

正式29原包另独立离线解码，不再次执行程序：汉诺塔核每次真实positions改变、合法盘序、2^n−1最少移动、最后全到柱2、moveState与输出、同数组对象别名；GCD枚举公因子、素数枚举因子、回文字符串反转作测试参考。全部对象最终死亡且cell清空、帧/作用域清空、live bytes0、输入游标等于定长；每个原子delta完整逆恢复初态。最大637步、结果665093字节、活动帧7、活动教学字节136，无heap分配。帧口径为6辅助含0盘调用+main，不提高原32帧/组合深256。

汉诺塔声明未初始化→实际初始化→位置先于次数/输出→返回后对象死亡及全逆恢复均由正式UI与原始字段核对；空盘不补图，null不补0，剩余容量不冒称真实盘数。数值/原内存/调用栈同游标、选调用者不seek、源码UTF8字节高亮与讲解随真实步骤。六速、键盘、隐藏暂停、Worker失败后重试和真实结果延迟到达下的编辑/换例/取消/清除/离页/截止失效全部覆盖，结果持有只延迟真实原包而不伪造。

正式观察最大post→response ${real.timingMax.postToResponseMs.toFixed(1)}ms、点击→Worker终止${real.timingMax.clickToTerminateMs.toFixed(1)}ms，包含观察器复制，不含Playwright断言与离线解码；不是分别仪器测得的Rust耗时或完整设备性能矩阵。原单运行1000ms与源码32KiB/请求64KiB/输入30/AST64/帧32/组合深256/函数32/参数8/步20k/fuel1M/存活1MiB/heap128/累计对象4096/输出16KiB/结果16MiB/WASM128MiB保持。

原七C、六CPP排序、两栈队列、两节点、两对比、12.4观察和15store运行前后完整快照相等；32节40题172组20块、SAVE7/DB7、学习奖励与迁移不改，无新经典挑战/对比/快照。算法覆盖表逐项登记原22算法：17已验、5项留18.4/18.5；四C语法演示另列，合计21正式案例（七C/十四CPP），不以占位冒称已交付。

四页各1440/768/390三宽Inspector均0FAIL/0WARN，全部12张最终整页评审图已查看。10文件源UI lint0FAIL/1WARN为共享CatalogPages原课程编号padStart；保留真实编号用途，没有新增装饰编号。类型、ESLint、格式、正式构建及自有dev/preview启动通过并停止自有进程；不操作用户5173/4173服务。既有大包提示保留，不提高阈值。

失败与修正：首新44中5个汉诺塔用例捕获声明后初始化前的null位置被误判非法柱号，改为layoutReady与非法非null分开，未初始化不补0；第二44/44和最终105/105通过。首轮失败原件与复验完整保留；两批浏览器均一次全部通过，无本任务浏览器失败ZIP。未改解释器或放宽预算。质量/脚本检查的原输出按各自标签保留。

实际文件：content/algorithms/cpp/classics-1.0.0.json与hanoi/euclidean-gcd/trial-division-prime/palindrome-number四CPP；web/src/classics的content/controller/presentation/ClassicState/ClassicCatalog/ClassicPage/classics.css；必要App/Layout/CatalogPages接入；scripts/classics-content/classics-release-inputs/classics-browser/register-classics及build-p05-course/restore-release-evidence；两新单元与classics浏览器套件；44登记/当前生成指纹、六独立文档、中央五资料和新算法目录覆盖表。旧MemoryPanel/StackPanel、引擎/协议/学习存储与原案例实现不改。

6567开工文件按SHA归属审计：6556原样、11授权修改、无删除；43的283源与历史35—43及3723份旧原件保持，24个此前仅本地失败ZIP核SHA保留。外窗CI交接SHA709c620f3300703138b4d1de0e96c2912a6091c3305319e87a5c8d3a6e6ec75c保持，不修CI。HEAD ec023619c4f49509360ead2365233b9c768b6df4/main，空暂存/待推送链0；无代理、新聊天、工作树、自动化、暂存、提交、推送或真实用户清档。

未测：完整Rust507通过/1原忽略与原引擎极限继承前置，仅核SHA，不冒称新跑；未重跑全项目前端、Firefox/Edge、其他主题、DPI/人工缩放/触屏/读屏器/自然满盘断电或11.4完整设备首屏/多面板性能矩阵。16.10二期全体验收、18后续5算法和21通用多语言尚未完成。

见[决议](../架构决策/16.9-C++四经典问题与输入边界.md)、[契约](../契约/16.9-C++经典案例与汉诺塔存储.md)、[界面复核](./16.9-界面复核.md)、[算法覆盖表](../算法目录覆盖表.md)、[44凭据](./发布凭据/16.9-1.0.44/index.json)、[验证原件](./16.9-验证原件/index.json)、[最终复核](./16.9-最终复核.json)与[交接](../交接/16.9-交接.md)。`);
write('项目文档/验收/16.9-界面复核.md',`# 16.9 界面复核

2026-10-31；沿既有framed-sheet方向（seed1060963509）及minimal主题延伸案例工作台。此次只扩展四经典案例及目录入口，不重做全站主题。React/CSS原生界面，真实原文/当前对象驱动；未引入AI位图、装饰性图表或第三方素材。

四页分别通过真实Chrome Inspector，宽1440、768、390各一次，共12视图，全部0FAIL/0WARN。12张最终page-01整页评审图已逐张查看；各图/报告、折叠截图与HTML诊断均归档在[验证原件](./16.9-验证原件/index.json)。汉诺塔图为当前positions的静态安放，圆角盘宽只表达盘大小，不维护另一套移动算法；其他三页直接展示真实标量与真实cout。

桌面源码与当前状态两区，窄屏按既有自适应工作台纵向排布，页面没有横向溢出。输入/样例/运行、六速前后退/滑块、当前讲解和数值/内存/栈切换均有真实Chrome测试。代码区局部等宽，正文沿现有字体；当前代码高亮与游标/原子状态一致。未初始化、已死亡对象、正常分类为否与执行失败分别有语义。main返回后当前变量消失，完整运行输出另列，避免把终态旧变量冒称活值。

源UI lint检查10文件，0FAIL/1WARN：CatalogPages.tsx原课程编号padStart(2,'0')用于实际章节编号，不是新装饰编号，保留并说明。Inspector只沿既有gradient许可，没有新增宽泛规则豁免；本批组件无渐变动效。最终12宽屏场景与四个同游标视图测试属于正式60项之内，不重复计数。

实际测试Chrome156.0.8078.76/minimal；其他主题/Firefox/Edge/DPI/人工缩放/触屏/读屏器未测。详见[独立验收](./16.9-C++经典问题验收.md)、[44凭据](./发布凭据/16.9-1.0.44/index.json)、[最终复核](./16.9-最终复核.json)及[交接](../交接/16.9-交接.md)。`);
write('项目文档/交接/16.9-交接.md',`# 16.9 交接

2026-10-31；root按协调唯一派发完成16.9后结束。本项四经典问题已验收；16.10未领取、第16整块未完成，第21步0/10。当前原68/88、主路线68/98、P1 27/28、P0.5 9/9。

交付汉诺塔、辗转相除GCD、朴素素数、回文数四个正式C++案例与目录卡片。汉诺塔0..5真实positions[5]/moveState[4]、数组别名与递归最多7活动帧，0盘合法；GCD±999恰2输入，双零明确教学约定0；素数±999逐整数试除，低于2否；回文±999负否、完整三位反转域保安全。输入严格固定1/2项、128字符、不截断。显示/复制/请求为完全相同C++原文，没有C替跑或前端求解。

一个ClassicController/MemoryExecutionClient/MemoryPlayer，真实图形/标量、MemoryPanel、StackPanel同状态同游标；选调用者不seek。未初始化null、位置先变而计数输出未更新、候选移动字段和对象死亡保真；全量原子前后退恢复对象/别名/栈/作用域/allocator/输出/计数/输入游标。输入编辑、换例、取消、清档、离页和截止的迟到结果不能复活；六速/键盘/隐藏暂停通过。

正式44/298源，105相关单元（6套）及60唯一正式Chrome通过，29种case/input的正式原包独立数值/Hanoi合法最少移动与全原子逆恢复；四页三宽Inspector0FAIL/0WARN，源UI lint0FAIL/1原课程编号WARN。类型/ESLint/格式/正式构建/自有dev和preview通过并停止自有进程。最大637步/665093结果字节/7帧/136活动教学字节；观察最大post→response44.3ms、点击→Worker终止106.0ms，不是独立Rust耗时或设备性能矩阵。失败与修正、实际文件及未测详目见[独立验收](../验收/16.9-C++经典问题验收.md)。

沿原memory协议/WASM及全部预算，三Rust/WASM无修改。SAVE7/DB7/15store、32节40题172组20块、七C/六CPP排序/两栈队列/两节点/两对比及12.4观察与成就保持；新经典不记学习奖励/挑战/对比/快照，不新迁移。完整Rust/引擎极限继承前置SHA，未重跑全项/其他浏览器主题/设备矩阵；不能把固定四例称为通用C++支持。

新增[算法目录覆盖表](../算法目录覆盖表.md)逐项对应SRS22算法：17已验、5留18.4/18.5；另列四C语法演示，合计21正式case、七C十四CPP。覆盖表不是18后续任务完成证据。下一窗口由既有协调唯一领取16.10，先按守则/裁决/台账/第16任务包读取12—15与16.1—16.9前置和旧验收，再做二期全部必需要求、多视图/双面板组合、兼容与性能门槛；不要直接开21或补未授权新算法。

6567开工文件SHA审计6556原样/11授权修改/无删除，283前置受审源与35—43、3723份旧原件和24个既有本地ZIP均核对；外窗CI交接SHA709c620f3300703138b4d1de0e96c2912a6091c3305319e87a5c8d3a6e6ec75c保持，不修CI。完整文件清单和本任务原件见[验证原件](../验收/16.9-验证原件/index.json)，决策/输入见[DEC-P1-026](../架构决策/16.9-C++四经典问题与输入边界.md)/[CLASSIC-CASE-01](../契约/16.9-C++经典案例与汉诺塔存储.md)，另见[使用说明](../交付/16.9-C++经典问题使用说明.md)、[界面复核](../验收/16.9-界面复核.md)、[44凭据](../验收/发布凭据/16.9-1.0.44/index.json)与[最终复核](../验收/16.9-最终复核.json)。

HEAD ec023619c4f49509360ead2365233b9c768b6df4/main，空暂存/待推送链0；无代理、新聊天、工作树、自动化、暂存、提交、推送或真实用户清档；第16整块未完成，不触发整块Git提交。`);
const summary=prefix=>`16.9当前验收（2026-10-31）：四个真实C++经典案例已验收：汉诺塔0..5真实位置数组/别名与最多7帧；GCD±999双零约定0；朴素素数低于2否；回文负否且三位反转有界。固定1/2输入、显示原文直接执行，数值/图/原内存/栈同游标与全原子回退。正式1.0.44（298源），105相关单元、60唯一正式Chrome、29种正式case/input原包独立复核；四页三宽Inspector0FAIL/0WARN，源UI lint0FAIL/1原课程编号WARN，类型/ESLint/格式/正式构建/自有dev与preview通过。SAVE7/DB7/15store、32节40题172组20块、七C/既有十CPP/两对比及三Rust/WASM/协议/原预算保持，无新学习奖励/经典挑战/对比/快照。原68/88、主路线68/98、P1 27/28、P0.5 9/9、第21步0/10；16.10未领取，第16整块未完成。见[验收](${prefix}验收/16.9-C++经典问题验收.md)、[使用说明](${prefix}交付/16.9-C++经典问题使用说明.md)、[交接](${prefix}交接/16.9-交接.md)、[算法覆盖表](${prefix}算法目录覆盖表.md)、[44凭据](${prefix}验收/发布凭据/16.9-1.0.44/index.json)、[验证原件](${prefix}验收/16.9-验证原件/index.json)及[最终复核](${prefix}验收/16.9-最终复核.json)。22算法中17已验/5留18.4/18.5，四C语法演示另列，合计21正式案例。6567基线文件无删除、3723旧原件/24既有本地ZIP/外窗CI交接SHA保持，不修CI；无Git写入/代理/新聊天/工作树/自动化/真实用户清档，HEAD ec023619，空暂存/待推送链0。下方旧时点记录保留历史含义。`;
for(const path of ['README.md','项目守则.md','项目文档/需求覆盖与范围裁决.md','项目文档/任务进度与交接.md','项目文档/开发路线与依赖.md']){
 let source=readFileSync(path,'utf8');assert.ok(source.includes('16.8当前验收（2026-10-31）'),path);
 source=source.replace('16.8当前验收（2026-10-31）','16.8历史验收（2026-10-31）');
 const split=source.indexOf('\n\n');assert.ok(split>0);source=source.slice(0,split+2)+summary(path.includes('/')?'./':'项目文档/')+'\n\n'+source.slice(split+2);
 if(path==='项目文档/任务进度与交接.md'){
  source=source.replace('16.9领取（2026-10-31）','16.9领取（2026-10-31，现已结束）');
  const old='| 16.9 | P1 | [经典问题基础批次](./任务包/第16步-完善教学交互、算法目录并验收二期.md) | 进行中 | root | 2026-10-31唯一领取；6567文件/283源基线；DEC-P1-026/CLASSIC-CASE-01先冻结，四经典例/原预算/真实memory C++与同游标栈；仅本项 |';assert.ok(source.includes(old));
  source=source.replace(old,'| 16.9 | P1 | [经典问题基础批次](./任务包/第16步-完善教学交互、算法目录并验收二期.md) | 已验收 | root | 2026-10-31；正式44/298源，四经典真实C++；105单元/60唯一正式Chrome/29种正式原包独立全逆；22算法逐项17已验5后续，交接/原件齐备；下一16.10未领取 |');
  source=source.replace(/^阶段统计：原P0 41项已验[^\n]*$/m,'阶段统计（16.9验收当前）：原P0 41项已验，P1 28项中12—15及16.1—16.9共27项已验，P2 19项未验；原68/88已验、余20，主路线68/98。P0.5独立9/9，21新增0/10。第12/13/14/15部分完成，第16整块/P1总门槛16.10及P2总门槛20.4未完成；下一16.10未领取。');
 }
 if(path==='项目文档/需求覆盖与范围裁决.md'){
  const old='下表1—3是已有C算法，继续用C；4—22均是尚未实现的新算法，统一交C++版（对应16.4—16.9、18.4/18.5）。';assert.ok(source.includes(old));
  source=source.replace(old,'下表保留原规划排期；1—3已有C算法继续用C，后续新算法统一交C++版（对应16.4—16.9、18.4/18.5）。当前逐项交付与未实现状态见[算法目录覆盖表](./算法目录覆盖表.md)：16.9验收后17项已验、5项留后续，不能把规划行当作已完成。');
 }
 writeFileSync(path,source);
}
console.log('Four independent closure documents and five central current-status records written; next16.10 remains unclaimed.');
