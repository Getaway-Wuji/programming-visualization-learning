import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,copyFileSync,mkdirSync,readdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
const dir='.artifacts/16.10',sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const source=JSON.parse(readFileSync(dir+'/r1610-perf-formal46-second-sources.json'));
for(const f of source.sources){assert.equal(sha(f.path),f.sha256);const to=dir+'/formal46-qa-before/'+f.path;mkdirSync(dirname(to),{recursive:true});copyFileSync(f.path,to);}
const d=dir+'/clean-workspace/tests/.artifacts/16.10';const rows=[];
for(const name of readdirSync(d).filter(n=>/^r1610-perf-.*\.json$/.test(n))){const from=d+'/'+name,to=dir+'/'+name;if(existsSync(to))assert.equal(sha(from),sha(to));else copyFileSync(from,to);rows.push({from,to,sha256:sha(to)});}
writeFileSync(dir+'/perf-report-relocation.json',JSON.stringify({reason:'Playwright resolves the relative JSON reporter output under the config directory. These are exact original report bytes, copied without changing old labels or results.',rows},null,2)+'\n',{flag:'wx'});
console.log({reports:rows.length,qaBackedUp:source.sources.length});