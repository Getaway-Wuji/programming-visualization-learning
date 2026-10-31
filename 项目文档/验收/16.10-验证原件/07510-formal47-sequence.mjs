import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const dir='.artifacts/16.10',log=dir+'/formal47-sequence.jsonl';
writeFileSync(log,'',{flag:'wx'});
const jobs=[
 ['r1610-core-formal-first','r1610-core47-first'],
 ['r1610-native-first','r1610-native47-first'],
 ['r1610-cpp-candidate47-first','r1610-cpp-formal47-first'],
 [null,'r1610-combined47-first','phase2-integration.spec.ts'],
];
let failed=0;
for(const [prior,label,selection] of jobs){
 appendFileSync(log,JSON.stringify({stage:'start',label,atUtc:new Date().toISOString()})+'\n');
 const args=prior?['.artifacts/16.10/run-previous-selection.mjs',prior,label]:['scripts/phase2-browser.mjs',label,selection];
 const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,env:process.env});
 const p=dir+'/'+label+'.json';const report=existsSync(p)?JSON.parse(readFileSync(p)):null;
 const row={stage:'complete',label,atUtc:new Date().toISOString(),exit:r.status??1,stats:report?.stats??null};
 appendFileSync(log,JSON.stringify(row)+'\n');console.log(JSON.stringify(row));
 if(r.status!==0){failed++;console.log((r.stdout??'').slice(-1200));console.log((r.stderr??'').slice(-500));}
}
console.log(JSON.stringify({stages:jobs.length,failed}));process.exitCode=failed?1:0;