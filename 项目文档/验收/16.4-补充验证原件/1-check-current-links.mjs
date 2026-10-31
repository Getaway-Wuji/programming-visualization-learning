import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const files=['README.md','项目守则.md',...['需求覆盖与范围裁决','任务进度与交接','开发路线与依赖'].map(name=>`项目文档/${name}.md`),...['交付','交接','契约','架构决策','验收'].flatMap(dir=>readdirSync(`项目文档/${dir}`).filter(file=>/^16\.4-.*\.md$/.test(file)).map(file=>`项目文档/${dir}/${file}`))];
assert.equal(files.length,11);assert.equal(files.filter(file=>file.includes('/16.4-')).length,6);
let checked=0;
for(const file of files)for(const match of readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)){
  const target=match[1].replace(/^<|>$/g,'').split('#')[0];if(!target||/^(?:https?:|codex:)/.test(target))continue;
  assert.ok(existsSync(resolve(dirname(file),decodeURIComponent(target))),`${file}: ${match[1]}`);checked++;
}
const result={task:'16.4',fileCount:files.length,files,checked,pending:[],scopeCorrection:'Earlier helper copied from16.3 retained its escaped document filename regex; its720 links included the older task docs. This independent check explicitly covers the six16.4 documents plus five central documents. No earlier report or archive was rewritten.'};
writeFileSync('.artifacts/16.4/links-current-complete.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
