import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
for(const name of ['formal-download-38-final','regression-38','startup-final','lint-delivery','format-delivery','typecheck-delivery'])assert.equal(Number(readFileSync(`.artifacts/16.3/${name}.exit`,'utf8').trim()),0,name);
const summary='16.3当前快照导出已验收：原七C案例及十个现有内存/递归观察三视图，完整JSON与PNG、原播放器暂停、异步代次失效和独立文件齐备。正式1.0.38（220受审源；35/36/37及16.1/16.2原件保留），200项受影响单元断言、73项唯一Chrome场景通过（下载37/37、回归36/36），实际70份JSON/29份PNG；minimal三宽Inspector0FAIL/0WARN，自有dev/preview通过。SAVE7/DB7/15store、原32节/40题172组、20块/七C案例、三Rust/WASM与原执行预算保持。原62/88、主路线62/98，P1为21/28，P0.5为9/9、第21步0/10；下一16.4未领取，第16整块尚未完成。';
function line(file,prefix,value){let text=readFileSync(file,'utf8');const start=text.indexOf(prefix);assert.ok(start>=0,file);assert.ok(start===0||text[start-1]==='\n');const end=text.indexOf('\n',start);text=text.slice(0,start)+value+'\n'+text.slice(end+1);writeFileSync(file,text);}
line('README.md','2026-10-31当前交付：',`2026-10-31当前交付：${summary} 见[验收](项目文档/验收/16.3-当前快照验收.md)、[使用说明](项目文档/交付/16.3-当前快照使用说明.md)与[交接](项目文档/交接/16.3-交接.md)。本轮仅16.3，不修CI，未暂存/提交/推送；既有整块交付历史保持。`);
line('项目守则.md','原规划交付：',`原规划交付：需求拆解与开发规约。当前以[台账](./项目文档/任务进度与交接.md)为准：${summary} 见[验收](./项目文档/验收/16.3-当前快照验收.md)与[交接](./项目文档/交接/16.3-交接.md)。本轮仅16.3、不触发整块Git；历史交付保留。`);
line('项目文档/需求覆盖与范围裁决.md','2026-10-31执行更新：',`2026-10-31执行更新：${summary} 见[DEC-P1-019](./架构决策/16.3-当前状态快照与下载一致性.md)、[SNAPSHOT-01](./契约/16.3-当前快照格式与捕获生命周期.md)、[验收](./验收/16.3-当前快照验收.md)与[交接](./交接/16.3-交接.md)。下方旧时点数字保留历史含义。`);
line('项目文档/开发路线与依赖.md','2026-10-31当前排期：',`2026-10-31当前排期：${summary} 见[验收](./验收/16.3-当前快照验收.md)与[交接](./交接/16.3-交接.md)。16.4由既有协调流程另行派发，第21仍须20.4后开始；原整块Git结果保持。`);
const ledger='项目文档/任务进度与交接.md';let text=readFileSync(ledger,'utf8');
text=text.replace('16.3领取（2026-10-31，实施中）','16.3领取（2026-10-31，现已结束）').replace('16.2当前验收（2026-10-31）','16.2历史验收（2026-10-31）');
const after=text.indexOf('\n',text.indexOf('\n')+1)+1;
text=text.slice(0,after)+`16.3当前验收（2026-10-31）：**${summary}** [独立验收](./验收/16.3-当前快照验收.md)、[界面复核](./验收/16.3-界面复核.md)、[独立交接](./交接/16.3-交接.md)、[使用说明](./交付/16.3-当前快照使用说明.md)、[38凭据](./验收/发布凭据/16.3-1.0.38/index.json)及[验证原件](./验收/16.3-验证原件/index.json)齐备。3671开工文件按归属保护，无删除；外窗CI交接SHA保持，未修CI、未重跑整套Rust或全部前端。HEAD ec023619、空暂存；无代理/新聊天/工作树/自动化/提交/推送或真实用户清档。\n\n`+text.slice(after);
writeFileSync(ledger,text);
line(ledger,'| 16.3 |', '| 16.3 | P1 | [当前快照导出](./任务包/第16步-完善教学交互、算法目录并验收二期.md) | 已验收 | root / 完成16任务 | 正式38/220源；200受影响单元/73唯一Chrome，99实际下载，三宽0FAIL；[验收](./验收/16.3-当前快照验收.md)/[交接](./交接/16.3-交接.md)，SAVE7/DB7及原预算保持 |');
line(ledger,'阶段统计：','阶段统计：原P0 41项已验、P1 28项中12.1—12.5/13.1—13.5/14.1—14.4/15.1—15.4及16.1—16.3共21项已验、P2 19项未验，共88项，原62已验、余26；P0.5独立9项全验收，9/9。03及REQ-P05-04取消，16有效需求封闭。下一16.4未领取；第12/13/14/15部分全部完成，第16整块及P1总门槛16.10/P2总门槛20.4尚未完成。');
line(ledger,'2026-10-29新增第21步10项，当前0/10，全未开始；2026-10-31完成16.2后','2026-10-29新增第21步10项，当前0/10，全未开始；2026-10-31完成16.3后主路线21步98项，已验62、余36（P0.5另列9/9），历史验收数字保留其时点含义。21.1须20.4通过，21.4/21.7为语言顺序门槛，21.10总验收；当前最小C++算法/内存及调试不算21.4。下一16.4尚未领取。');
console.log('Five central documents updated only after final gates.');
