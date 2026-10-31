import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='.artifacts/16.10',read=p=>readFileSync(p),sha=b=>createHash('sha256').update(b).digest('hex');
const json=p=>JSON.parse(read(p).toString().replace(/^\uFEFF/,''));
const proof=p=>({path:p,bytes:read(p).length,sha256:sha(read(p))});
const labels=['r1610-core-formal-first','r1610-combined-first','r1610-combined-second','r1610-combined-third','r1610-native-first','r1610-native-fixes','r1610-cpp-formal-first'];
const flatten=suites=>suites.flatMap(s=>[...(s.specs??[]),...flatten(s.suites??[])]);
const passed=new Map(),failures=[],reports=[];
for(const label of labels){const path=`${dir}/${label}.json`,r=json(path);assert.deepEqual(r.errors,[]);assert.equal(r.stats.skipped+r.stats.flaky,0);reports.push({...proof(path),stats:r.stats});for(const spec of flatten(r.suites)){assert.equal(spec.tests.length,1);const test=spec.tests[0];assert.equal(test.projectName,'chrome');assert.equal(test.results.length,1);assert.equal(test.results[0].retry,0);const key=`${spec.file.split(/[\\/]/).at(-1)}:${spec.title}`;if(test.results[0].status==='passed')passed.set(key,{report:label,file:spec.file,title:spec.title});else failures.push({key,report:label,status:test.results[0].status});}}
for(const item of failures){assert.ok(passed.has(item.key),item.key);item.recheckedIn=passed.get(item.key).report;}
assert.equal(passed.size,281);
const units=json(`${dir}/r1610-units-fifth.json`);assert.equal(units.numTotalTests,1838);assert.equal(units.numPassedTests,1838);assert.equal(units.numFailedTests+units.numPendingTests,0);
const releasePath='content/c/p0/blockly-release-1.0.45.json',release=json(releasePath);assert.equal(release.files.length,299);
for(const f of release.files){assert.equal(sha(read(f.path)),f.sha256,f.path);assert.equal(sha(read(`${dir}/clean-workspace/${f.path}`)),f.sha256,f.path);}
const engines=json(`${dir}/inherited-engines.json`);for(const f of [...engines.protectedFiles,...engines.wasm])assert.equal(sha(read(f.path)),f.sha256,f.path);for(const f of engines.wasm)assert.equal(sha(read(`${dir}/clean-workspace/${f.path}`)),f.sha256,f.path);
const result={task:'16.10',atUtc:new Date().toISOString(),registration:proof(releasePath),sources:299,frontend:{passed:1838,report:proof(`${dir}/r1610-units-fifth.json`),semanticAdapter:'Memory Bug now and timer both controlled; real Rust/full inverse retained. Actual deadlines are separate native browser evidence.'},browser:{uniquePassed:281,retries:0,skipped:0,browser:'Chrome156.0.8078.76',theme:'minimal',reports,passed:[...passed.values()],failureReview:failures,notOneAllGreenBatch:true},rust:{passed:engines.rustPassed,originalIgnored:engines.originalIgnored,fullSuiteRerun:false,proof:proof(`${dir}/inherited-engines.json`)},unchangedThreeWasm:engines.wasm,performanceStatus:'Formal qualified measurement and playback pending; functional gates alone are not overall P1 acceptance.'};
writeFileSync(`${dir}/functional-gates.json`,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({frontend:1838,uniqueBrowser:281,failuresResolved:failures.length,formalPerformancePending:true}));
