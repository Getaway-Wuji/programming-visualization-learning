import assert from 'node:assert/strict';
import fs from 'node:fs';
const files=['README.md','项目守则.md','项目文档/需求覆盖与范围裁决.md','项目文档/任务进度与交接.md','项目文档/开发路线与依赖.md'];
const summary='16.6真实C++桶排序已验收：5固定桶/−20..29/0～30项，每桶30槽，未初始化bucketData[150]+清零bucketSizes[5]、稳定桶内插入/按桶合并，原Algorithm P1同源执行与完整回退/虚拟布局齐备。正式1.0.41（257源；35—40与16.1—16.5原件保持），94相关单元、30唯一Chrome（正式新28+旧递归2；候选28）跨批通过，13组正式边界原包。Chrome156/minimal三宽0FAIL/1项已说明的长工作台滚动WARN、源UI lint0FAIL/0WARN，正式构建/自有dev/preview通过。SAVE7/DB7/15store、32节/40题172组/20块、七C/原五C++/两种对比、三Rust/WASM与原预算保持，无新学习事实或桶挑战/对比/快照。原65/88、主路线65/98，P1为24/28，P0.5为9/9、第21步0/10；16.7未领取，第16整块未完成。';
for(const file of files){let text=fs.readFileSync(file,'utf8');assert.ok(!text.includes('16.6当前验收（'));
  const prefix=file.startsWith('项目文档/')?'./':'项目文档/',links=`见[独立验收](${prefix}验收/16.6-C++桶排序验收.md)、[使用说明](${prefix}交付/16.6-C++桶排序使用说明.md)、[交接](${prefix}交接/16.6-交接.md)、[41凭据](${prefix}验收/发布凭据/16.6-1.0.41/index.json)与[验证原件](${prefix}验收/16.6-验证原件/index.json)。`;
  const at=text.indexOf('\n');text=text.slice(0,at+1)+`\n16.6当前验收（2026-10-31）：${summary} ${links}5387开工文件按归属保护、无删除；外窗CI交接SHA保持，不修CI。HEAD ec023619、空暂存/待推送链0，无代理/新聊天/工作树/自动化/提交/推送或真实用户清档。下方旧时点记录保留历史含义。\n`+text.slice(at+1);
  text=text.replace('16.5当前验收（','16.5历史验收（');
  if(file==='README.md')text=text.replace('另有插入、希尔、计数、归并、快速五个独立C++排序观察案例及归并/快速同数据对比，不计课程或积分。','另有插入、希尔、计数、归并、快速、桶六个独立C++排序观察案例及归并/快速同数据对比，不计课程或积分。');
  if(file==='项目守则.md')text=text.replace('当前原63/88、新增21为0/10分别记录，主路线63/98。','当前原65/88、新增21为0/10分别记录，主路线65/98。').replace('原规划交付：需求拆解与开发规约。当前以[台账](./项目文档/任务进度与交接.md)为准：','原规划交付：需求拆解与开发规约。历史时点16.4执行记录（当前以台账顶端为准）：');
  if(file.includes('任务进度与交接')){text=text.replace('16.6领取（2026-10-31）：','16.6领取（2026-10-31，现已结束）：').replace(/^(\| 16\.6 \|[^\n]*?)\| 进行中 \|[^\n]*$/m,'$1| 已验收 | root | 2026-10-31；正式41/257源，五桶有界真实C++/完整回退；94单元/30唯一Chrome/13正式边界，交接及原件齐备；下一16.7未领取 |');assert.match(text,/\| 16\.6 \|[^\n]+\| 已验收 \|/);}
  fs.writeFileSync(file,text);
}
console.log('Central five updated for16.6 only;16.7 remains unclaimed.');
