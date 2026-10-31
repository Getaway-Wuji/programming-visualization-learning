// Only move this task's fresh-label evidence, after verifying absolute bounds and creation time.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync,mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.'),label=process.argv[2],task=process.argv[3],report=JSON.parse(readFileSync(`.artifacts/16.5/${label}.json`)),started=Date.parse(report.stats.startTime),entries=[];
assert.match(label,/^r165-/);assert.ok(['16.2','16.3','16.4'].includes(task));assert.equal(report.stats.unexpected+report.stats.flaky+report.stats.skipped,0);
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(path,e.name)):[resolve(path,e.name)]);
const allowedParent=resolve(root,`.artifacts/${task}/browser`),source=resolve(allowedParent,label),targetRoot=resolve(root,'.artifacts/16.5/compatibility'),target=resolve(targetRoot,task,label);
assert.ok(source.startsWith(allowedParent+sep)&&relative(allowedParent,source)===label);assert.ok(target.startsWith(targetRoot+sep)&&targetRoot.startsWith(root+sep));assert.equal(existsSync(target),false);
for(const path of walk(source)){const stat=statSync(path);assert.ok(stat.birthtimeMs>=started-2000&&stat.mtimeMs>=started-2000,path);entries.push({from:relative(root,path).replaceAll('\\','/'),to:relative(root,resolve(target,relative(source,path))).replaceAll('\\','/'),bytes:stat.size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}
mkdirSync(dirname(target),{recursive:true});renameSync(source,target);
for(const item of entries)assert.equal(createHash('sha256').update(readFileSync(resolve(root,item.to))).digest('hex'),item.sha256);
writeFileSync(`.artifacts/16.5/relocation-${task}-${label}.json`,JSON.stringify({label,task,reason:'Only this16.5 invocation label was newly created by the inherited test module; move verified own evidence into16.5. Earlier files remain untouched.',entries},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({relocatedOwnFiles:entries.length,priorFilesChanged:0}));
