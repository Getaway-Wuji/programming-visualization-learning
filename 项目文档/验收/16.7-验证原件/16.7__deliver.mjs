import assert from'node:assert/strict';import{readFileSync,writeFileSync}from'node:fs';
const dir='.artifacts/16.7',json=p=>JSON.parse(readFileSync(p)),real=json(`${dir}/real-structures-summary.json`),visual=json(`${dir}/visual.json`),registration=json('content/c/p0/blockly-release-1.0.42.json');assert.equal(real.runs,16);assert.equal(registration.files.length,270);
const save=(p,s)=>writeFileSync(p,s+'\n',{flag:'wx'}),max=k=>Math.max(...real.rows.map(r=>r[k])),links=`[决议](../架构决策/16.7-C++栈与环形队列操作序列.md)、[契约](../契约/16.7-C++结构案例与操作编码.md)、[42凭据](./发布凭据/16.7-1.0.42/index.json)、[验证原件](./16.7-验证原件/index.json)、[最终复核](./16.7-最终复核.json)`;
save('项目文档/交付/16.7-C++栈与队列使用说明.md',`# 16.7 C++栈与队列使用说明

2026-10-31；正式1.0.42。进入“算法与演示”中的数组栈或环形队列；路由分别为/#/structures/case.cpp.array-stack及/#/structures/case.cpp.circular-queue。两者是受支持C++子集的真实Rust执行，不表示第21步通用语言学习闭环已完成。

每行写“入 整数”或“出”，例如：

    入 7
    入 -3
    出
    入 0
    出

值为−999～999的十进制整数，可带正负号，−0归为0。忽略空行；整个空序列写[]，留空无效。入编码为[1,v]占2个输入槽，出编码为[2]占1槽，总计最多30槽、草稿最多1024字符；不是30次入。格式或数量超限会明确拒绝，不截断。满/空序列仍合法，由实际C++处理。可选边界样例，恢复示例或使用空序列。

点击运行C++操作，源码只按编码长度实例化，原序列经cin读取。入成功输出IN v，出成功输出OUT v，满入输出FULL v、空出输出EMPTY；拒绝后继续处理后续操作，满入的参数仍消费。最后END和正常返回只表示程序结束，不表示全部操作成功。未知原始内部码会INVALID并返回1，界面编码不会生成它。

数组栈固定5槽，top为有效数量和下一写入位置，有效段[0,top)，先读data[top−1]再缩短；top=5是容量端点，不存在data[5]。页面从高下标向0排列，逻辑顺序为底到顶。

环形队列固定5槽，head/tail是单调读写序号，物理位置分别取模5。显示数量为tail−head的只读表达式；空差0、满差5，所以物理头尾相同仍可区分。有效项按先出到后出列出，物理[4]之后复用[0]，序号继续增长。读/写标记是候选位置，空时不读、满时不写，以C++分支/outcome为准。

五个物理槽区分未初始化、有效项和已写但当前非有效。刚写入尚未执行top/tail发布与出操作遗留残值都不计为有效项；出操作不清零。所有显示来自当前实际轨迹，不预演操作。变量consumed与cin游标的独立赋值之间可暂时不同；同值写可能只增加真实写计数而无cell差异。

后退、前进、回到初态、查看末步和滑块恢复完整状态；0.25/0.5/1/1.5/2/4倍只改回放。聚焦观察区后空格播放暂停、左右键单步；切换至源码、隐藏页面暂停。修改草稿、切换案例、重跑、离页或清档使旧运行失效，取消/超时/失败需显式重跑。当前输出与折叠的完整结果分开。main结束移除对象，从结束后退可恢复；结构栈不是调用栈。物理存储详情给出实际对象ID与教学虚拟地址，不是宿主地址。

操作草稿、源码、轨迹不保存为学习档案，不计课程、挑战、积分或奖励。本项不增加对比、快照导出或新学习事实。原32节/40题172组/20积木、七C、六C++排序与两种对比保留。

见[独立验收](../验收/16.7-C++栈与队列验收.md)、[界面复核](../验收/16.7-界面复核.md)、[交接](../交接/16.7-交接.md)。`);
save('项目文档/验收/16.7-界面复核.md',`# 16.7 界面复核

2026-10-31，Chrome156.0.8078.76，minimal；采用已验收framed-sheet/seed1060963509与现有源码/观察工作台。两页面1440/768/390均使用真实C++运行与滑块，Inspector原probe/rules保持，仅页面准备适配结构选择器；原gradient许可沿用，没有新增规则豁免。

最终Inspector合计${visual.fail}FAIL/${visual.warn}WARN。初次各有font-count WARN（默认输出monospace与源码Consolas并存），局部统一pre字体后重新生成两套三宽报告；前版原件保留。已实际查看两页三宽完整截图，五物理槽/有效段/空满结果/源码/控制可用，页面无横向溢出；小屏使用原有页签与正常纵向滚动。普通长工作台无需隐藏实际变量或压缩数据。

源UI lint扫描新structures七文件及App/Layout/CatalogPages共10文件，0FAIL/1WARN。WARN指向原CatalogPages第61行的课程顺序padStart(2,'0')；该行与开工前相同，是已有C课程编号，不是新增装饰编号，保留并单独说明。ESLint为0错误/0警告。

六速、单步、滑块、重播与源码UTF8字节高亮；真实写槽尚未发布、弹出残值、scope移除和后退均已断言。隐藏页若headless未真正hidden，则隔离DOM visibility事件触发真实监听，不注入播放器状态；正式证据明确标明自然后台未覆盖。物理触屏、读屏器、DPI/人工缩放和完整主题矩阵未测。

报告及图片见[验证原件](./16.7-验证原件/index.json)，汇总见[独立验收](./16.7-C++栈与队列验收.md)。`);
save('项目文档/验收/16.7-C++栈与队列验收.md',`# 16.7 C++栈与队列验收

2026-10-31，root独立负责，协调只读派发。16.7已验收，第16整块尚未完成；16.8未领取，第21步0/10。

先冻结DEC-P1-023与STRUCT-CASE-01 1.0.0，两个原创CPP、容量5、值−999～999、输入语法/≤30整数槽与P1原预算。两份源码原文经AlgorithmExecutionClient/单Worker送Rust，前端只编码并投影真实Step DSL；没有第二份结构状态或操作模拟。stack的top和queue的单调head/tail在各原子步发布，数量tail−head是显示表达式；无heap/MemoryState强转。

正式1.0.42登记270受审源，继承41的257源并增加3内容文件、7结构模块、2内容/发布输入脚本和1契约。前驱35—41、旧16.1—16.6与16.4补充原件保留，当前算法WASM仍为${registration.algorithmEngine.wasmSha256}（${registration.algorithmEngine.wasmBytes}字节）。EXEC1.2/STEP1.1/DIAG1.1/整数1.0保持。

99单元/5套通过：新结构真实执行30、控制器5、原协议18、客户端8、迭代案例38。受控未知码9实际返回1/无END，缺参数实际E_INPUT_EXHAUSTED且可逆前缀；不是静态模板或伪轨迹。正式Chrome35唯一场景、无重试/跳过/失败，候选受审35通过；早期两轮各35通过不重复累计。覆盖两结构16组真实边界、严格语法/-0、所有原子边界/提交LIFO或FIFO/输入消费/输出/计数、同游标恢复、空满/30槽/重复/负数/端点/队列绕回、取消/编辑/清档/离页/超时迟到/Worker失败重试、六速/键盘/隐藏、6页面宽度、未发布0/残值/移除逆恢复、目录/路由/重跑身份和旧六CPP/原C/memory/两对比。原生15store完整快照前后相等，没有新学习事实、迁移或奖励。

正式原包另离线独立解码16组，逐提交Node参考栈/FIFO核对，仅测试端有oracle；全量原子逆恢复相等。最高${max('steps')}步、${max('resultBytes')}字节结果、${max('maxLiveBytes')}存活教学字节、main最大1帧；data[5]固定20教学字节。观测最大post→response ${real.timingMax.postToResponseMs.toFixed(1)}ms、点击→Worker终止${real.timingMax.clickToTerminateMs.toFixed(1)}ms，含观察器复制，不含Playwright断言/离线解码；不是单独Rust耗时或完整设备性能矩阵。单组1000ms与其余源码32KiB/请求64KiB/输入30/步20k/fuel1M/结果16MiB/输出16KiB/存活1MiB/WASM128MiB等原上限不变。

两页三宽Inspector${visual.fail}FAIL/${visual.warn}WARN；源UI lint0FAIL/1项已解释的原课程编号WARN；类型、ESLint、格式、正式构建和自有dev/preview启动通过。继承三Rust源码/WASM受保护SHA，未重跑完整Rust507通过/1原忽略或完整前端/Firefox/主题/设备矩阵。构建仍有既有大包提示，没有抬高阈值。

保留设置/检查失败：首次构建漏显式candidate标志，41登记校验正确拒绝新源码；测试驱动最初误用不存在step API，改真实seek；首轮lint提示无用初值和React缓存不可保持，删除初值/多余parsed缓存后通过。初次字体WARN已修复。没有自然业务故障伪装；所有旧日志均留档。

实际文件：content/algorithms/cpp下stack-queue-1.0.0.json与array-stack/circular-queue两CPP；web/src/structures七文件；App/Layout/CatalogPages必要接入；scripts下structures-content/structures-release-inputs/register-structures/structures-browser及build-p05-course/restore-release-evidence；两新单元与structures浏览器套件；42登记、当前课程生成指纹、六独立文档及中央五资料。学习/存储/引擎/旧algorithms实现未改。

5678开工文件按归属SHA审计，无删除；新增文件精确列于归属原件。外窗CI交接SHA不变，不修CI。HEAD ec023619c4f49509360ead2365233b9c768b6df4，main，空暂存/待推送链0；没有代理/新聊天/工作树/自动化/暂存/提交/推送/真实用户清档。

${links}。另见[使用说明](../交付/16.7-C++栈与队列使用说明.md)、[界面复核](./16.7-界面复核.md)、[交接](../交接/16.7-交接.md)。`);
save('项目文档/交接/16.7-交接.md',`# 16.7 交接

2026-10-31；root按协调派发完成16.7后结束。下一16.8仍未领取，第16整块不完成，第21步0/10。

交付两个真实C++容量5结构案例与独立操作工作区。语法逐行入整数/出，[]空，−999～999，最多30编码整数槽；只替换长度并用cin读取，Rust裁决空满，拒绝不停止序列。数组栈用top，环形队列用单调head/tail及取模5，tail−head仅显示表达式。物理未初始化/新写未发布/有效/残值/对象移除明确区分；同值写用真实计数，不伪造cell差异；完全反向恢复。

实际改动文件、验证范围、预算与未测见[独立验收](../验收/16.7-C++栈与队列验收.md)，操作入口见[使用说明](../交付/16.7-C++栈与队列使用说明.md)，语义见[DEC-P1-023](../架构决策/16.7-C++栈与环形队列操作序列.md)/[STRUCT-CASE-01](../契约/16.7-C++结构案例与操作编码.md)。新目录与旧六CPP/七C并列，路由/布局接入不新增主导航。

正式42/270源；99相关单元、35唯一正式Chrome和16组真实原包独立全逆复核；三宽双页面Inspector${visual.fail}FAIL/${visual.warn}WARN，源UI lint0FAIL/1原编号WARN。正式构建/自有dev/preview及类型/格式/ESLint通过。三Rust/WASM及协议/预算沿原版本，只做SHA核对，不重跑旧全套；当前SAVE7/DB7/15store、32节/40题172组/20块无变化。控制器只订阅学习会话失效，无写入；无结构挑战/对比/快照。

下一窗口先按守则/裁决/台账/任务包及12.1/12.2/12.3读取，再由协调领取16.8；链表/树需要另外冻结数量、结构、真实执行对象与内存路径，不把本项固定整数数组当动态指针对象。不能顺手进入21或改旧课程语言。

5678文件开工SHA、前驱35—41、16.1—16.6原件及外窗CI交接保持；无删除。独立原件含失败设置/字体修复、归属全清单与真实Worker字节，不能重跑旧标签覆盖历史。见[42凭据](../验收/发布凭据/16.7-1.0.42/index.json)、[原件](../验收/16.7-验证原件/index.json)、[最终复核](../验收/16.7-最终复核.json)。

HEAD ec023619c4f49509360ead2365233b9c768b6df4/main，空暂存、待推送链0。未建代理/新聊天/工作树/自动化，未暂存/提交/推送，未操作真实用户清档。整块未完成不触发Git提交规则。当前原66/88、主路线66/98、P1 25/28、P0.5 9/9，第21步0/10。`);
const summary=`16.7真实C++数组栈/环形队列已验收：容量5、单调head/tail取模及真实top，逐行入整数/出编码总≤30槽、−999..999，空满拒绝/残值/未发布/同值写/生命周期完整回退。正式1.0.42（270源），99相关单元、35唯一正式Chrome、16组正式原包独立全逆复核；两页三宽Inspector${visual.fail}FAIL/${visual.warn}WARN，源UI lint0FAIL/1项原课程编号WARN已说明，类型/格式/ESLint/正式构建/自有dev与preview通过。SAVE7/DB7/15store、32节/40题172组/20块、七C/六CPP排序/两对比、三Rust/WASM及原协议/预算保持；无学习奖励/结构挑战/对比/快照。原66/88、主路线66/98，P1 25/28、P0.5 9/9、第21步0/10；16.8未领取，第16整块未完成。`;
for(const file of ['README.md','项目守则.md',...['需求覆盖与范围裁决','任务进度与交接','开发路线与依赖'].map(n=>`项目文档/${n}.md`)]){
 let text=readFileSync(file,'utf8');assert.ok(!text.includes('16.7当前验收（'));const prefix=file.startsWith('项目文档/')?'./':'项目文档/',ref=`见[独立验收](${prefix}验收/16.7-C++栈与队列验收.md)、[使用说明](${prefix}交付/16.7-C++栈与队列使用说明.md)、[交接](${prefix}交接/16.7-交接.md)、[42凭据](${prefix}验收/发布凭据/16.7-1.0.42/index.json)与[验证原件](${prefix}验收/16.7-验证原件/index.json)。`;
 const at=text.indexOf('\n');text=text.slice(0,at+1)+`\n16.7当前验收（2026-10-31）：${summary} ${ref}5678开工文件按归属保护、无删除，35—41及全部旧原件/外窗CI交接保持。不修CI、无Git写入/代理/新聊天/工作树/自动化/真实用户清档；HEAD ec023619，空暂存/待推送链0。下方旧时点记录保留历史含义。\n`+text.slice(at+1);text=text.replace('16.6当前验收（','16.6历史验收（');
 if(file==='项目守则.md')text=text.replace('当前原65/88、新增21为0/10分别记录，主路线65/98。','当前原66/88、新增21为0/10分别记录，主路线66/98。');
 if(file==='项目文档/任务进度与交接.md'){text=text.replace('16.7领取（2026-10-31）：','16.7领取（2026-10-31，现已结束）：').replace(/^(\| 16\.7 \|[^\n]*?)\| 进行中 \|[^\n]*$/m,'$1| 已验收 | root | 2026-10-31；正式42/270源，两个容量5真实C++结构；99单元/35唯一Chrome/16正式边界与全逆，交接/原件齐备；下一16.8未领取 |');assert.match(text,/\| 16\.7 \|[^\n]+\| 已验收 \|/);}
 writeFileSync(file,text);
}
console.log(JSON.stringify({docs:6,central:5,next:'16.8 unclaimed',progress:{original:'66/88',main:'66/98',p1:'25/28',p05:'9/9',language21:'0/10'}}));
