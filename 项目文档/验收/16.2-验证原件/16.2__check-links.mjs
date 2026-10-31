import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
const label = process.argv[2] ?? 'links-final'; assert.match(label, /^[A-Za-z0-9-]+$/);
const strict = process.argv.includes('--final');
const root = resolve('.'), planned = resolve('项目文档/验收/16.2-验证原件/index.json');
const docs = [
  '项目文档/架构决策/16.2-同数据双算法与统一回放.md',
  '项目文档/契约/16.2-双算法对比生命周期.md',
  '项目文档/交付/16.2-双算法对比使用说明.md',
  '项目文档/交接/16.2-交接.md',
  '项目文档/验收/16.2-双算法同数据对比验收.md',
  '项目文档/验收/16.2-界面复核.md',
];
const central = ['README.md','项目守则.md','项目文档/需求覆盖与范围裁决.md','项目文档/开发路线与依赖.md','项目文档/任务进度与交接.md'];
const errors = [], pendingGenerated = new Set(); let links = 0;
for (const path of [...docs,...central]) {
  let text = readFileSync(path,'utf8');
  if (central.includes(path)) text = text.split(/\r?\n/).filter((line) => line.includes('16.2双算法同数据对比已验收')).join('\n');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g,'').split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    target = decodeURIComponent(target); links++;
    const absolute = resolve(dirname(resolve(root,path)),target);
    if (!existsSync(absolute)) {
      if (!strict && absolute === planned) pendingGenerated.add(relative(root,absolute));
      else errors.push({path,target});
    }
  }
}
const result = {task:'16.2',scope:'six16.2documents plus five current central paragraphs; historical text not changed',strict,files:11,links,errors,pendingGenerated:[...pendingGenerated]};
writeFileSync(`.artifacts/16.2/${label}.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result)); assert.deepEqual(errors,[]);
