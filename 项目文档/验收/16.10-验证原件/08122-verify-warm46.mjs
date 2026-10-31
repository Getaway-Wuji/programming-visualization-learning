import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const d='.artifacts/16.10/clean-workspace/.artifacts/11.4/r1610-perf-init46-first';
const files=readdirSync(d).filter(f=>/^initialization-.*\.json$/.test(f));
assert.equal(files.length,12);
const rows=files.map(file=>{const bytes=readFileSync(d+'/'+file),r=JSON.parse(bytes);assert.equal(r.readinessFailure,null,file);for(const name of ['storage','reading','practice','goal'])assert.ok(r.ui.shell.includes(`data-learning-${name}-status="ready"`),file+':'+name);for(const key of ['dailyFacts','progress','ledger','receipts','reviewCards','achievements'])assert.equal(r.archive[key].length,0,file+':'+key);return {path:d+'/'+file,sha256:createHash('sha256').update(bytes).digest('hex'),ready:true,noLearningFacts:true};});
writeFileSync('.artifacts/16.10/warm46-verification.json',JSON.stringify({task:'16.10',registeredRelease:'1.0.46',profiles:6,coldWarmEndpoints:12,rows,scope:'Actual native P05 archive read-only, five home profiles and one course profile, no user storage and no injected learning facts.'},null,2)+'\n',{flag:'wx'});console.log({verified:rows.length});