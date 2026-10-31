import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const json = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
for (const [name, expected] of [['formal-comparison-37',14], ['storage-final37',36], ['regression-37',22]]) {
  const report = json(`.artifacts/16.2/${name}.json`); assert.equal(report.stats.expected, expected); assert.equal(report.stats.unexpected + report.stats.skipped + report.stats.flaky, 0);
}
assert.equal(json('content/c/p0/blockly-release-1.0.37.json').files.length, 210);
assert.equal(Number(readFileSync('.artifacts/16.2/startup-final.exit', 'utf8').trim()), 0);
assert.equal(json('.artifacts/16.2/taste/inspect-final37/report.json').findings.length, 0);
const status = '16.2双算法同数据对比已验收：原C冒泡/选择、0～30项相等独立副本、两次真实Rust与统一可逆回放/真实计数/短侧保持/失败取消晚到齐备。正式1.0.37（210受审源，36/35及16.1原件保留），1609唯一前端断言与119唯一Chrome场景跨批通过；正式对比14/14、存储36/36、挑战10/播放器12及minimal三宽Inspector0FAIL/0WARN、自有dev/preview齐备。SAVE7/DB7/15store，原32节/40题172组、20块/七C案例、三引擎/WASM及原预算保持。原61/88、主路线61/98，P1为20/28，P0.5为9/9、第21步0/10；下一16.3未领取，第16整块尚未完成。';
const replacements = [
  ['README.md', /^2026-10-31当前交付：[^\r\n]*/m, `2026-10-31当前交付：${status} 见[验收](项目文档/验收/16.2-双算法同数据对比验收.md)、[使用说明](项目文档/交付/16.2-双算法对比使用说明.md)与[交接](项目文档/交接/16.2-交接.md)。本轮仅16.2，未暂存/提交/推送；第15部分私有main交付历史保持。`],
  ['项目守则.md', /^原规划交付：[^\r\n]*/m, `原规划交付：需求拆解与开发规约。当前以[台账](./项目文档/任务进度与交接.md)为准：${status} 见[验收](./项目文档/验收/16.2-双算法同数据对比验收.md)与[交接](./项目文档/交接/16.2-交接.md)。本轮仅16.2、不触发整块Git；历史交付保留。`],
  ['项目文档/需求覆盖与范围裁决.md', /^2026-10-31执行更新：[^\r\n]*/m, `2026-10-31执行更新：${status} 见[DEC-P1-018](./架构决策/16.2-同数据双算法与统一回放.md)、[COMP-01](./契约/16.2-双算法对比生命周期.md)、[验收](./验收/16.2-双算法同数据对比验收.md)与[交接](./交接/16.2-交接.md)。下方旧时点数字保留历史含义。`],
  ['项目文档/开发路线与依赖.md', /^2026-10-31当前排期：[^\r\n]*/m, `2026-10-31当前排期：${status} 见[验收](./验收/16.2-双算法同数据对比验收.md)与[交接](./交接/16.2-交接.md)。16.3由既有协调流程另行派发，第21仍须20.4后开始；原整块Git结果保持。`],
];
const updates = replacements.map(([path, pattern, replacement]) => {
  const original = readFileSync(path, 'utf8'); assert.ok(pattern.test(original), path);
  let next = original.replace(pattern, () => replacement);
  if (path === '项目守则.md') next = next.replace(/^任务层级为：[^\r\n]*/m, (line) => line.replace('当前原59/88','当前原61/88').replace('主路线59/98','主路线61/98'));
  return [path, next];
});
const path = '项目文档/任务进度与交接.md'; let ledger = readFileSync(path, 'utf8');
assert.ok(ledger.includes('16.2领取（2026-10-31，实施中）'));
ledger = ledger.replace('16.2领取（2026-10-31，实施中）', '16.2领取（2026-10-31，现已结束）').replace('16.1当前验收', '16.1历史验收');
const index = ledger.indexOf('16.2领取');
ledger = ledger.slice(0,index) + `16.2当前验收（2026-10-31）：**${status}** [独立验收](./验收/16.2-双算法同数据对比验收.md)、[界面复核](./验收/16.2-界面复核.md)、[交接](./交接/16.2-交接.md)、[使用说明](./交付/16.2-双算法对比使用说明.md)、[37凭据](./验收/发布凭据/16.2-1.0.37/index.json)与[验证原件](./验收/16.2-验证原件/index.json)齐备。2922开工文件无删除，16.1的310份原件保持；HEAD ec023619、空暂存，无新聊天/工作树/自动化/代理或真实用户清档。\r\n\r\n` + ledger.slice(index);
ledger = ledger.replace(/^\| 16\.2[^\r\n]*/m, '| 16.2 | P1 | [双算法同数据对比](./任务包/第16步-完善教学交互、算法目录并验收二期.md) | 已验收 | root / 完成16任务 | 原C两例/同数据独立真实运行/统一回退/真实计数；210源正式37、1609前端/119唯一Chrome跨批；[验收](./验收/16.2-双算法同数据对比验收.md)/[交接](./交接/16.2-交接.md) |');
ledger = ledger.replace(/(\| 16\.2[^\r\n]*\r?\n)\r?\n(?=\| 16\.3)/, '$1');
ledger = ledger.replace('2026-10-31完成16.1后主路线21步98项，已验60、余38', '2026-10-31完成16.2后主路线21步98项，已验61、余37').replace('下一16.2尚未领取', '下一16.3尚未领取');
updates.push([path, ledger]);
for (const [path, text] of updates) writeFileSync(path, text);
console.log(JSON.stringify({ updated: updates.map(([path])=>path), original: '61/88', main: '61/98', P1: '20/28', next: '16.3 unclaimed' }));
