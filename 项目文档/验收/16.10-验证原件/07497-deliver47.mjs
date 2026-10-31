import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {basename} from 'node:path';
import {createHash} from 'node:crypto';
const dir='.artifacts/16.10',archive='项目文档/验收/16.10-验证原件',read=p=>readFileSync(p),json=p=>JSON.parse(read(p).toString().replace(/^\uFEFF/,''));
const proof=path=>({path,sha256:createHash('sha256').update(read(path)).digest('hex')});
const f=json(dir+'/functional-gates47.json'),p=json(dir+'/performance-gates47.json'),d=json(dir+'/delivery-proof47.json'),o=json(dir+'/ownership47-pre.json'),a=json(archive+'/index.json'),baseline=json(dir+'/baseline.json');
assert.equal(f.browser.uniquePassed,281);assert.equal(f.frontend.passed,1841);assert.equal(p.passed,true);assert.equal(d.sourceFiles,299);assert.equal(o.priorArchivesPreserved,4083);assert.ok(a.entries.length>0);
const mapped=path=>{const e=a.entries.find(e=>e.source===path);assert.ok(e,'Missing archived '+path);return {path:'16.10-验证原件/'+e.file,encoding:e.encoding,sha256:e.sha256,originalSha256:e.originalSha256};};
const saveNew=(path,text)=>{assert.equal(existsSync(path),false,path);writeFileSync(path,text+'\n',{flag:'wx'});};
const round=x=>Math.round(x*10)/10;
const names={'c-bubble30':'C冒泡30逆序','visible-practice-bubble6':'可见积木练习六组（含30逆序）','c-pair30':'C冒泡/选择双30逆序','cpp-pair30':'C++归并/快速双30逆序','memory-hanoi5':'既有递归栈观察：汉诺塔5盘','cpp-quick30-sorted':'C++快速30有序最坏输入'};
const timing=p.groups.map(g=>`| ${names[g.id]} | ${round(g['first-context'].maxMs)} | ${round(g['warm-module'].maxMs)} |`).join('\n');
const frames=p.playbackCases.map(c=>`| ${names[c.id]} | ${round(c.applicationPipelineUpperBoundMs.p95)} | ${round(c.rafGapMs.p95)} | ${c.over33_3Ratio} | ${c.drawEvents}/${c.paintEvents}/${c.distinctEncodedScreenshots} |`).join('\n');
const evidence={task:'16.10',release:'1.0.47',accepted:true,registration:proof('content/c/p0/blockly-release-1.0.47.json'),reviewedSources:299,frontend:1841,browserUnique:281,formalBatches:f.browser.reports.map(r=>mapped(r.path)),functional:mapped(dir+'/functional-gates47.json'),performance:mapped(dir+'/performance-gates47.json'),delivery:mapped(dir+'/delivery-proof47.json'),baseline:mapped(dir+'/baseline.json'),prerequisites:baseline.prerequisites,archive:proof(archive+'/index.json'),ownership:'16.10-归属复核.json',externalMetadata:[mapped(dir+'/external-changes47.json'),mapped(dir+'/external-supplement47.json')],counts:{original:69,totalOriginal:88,main:69,totalMain:98,p1:28,totalP1:28,p05:9,totalP05:9,step21:0,totalStep21:10},scope:{lessons:32,exercises:40,testGroups:172,blocks:20,cCases:7,cppCases:14,formalCases:21,algorithms:22,deliveredAlgorithms:17,deferredAlgorithms:5,comparisonFamilies:2,badges:3,cChallenges:21,save:7,db:7,stores:15},rust:{passed:507,originalIgnored:1,inheritedBySourceAndWasmSha:true,fullSuiteRerun:false},performanceBoundary:{navigation:110,transactions:120,rustExecutions:260,requiredAnalyses:100,stablePlaybacks:3,original500GroupDeviations:p.original500GroupDeviations,wholeGroupToleranceDeviations:p.group800600Deviations,allUnderOriginal1000:true,notPhysical60Fps:true},stop:'Coordinator actual review; separately dispatched16 Git closeout in same chat; then stop and wait explicit user start17. No17/21 claimed.',noGitMutation:true};
saveNew('项目文档/验收/16.10-综合证据.json',JSON.stringify(evidence,null,2));
saveNew('项目文档/验收/16.10-二期整体验收.md',`# 16.10 二期整体验收

2026-10-31；本项由root单一负责人完成。正式1.0.47、299受审源，45/46及其全部失败凭据保留。二期28/28、原69/88、主路线69/98；P0.5为9/9，第21步0/10。第16整块Git交付另待协调实际复核和同聊天派发；本轮未暂存、提交或推送。之后停止，等待用户明确启动17。

## 范围与需求对应

[27项P1前置与当前集成矩阵](./16.10-P1需求证据矩阵.md)逐项对应12—15和16.1—16.9；另有11.5一期前置。28组原验收/交接的完整路径和SHA见[综合证据](./16.10-综合证据.json)。这些历史记录仅代表各自时点，当前集成另有正式47实证。

32节C课、40练习172组、20类积木、原七C及十四C++案例保持；40题包括32课程练习及8个Bug关卡。22算法中17已交付、5留18.4/18.5，四个C语法演示另列，共21正式案例。两族对比、三固定徽章及七C的21挑战保持。SAVE7/DB7/15store、三Rust/WASM、契约/解释子集及全部原执行预算不变。见[算法覆盖表](../算法目录覆盖表.md)与[运行/支持/本地数据说明](../交付/16.10-二期运行与本地数据说明.md)。

## 当前行为与质量

- 最终前端全量1841/1841（r1610-units-tenth），无失败/跳过。测试进程数4，仅限制文件并发，未放宽断言或产品时限。
- 正式47的249综合、14个CPP默认案例及1条同档组合全部通过；原生17项第二批全部通过。共281唯一Chrome场景，无跳过、自动重试或flaky；四批次通过，不能称同一批281全绿。源与生成授权在root、受测副本和独立交付副本匹配。
- 完整32题140组真实执行/保存、刷新/重复奖励、原六课真实完成后升级、配额/CAS/跨页清除/部分旧记录/受损异包均有当前原生证据。DB1—7迁移实现和原独立迁移凭据按SHA继承，当前前端全量另回归；本轮未重新跑全部独立迁移浏览器harness。
- 同档组合经真实失败→错题/复习评级→正确作答/阅读完成→C挑战→CPP对比→内存/栈/JSON快照→刷新核保存。十四CPP核实际显示/请求源码、真实输入、轨迹/高亮及完整回退；其历史边界原包按各前置SHA继承，不冒称本轮重新执行所有边界。
- 原生Worker/单槽、真实冷下载及已派发取消≤100ms、原1000ms异步校验截止、迟到/畸形/身份/非法轨迹拒绝、50次交替执行与取消通过。可用堆观测只是趋势，不证明零泄漏。
- 类型、ESLint、格式、正式root/受测副本/独立源码构建通过。Rust507通过/1原ignore按原源码与三WASM指纹继承；本轮未重跑完整Rust套件。Memory Bug语义单元同时控制原本声明的固定now及定时器；真实1秒边界来自原生检查，不由该单元代证。

## 参考性能与偏差

沿01.4/11.4和[DEC-P1-027](../架构决策/16.10-二期综合门槛与证据范围.md)。参考笔记本、交流供电/平衡方案、物理59.951Hz端点、Chrome156、1440×900、生产构建；真实HTTPS共享20Mbps下行/5Mbps上行/40ms RTT及Brotli。本机用户态网络转发不等于公网；匹配主机端点也不能证明整个期间OS空闲。

正式47（r1610-perf-formal47-first）110导航全部通过，最大${round(p.navigation.max)}ms、p95 ${round(p.navigation.p95)}ms。120完整事务包含260次真实Rust执行和100次必要分析；所有实际输入与意图一致。整组端到端最大${round(p.execution.max)}ms、p95 ${round(p.execution.p95)}ms。

| 完整事务 | 首上下文最大ms | 同Module暖态最大ms |
|---|---:|---:|
${timing}

“首上下文”不保证Module冷；可见代码练习在提交前必须做真实分析，因此其实际编译状态由采证记录判断。单执行从原意图至完整接收和双rAF；复合事务按各执行最终终止划分连续不重叠段，包含分析、绑定、渲染与所有等待，分别满足既有冷800/暖600。全部复合整组仍在原共同1000ms内呈现，没有移动起点或扩大预算。

**原500ms整组体验目标未全面达到：${p.original500GroupDeviations}/120超出；整组直接套800/600亦有${p.group800600Deviations}/120偏差。** 原始谓词/慢值均保留；通过结论是既有单执行/连续分段容差和原组合安全、功能门槛通过，不能表述为每个整组已达500或600ms。C对比最大963.4ms，余量有限；任意后台负载、设备和网络不在保证范围内。P0保留真实Rust计时边界；其他引擎没有单独Rust计时处记未测，不从端到端倒推。

三段各30秒稳定窗口按原4×/125ms播放；C和CPP均双30项，第三段是既有12.4汉诺塔5盘递归栈观察，不是新增classic位置图的性能验收。

| 窗口 | 应用管线p95 ms | rAF间隔p95 ms | >33.3ms比例 | Draw/Paint/不同截图 |
|---|---:|---:|---:|---|
${frames}

三段游标连续且前台、真实CDP绘制/截图变化通过；三个中段截图已目视核对。应用管线是回调至DOM提交上界，与rAF和物理屏幕呈现分别记录，**不宣称物理60fps或每秒60个不同教学状态**。采证器只保留时间戳/原包，冷暖端点后才整理包；全部播放计时后才解析压缩CDP流，不把重型采证整理混入下一样本。

## 实际修复与失败保留

公开课程HTTP缓存仍每realm核完整字节/长度/SHA/封闭结构，摘要不符在原10秒内至多reload一次；Worker脚本与受信Module在有效意图后并行准备，未post前忽略回复；旧1.0复用严格词法canonical证明，保留完整schema/身份及正逆检查；有界标量记录和分隔符调度等价优化，解码按原6ms分片并保留逐64KiB guard。未执行/预编译用户程序或缓存用户源码/输入/结果。

46修复已P05暖档案的暂态发布错误，只在真实目录/档案均就绪且无pending时解除。47修复内存Bug配额重试已持久保存而关卡仍显示未保存：原全局lastSaved代理改为现有真实通过投影、ready及pending0共同判断；不补事实或奖励。修复前两次原生失败记录显示原event/10分已入库，47原断言及完整综合批次通过。

45正式性能、46正式首轮、所有pilot/CPU诊断、早期1836受控时钟不一致和1841高并发初始化等待失败均原样保留。46综合246/249后的两个原断言独占通过、配额真实UI缺陷在47修复；47综合249一次通过。47原生首轮16/17的懒模块注入没有触发请求，补实际P05/目标就绪前置后完整17通过；失败不回写。双向设置场景仅明确持久偏好与正常公开冲突恢复前置，是否恢复有附件，不强制click或替换原文/奖励断言。

几项早期单元使用过可覆盖“当前摘要”默认路径；改前已存当时三份字节副本，后续均独立任务标签。保护承诺针对6964开工可见文件、冻结凭据/4083旧原件/24旧ZIP和明确前置SHA，不冒称全部旧未归档可变缓存字节保持。

## 交付、归属与未测

[验证原件索引](./16.10-验证原件/index.json)保留原报告/原包/截图/失败及gzip双指纹；ZIP为明确本地保留项。独立产品源码副本未带旧.artifacts、generated或target，7024选定文件；共享node_modules/.tools安装工具缓存，不能称空白新机安装。299产品源、三WASM、103新生产文件及8检查页面文件与受测版本逐SHA一致。root/受测副本旧未引用生成额外文件保留，不作为fresh依赖。

独立副本对两份外窗CI配置采用已核开工版本，未回写共享目录；本地副本同时包含当时可见的14个外窗非运行归档记录，未作为299源或本项成果。外窗CI同步/清理的2修改及16新增资料另列、保留并从本项Git计划排除，两份历史必需.log原SHA携带。当前本地main/HEAD ec023619和暂存保持；协调Git收尾须先核已有远端08aae414历史，不把CI修复冒称16新功能。本轮不证明当前47已通过GitHub Actions。

未新增Edge/Firefox全量、六主题矩阵、真实DPI/人工缩放/触屏/读屏器、自然满盘/断电、空白新机或公网部署验收；没有真实AI/云档案或第17—21能力闭环。下一步仅协调实际复核→同聊天第16整块Git收尾→停止等待用户明确启动17。

见[综合证据](./16.10-综合证据.json)、[归属复核](./16.10-归属复核.json)、[独立交接](../交接/16.10-交接.md)和[最终复核](./16.10-最终复核.json)。`);
let matrix=read('项目文档/验收/16.10-P1需求证据矩阵.md').toString();
matrix=matrix.replace(/^状态：[^\r\n]*/m,'状态：16.10当前正式47综合验收通过；27项P1前置与11.5原件按SHA继承，当前集成另证。完整指纹见综合证据，性能偏差及未测以独立二期报告为准。');
const byTask=new Map(baseline.prerequisites.map(v=>[v.task,v]));
matrix=matrix.split(/\r?\n/).map(line=>{
 if(line.startsWith('| 要求/任务'))return line+' 当前正式证据 | 前置原件/SHA |';
 if(line==='|---|---|---|---|')return '|---|---|---|---|---|---|';
 const task=line.match(/^\| (\d+\.\d+) /)?.[1];if(!task)return line;
 const prior=byTask.get(task);assert.ok(prior,task);
 const current=task==='13.1'?'1841全量/原设计向量':/^16\.[46789]$/.test(task)?'CPP正式14默认':task==='16.5'?'CPP正式14＋core递归对比':'正式core249';
 return line+` ${current} | [验收](${basename(prior.acceptance.path)}) ${prior.acceptance.sha256.slice(0,12)} / [交接](../交接/${basename(prior.handoff.path)}) ${prior.handoff.sha256.slice(0,12)} |`;
}).join('\n');
matrix+='\n\n当前正式入口对应r1610-core47-first、r1610-cpp-formal47-first及r1610-units-tenth；另有native47-second17与combined47-first1，共281唯一场景。14CPP默认集成不冒称重跑全部原边界；原各任务正常/边界/拒绝凭据按SHA继承。当前110导航/120事务/三段连续播放、原500ms整组偏差68及800/600整组偏差37均见[二期报告](./16.10-二期整体验收.md)。28组前置完整SHA及当前原件映射见[综合证据](./16.10-综合证据.json)。\n';
writeFileSync('项目文档/验收/16.10-P1需求证据矩阵.md',matrix);
const table=read('项目文档/算法目录覆盖表.md').toString();assert.equal(table.split(/\r?\n/).filter(l=>/^\| \d+ \|/.test(l)).length,22);
let coverage=table.replace('16.9验收时点','16.10汇总时点（原各任务验收保留）').replace('16.10二期门槛尚未验收，17项算法已交付不等于P1整期完成。','16.10二期综合门槛已通过，算法条目与总门槛分别见证据；其余5项仍未实施。');
coverage+='\n当前总门槛见[16.10验收](./验收/16.10-二期整体验收.md)及[需求矩阵](./验收/16.10-P1需求证据矩阵.md)。第16Git收尾后停止，17.1等待用户明确启动；第21步仍0/10。\n';writeFileSync('项目文档/算法目录覆盖表.md',coverage);
const primary=['README.md','项目守则.md','项目文档/任务进度与交接.md','项目文档/开发路线与依赖.md','项目文档/需求覆盖与范围裁决.md'];
for(const path of primary){let s=read(path).toString().replace('16.9当前验收','16.9历史验收');const prefix=path==='README.md'?'项目文档/':path==='项目守则.md'?'./项目文档/':'./';
 const note=`16.10当前验收（2026-10-31）：正式47/299源，1841全量、281唯一正式Chrome、参考主机110导航/120完整事务及三段30秒播放通过；独立产品源构建/旧原件归属检查齐备。原500ms整组偏差68/120、800/600整组偏差37/120保留，单执行/连续分段满足既有容差且复合组在原1000ms内；不冒称全面500ms或物理60fps。32节40题172组20块、7C/14CPP、22算法17已验5后续、SAVE7/DB7/15store保持。原69/88、主路线69/98、P1 28/28、P0.5 9/9、21为0/10。见[二期验收](${prefix}验收/16.10-二期整体验收.md)、[交接](${prefix}交接/16.10-交接.md)、[运行说明](${prefix}交付/16.10-二期运行与本地数据说明.md)和[最终复核](${prefix}验收/16.10-最终复核.json)。先交协调实际核验，再由协调另派本聊天第16整块Git收尾；之后立即停止，17.1未领取、等待用户明确启动，不自动进入17/21。外窗CI修改/新增归档另列保留；本轮未暂存/提交/推送，未动真实用户资料。下方旧时点叙述保留历史含义。`;
 s=s.replace(/^(#[^\r\n]*\r?\n)/,'$1\n'+note+'\n');
 if(path.endsWith('任务进度与交接.md')){s=s.replace(/^16\.10复验记录[^\r\n]*/m,'16.10过程记录（现已收口）：45/46与47原失败原件保留；当前结论以顶端验收、综合证据与独立交接为准。').replace('16.10领取（2026-10-31）','16.10领取（2026-10-31，现已结束）');s=s.split(/\r?\n/).map(l=>l.startsWith('| 16.10 |')?'| 16.10 | P1 | [二期整体验收与交接](./任务包/第16步-完善教学交互、算法目录并验收二期.md) | 已验收 | root | 47/299源；1841前端、281唯一正式Chrome、110导航/120事务/三段30秒、独立源构建及旧原件审计通过；[验收](./验收/16.10-二期整体验收.md)／[交接](./交接/16.10-交接.md)。Git待协调另派，之后停止等待用户明确17。 |':l.startsWith('| 17.1 |')?l.replace('| 未领取 |','| 未领取（待用户明确启动） |'):l).join('\n');}
 if(path==='项目守则.md')s=s.replace('当前原67/88、新增21为0/10分别记录，主路线67/98','当前原69/88、新增21为0/10分别记录，主路线69/98');
 if(path.endsWith('需求覆盖与范围裁决.md'))s=s.replace(/^\| 新旧阶段门槛 \|[^\r\n]*/m,'| 新旧阶段门槛 | P0 41项及P1 28项均已验收，原69/88、主路线69/98；P0.5为9/9，21为0/10。16.10已通过，Git收尾后停止，17.1等待用户明确启动 | [16.10验收](./验收/16.10-二期整体验收.md)、统一台账 |');
 writeFileSync(path,s);
}
saveNew('项目文档/交接/16.10-交接.md',`# 16.10 二期整体验收交接

2026-10-31；root单写者完成本项，交回协调实际复核。正式1.0.47/299源，二期28/28、原69/88、主路线69/98；P0.5 9/9、21为0/10。16.1—16.9历史验收保留，本项不重记其开发任务。

## 实际文件

六处产品修复为course-bundle公开缓存、execution-client并行Worker准备、protocol严格词法/分片、execution-json等价扫描、learning/service暖P05暂态恢复及MemoryBugPage真实已保存状态。构建选择/恢复追加45—47与phase2-release-inputs；三Rust/WASM、全部契约/预算和SAVE7不改。相关单元、实际浏览器前置/失败采证、独立性能与source-copy入口及47新登记归本项。普通浏览器配置排除独占HTTPS性能专项，专项入口仍强制原门槛。

中央五资料、算法覆盖当前说明、[需求矩阵](../验收/16.10-P1需求证据矩阵.md)、[验收](../验收/16.10-二期整体验收.md)、[运行/本地数据支持说明](../交付/16.10-二期运行与本地数据说明.md)已更新。精确修改/新增/排除路径与SHA见[最终归属](../验收/16.10-归属复核.json)，原件映射见[综合证据](../验收/16.10-综合证据.json)和[原件索引](../验收/16.10-验证原件/index.json)。

## 验证

最终1841全量、类型/ESLint/格式、正式root/受测副本/独立产品源构建通过。正式47综合249、CPP14默认、原生17第二批及同档组合1，共281唯一Chrome，无跳过/自动重试。实际32课140组保存、旧六课升级及多页/配额/恢复兼容通过；14CPP实际源码/请求/高亮/全逆当前复验，历史边界按SHA继承。Rust507/原ignore1及三WASM按原源码SHA继承，不是本轮Rust全量新跑。

当前参考性能110导航、120事务（260真实Rust+100必要分析）及三段各30秒稳定播放通过。原500ms整组偏差68/120、800/600整组偏差37/120保留；适用连续分段容差及原组合1000ms，不写每个整组500ms。回调至DOM/rAF/CDP分别记录，不宣称物理60fps。详见二期报告。

独立副本7024选定文件，未复制旧.artifacts/generated/target；共享安装工具缓存，不是空白新机。299源/三WASM及103生产文件、8检查页面文件逐SHA匹配；旧额外生成文件未删除。两个外窗CI配置在副本用开工版本，当前共享文件保持；其中14个非运行外窗归档记录亦有来源说明，不算本项产品。

## 失败、未测与遗留

45/46全部性能/功能失败、47原生首轮注入未触发及早期单位时钟/采证路径/初始化等待失败保留。内存Bug配额重试UI已在47真实修复；20,000步和非法稿原断言在47综合通过。QA只补正常公开持久偏好/真实P05就绪前置，未改产品时限或伪造结果。早期若干可覆盖当前摘要曾写默认路径，保存当时三份副本；不声称所有未归档可变缓存不变。

未新增Edge/Firefox/六主题、真实DPI/人工缩放/触屏/读屏器、自然满盘/断电、空白新机或公网验收；全部独立迁移harness未重跑。算法后续5项、17—21及AI/语言通用闭环仍未实施。性能整组体验偏差和C对比有限余量是已知限制。

## 归属和下一步

6964开工文件按归属审计、无删除；4083旧原件、24旧本地ZIP、28前置验收/交接及原外窗失败排查交接SHA保护。另一个窗口按用户要求同步已发布CI修复并清理临时副本：2既有配置修改及16新增脚本/说明/归档不由本项接管，均保留并从16.10 Git计划排除。两份15.4必需.log保持原SHA。临时CI副本已由该窗口回收，故本项不依赖该目录。

本地主目录main/HEAD ec023619、暂存区和本地待推送链保持；没有本项Git写入，也不冒称当前47远端Actions成功。协调实际复核本交付后，在同一“完成16任务”聊天按既有授权另派第16整块Git收尾，无需再询问用户；必须先核并纳入远端既有08aae414历史，检查16.1—16.10整块文件归属/暂存和待推送链，不夹带外窗未完成内容，不重写历史，身份仅Getaway-Wuji。第16实际Git交付完成后停止并由协调暂停续接，17.1仍未领取，等待用户明确启动17。`);
console.log({documentsWritten:true,phase1Original:69,p1:28,stopBefore17:true});
