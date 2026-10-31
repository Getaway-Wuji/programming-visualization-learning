import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const dir='.artifacts/16.5',label='r165-formal40',read=path=>readFileSync(path),json=path=>JSON.parse(read(path)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const registration=json('content/c/p0/blockly-release-1.0.40.json'),catalog=json('content/algorithms/cpp/recursive-sorts-1.0.0.json'),rows=[],pairs=[];
function inspect(path,scope,sample){
  const raw=JSON.parse(gunzipSync(read(path))),request=JSON.parse(Buffer.from(raw.requestBase64,'base64')),bytes=Buffer.from(raw.responseBase64,'base64'),result=JSON.parse(bytes);
  const spec=catalog.cases.find(c=>read(c.sourceFile).toString().replace('{{n}}',String(request.input.length))===request.source);
  assert.ok(spec);assert.equal(raw.terminated,true);assert.equal(request.language,'cpp');assert.equal(result.language,'cpp');assert.equal(request.engineId,'engine.rust.p1');assert.equal(result.engine.buildId,registration.algorithmEngine.wasmSha256);assert.equal(result.terminal.status,'completed');assert.equal(result.trace.completeness,'complete');assert.ok(request.input.length<=30&&request.input.every(v=>Number.isInteger(v)&&v>=-999&&v<=999));
  let counters=result.trace.initialState.counters,inputCursor=0,maxFrames=0,maxLiveBytes=0,aliasRecords=0,scratchObjects=0;const frames=new Set();
  for(const step of result.trace.steps)for(const change of step.changes){
    if(change.op==='counters')counters=change.after;
    if(change.op==='control')inputCursor=change.after.inputCursor;
    if(change.op==='allocator')maxLiveBytes=Math.max(maxLiveBytes,change.after.liveBytes);
    if(change.op==='record'&&change.table==='frames'){if(change.after)frames.add(change.id);else frames.delete(change.id);maxFrames=Math.max(maxFrames,frames.size);}
    if(change.op==='record'&&change.table==='scopes'&&change.after)aliasRecords+=change.after.aliases.length;
    if(change.op==='record'&&change.table==='objects'&&!change.before&&change.after?.name==='scratch')scratchObjects++;
  }
  const output=result.trace.steps.flatMap(s=>s.changes.filter(c=>c.op==='output').map(c=>c.append)).join('');
  assert.equal(output,[...request.input].sort((a,b)=>a-b).map(v=>`${v} `).join('')+'\n');assert.equal(inputCursor,request.input.length);assert.ok(maxFrames<=7&&aliasRecords>0);assert.equal(scratchObjects,spec.id.endsWith('merge-sort')?1:0);assert.ok(maxLiveBytes<=1048576&&result.trace.steps.length<=20000&&result.stats.fuelUsed<1000000&&bytes.length<=16777216);
  rows.push({scope,sample,caseId:spec.id,caseVersion:spec.version,programId:spec.programId,programVersion:spec.programVersion,language:result.language,engine:result.engine,identity:result.identity,input:request.input,sourceFile:spec.sourceFile,sourceSha256:sha(request.source),steps:result.trace.steps.length,checkpoints:result.trace.checkpoints.length,resultBytes:bytes.length,fuelUsedBeforeFinalEncoding:result.stats.fuelUsed,maxFrames,maxLiveBytes,aliasRecords,scratchObjects,finalCounters:counters,output,worker:{path,sha256:sha(read(path))}});
}
const single=`${dir}/browser/${label}`;
for(const name of readdirSync(single).filter(n=>n.startsWith('case.cpp.')&&n.endsWith('-summary.json'))){const summary=json(`${single}/${name}`);inspect(`${single}/${name.replace('-summary.json','-worker.json.gz')}`,'independent',name.slice(summary.caseId.length+1,-'-summary.json'.length));}
assert.equal(rows.length,16);
const pair=`${dir}/pair-browser/${label}`;
for(const name of readdirSync(pair).filter(n=>n.endsWith('-summary.json'))){const sample=name.replace('-summary.json',''),summary=json(`${pair}/${name}`);assert.equal(summary.probe.max,1);assert.equal(summary.probe.active,0);assert.equal(summary.probe.posts.length,2);assert.ok(summary.probe.posts[1].remainingMs<summary.probe.posts[0].remainingMs);assert.ok(Math.abs(summary.probe.posts[0].at+summary.probe.posts[0].remainingMs-summary.probe.posts[1].at-summary.probe.posts[1].remainingMs)<5);assert.equal(summary.storesUnchanged,true);for(const i of [0,1])inspect(`${pair}/${sample}-${i}.json.gz`,'paired',sample);assert.notEqual(rows.at(-1).identity.runId,rows.at(-2).identity.runId);assert.deepEqual(rows.at(-1).input,rows.at(-2).input);pairs.push({sample,...summary});}
assert.equal(rows.length,32);assert.equal(pairs.length,8);
writeFileSync(`${dir}/real-sort-summary.json`,JSON.stringify({runs:32,independent:16,paired:16,pairGroups:8,scope:'Formal40 production Chrome native Worker captures. Actual same displayed C++ source and unchanged Rust build, full accepted results; no frontend execution.',rows,pairs},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runs:32,pairGroups:8,capacity:rows.filter(r=>r.input.length===30).map(({scope,sample,caseId,steps,resultBytes,maxFrames,maxLiveBytes,finalCounters})=>({scope,sample,caseId,steps,resultBytes,maxFrames,maxLiveBytes,finalCounters}))}));
