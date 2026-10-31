import assert from 'node:assert/strict';
import fs from 'node:fs';
const files=['README.md','项目守则.md','项目文档/需求覆盖与范围裁决.md','项目文档/任务进度与交接.md','项目文档/开发路线与依赖.md'];
const summary='16.5两个C++递归排序及实际同数据对比已验收：稳定闭区间归并/共享scratch，末项Lomuto快速（较小段递归/较大段循环），真实同源C++/Rust与可逆栈/别名/内存、独立输入副本/单槽/共用1000ms齐备。正式1.0.40（250源，35—39及16.1—16.4原件保持），132受影响单元、98唯一Chrome跨批通过（候选新50+旧迭代32；正式新50+旧C对比14及快照2），正式32次边界原包/8组共同预算保留。两页minimal三宽Inspector和源UI lint均0FAIL/0WARN、正式构建/自有dev/preview通过。SAVE7/DB7/15store、32节/40题172组/20块、七C/原三C++迭代及三Rust/WASM/原预算保持；无新学习事实，挑战/快照范围保持。原64/88、主路线64/98，P1为23/28，P0.5为9/9、第21步0/10；16.6未领取，第16整块未完成。';
for(const file of files){let text=fs.readFileSync(file,'utf8');assert.ok(!text.includes('16.5当前验收（'));
  const prefix=file.startsWith('项目文档/')?'./':'项目文档/';
  const links=`见[独立验收](${prefix}验收/16.5-C++递归排序与对比验收.md)、[使用说明](${prefix}交付/16.5-C++递归排序与对比使用说明.md)、[交接](${prefix}交接/16.5-交接.md)、[40凭据](${prefix}验收/发布凭据/16.5-1.0.40/index.json)与[验证原件](${prefix}验收/16.5-验证原件/index.json)。`;
  const at=text.indexOf('\n');text=text.slice(0,at+1)+`\n16.5当前验收（2026-10-31）：${summary} ${links}4867开工文件按归属保护、无删除；外窗CI交接SHA保持，不修CI。HEAD ec023619、空暂存/待推送链0，无代理/新聊天/工作树/自动化/提交/推送或真实用户清档。下方旧时点记录保留历史含义。\n`+text.slice(at+1);
  text=text.replace('16.4当前验收（','16.4历史验收（');
  text=text.replace('2026-10-31当前交付：16.4','2026-10-31历史交付（16.4）：16.4').replace('2026-10-31当前排期：16.4','2026-10-31历史排期（16.4）：16.4').replace('2026-10-31执行更新：16.4','2026-10-31历史执行（16.4）：16.4');
  if(file==='README.md')text=text.replace('另有插入、希尔、计数三个独立C++排序观察案例，不计课程或积分。','另有插入、希尔、计数、归并、快速五个独立C++排序观察案例及归并/快速同数据对比，不计课程或积分。');
  if(file.includes('任务进度与交接')){
    text=text.replace('16.5领取（2026-10-31）：','16.5领取（2026-10-31，现已结束）：');
    text=text.replace(/^(\| 16\.5 \|[^\n]*?)\| 进行中 \|[^\n]*$/m,'$1| 已验收 | root | 2026-10-31；正式40/250源，归并/快速与实际同数据对比，132单元/98唯一Chrome；独立交接及原件齐备，下一16.6未领取 |');
    assert.match(text,/\| 16\.5 \|[^\n]+\| 已验收 \|/);
  }
  fs.writeFileSync(file,text);
}
console.log('Central five documents reflect16.5 only;16.6 remains unclaimed.');
