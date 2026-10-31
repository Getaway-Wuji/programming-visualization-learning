import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const folder='.artifacts/16.4/browser/formal-sorts-39',read=path=>readFileSync(path),json=path=>JSON.parse(read(path)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const registration=json('content/c/p0/blockly-release-1.0.39.json'),catalog=json('content/algorithms/cpp/iterative-sorts-1.0.0.json'),rows=[];
for(const name of readdirSync(folder).filter(name=>name.startsWith('case.cpp.')&&name.endsWith('-summary.json'))){
  const summary=json(`${folder}/${name}`),workerPath=`${folder}/${name.replace('-summary.json','-worker.json.gz')}`,worker=JSON.parse(gunzipSync(read(workerPath))),request=JSON.parse(Buffer.from(worker.requestBase64,'base64')),bytes=Buffer.from(worker.responseBase64,'base64'),result=JSON.parse(bytes),spec=catalog.cases.find(spec=>spec.id===summary.caseId);
  assert.ok(spec);assert.equal(worker.moduleSeen,true);assert.equal(worker.terminated,true);assert.equal(result.language,'cpp');assert.equal(result.engine.buildId,registration.algorithmEngine.wasmSha256);assert.equal(result.terminal.status,'completed');
  assert.equal(request.source,read(spec.sourceFile).toString().replace('{{n}}',String(request.input.length)));assert.deepEqual(request.input,summary.input);assert.ok(request.input.length<=30&&request.input.every(n=>n>=spec.min&&n<=spec.max));
  const counters=result.trace.steps.flatMap(step=>step.changes.filter(change=>change.op==='counters')).at(-1)?.after??result.trace.initialState.counters;
  const output=result.trace.steps.flatMap(step=>step.changes.filter(change=>change.op==='output').map(change=>change.append)).join('');
  const inputCursor=result.trace.steps.flatMap(step=>step.changes.filter(change=>change.op==='control')).at(-1).after.inputCursor;
  assert.equal(output,summary.expected.map(n=>`${n} `).join('')+'\n');assert.equal(inputCursor,request.input.length);assert.ok(result.trace.steps.length<=20000&&result.stats.fuelUsed<1000000&&bytes.length<=16777216);
  rows.push({caseId:spec.id,caseVersion:spec.version,programId:spec.programId,programVersion:spec.programVersion,sample:name.slice(spec.id.length+1,-'-summary.json'.length),language:result.language,engine:result.engine,identity:result.identity,sourceSha256:sha(request.source),input:request.input,output,steps:result.trace.steps.length,checkpoints:result.trace.checkpoints.length,resultBytes:bytes.length,fuelUsedBeforeFinalEncoding:result.stats.fuelUsed,finalCounters:counters,sourceFile:spec.sourceFile,worker:{path:workerPath,sha256:sha(read(workerPath))}});
}
assert.equal(rows.length,18);
writeFileSync('.artifacts/16.4/real-sort-summary.json',JSON.stringify({runs:18,scope:'Formal production Chrome Worker captures; default/empty/single/duplicates/domain-ends/capacity-reverse for each of3 cases. No original trace or metadata modified.',rows},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({runs:rows.length,capacity:rows.filter(row=>row.input.length===30).map(({caseId,steps,resultBytes,finalCounters})=>({caseId,steps,resultBytes,finalCounters}))}));
