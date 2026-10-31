import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const files=['README.md','项目守则.md',...['需求覆盖与范围裁决','任务进度与交接','开发路线与依赖'].map(name=>`项目文档/${name}.md`),...['交付','交接','契约','架构决策','验收'].flatMap(dir=>readdirSync(`项目文档/${dir}`).filter(file=>/^16\.3-.*\.md$/.test(file)).map(file=>`项目文档/${dir}/${file}`))];
let checked=0; const pending=[];
for(const file of files)for(const match of readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)){
  let target=match[1].replace(/^<|>$/g,'');if(/^(?:https?:|#|codex:)/.test(target))continue;
  target=target.split('#')[0];if(!target)continue;
  target=resolve(dirname(file),decodeURIComponent(target));
  if(target.endsWith('项目文档\\验收\\16.4-验证原件\\index.json') && !existsSync(target) && process.argv.includes('--before-archive')){pending.push(target);continue;}
  assert.ok(existsSync(target),`${file}: ${match[1]}`); checked++;
}
if(!process.argv.includes('--before-archive'))assert.equal(pending.length,0);
const result={files:files.length,checked,pending:[...new Set(pending)],beforeArchive:process.argv.includes('--before-archive')};
writeFileSync(`.artifacts/16.4/links-${result.beforeArchive?'before-archive':'complete'}.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
