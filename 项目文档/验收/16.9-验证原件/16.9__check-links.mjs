import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
export const files=['项目文档/算法目录覆盖表.md','README.md','项目守则.md',...['需求覆盖与范围裁决','任务进度与交接','开发路线与依赖'].map(n=>`项目文档/${n}.md`),...['交付','交接','契约','架构决策','验收'].flatMap(d=>readdirSync(`项目文档/${d}`).filter(f=>/^16\.9-.*\.md$/.test(f)).map(f=>`项目文档/${d}/${f}`))];
assert.equal(files.length,12);assert.equal(files.filter(f=>f.includes('/16.9-')).length,6);
export function check(allowPending=false){let checked=0;const pending=new Set(),planned=['项目文档/验收/16.9-验证原件/index.json','项目文档/验收/16.9-最终复核.json'].map(p=>resolve(p));for(const file of files)for(const match of readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)){const target=match[1].replace(/^<|>$/g,'').split('#')[0];if(!target||/^(?:https?:|codex:)/.test(target))continue;const absolute=resolve(dirname(file),decodeURIComponent(target));if(!existsSync(absolute)&&allowPending&&planned.includes(absolute))pending.add(absolute);else assert.ok(existsSync(absolute),`${file}: ${match[1]}`);checked++;}return{task:'16.9',fileCount:files.length,files,checked,pending:[...pending]};}
if(process.argv.includes('--before-archive')){const report=check(true);writeFileSync('.artifacts/16.9/links-before-archive.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));}
