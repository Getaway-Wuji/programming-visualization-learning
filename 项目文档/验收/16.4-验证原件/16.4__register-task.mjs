import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
const path='项目文档/任务进度与交接.md';let text=readFileSync(path,'utf8');
assert.ok(!text.includes('16.4领取（2026-10-31'));
const at=text.indexOf('\n',text.indexOf('\n')+1)+1;
text=text.slice(0,at)+'16.4领取（2026-10-31，实施中）：root / 完成16任务按协调唯一领取；11.5/12.1前置及12.2/16.1—16.3交接已读。开工HEAD ec023619、4501文件SHA见.artifacts/16.4/baseline.json；固定C++直接插入、n/2再减半希尔、41桶频次回填计数，最多30项，前两者−999..999、计数−20..20；DEC-P1-020/ALG-CASE-01先冻结。root独占新content/algorithms与web/src/algorithms、必要App/Layout/CatalogPages/构建后继39及当前课程生成指纹、专项验证与中央五资料；不改三引擎/预算/学习存档/奖励，旧七C及35—38/16.1—16.3原件保留，外窗CI交接保护且不修CI。只Chrome/minimal，不派代理/新聊天/工作树/自动化，不暂存/提交/推送；本轮只16.4，不领取16.5/21。\n\n'+text.slice(at);
text=text.replace(/^(\| 16\.4 \|[^\n]*?)\| 未开始 \|[^\n]*$/m,'$1| 实施中 | root / 完成16任务 | DEC-P1-020/ALG-CASE-01；三个C++排序、原预算/无学习写，4501文件SHA基线 |');
assert.ok(text.includes('| 16.4 |')&&text.includes('DEC-P1-020/ALG-CASE-01；三个C++排序'));
writeFileSync(path,text);console.log('16.4 registered; only this task.');
