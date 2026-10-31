// Only move newly created files from this invocation's fresh label. Old files are untouched.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync,mkdirSync,renameSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.'),label='regression-consumers39',report=JSON.parse(readFileSync(`.artifacts/16.4/${label}.json`)),started=Date.parse(report.stats.startTime),entries=[];
assert.equal(report.stats.expected,3);assert.equal(report.stats.unexpected,0);
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(resolve(path,entry.name)):[resolve(path,entry.name)]);
for(const task of ['16.2','16.3']){
  const allowedParent=resolve(root,`.artifacts/${task}/browser`),source=resolve(allowedParent,label),targetRoot=resolve(root,'.artifacts/16.4/compatibility'),target=resolve(targetRoot,task,label);
  assert.ok(source.startsWith(allowedParent+sep)&&relative(allowedParent,source)===label);
  assert.ok(target.startsWith(targetRoot+sep)&&targetRoot.startsWith(root+sep));assert.equal(existsSync(target),false);
  const files=walk(source).map(path=>{const stat=statSync(path);assert.ok(stat.birthtimeMs>=started-2000&&stat.mtimeMs>=started-2000,`Not created by this invocation: ${path}`);return {from:relative(root,path).replaceAll('\\','/'),to:relative(root,resolve(target,relative(source,path))).replaceAll('\\','/'),bytes:stat.size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};});
  mkdirSync(dirname(target),{recursive:true});renameSync(source,target);
  for(const item of files)assert.equal(createHash('sha256').update(readFileSync(resolve(root,item.to))).digest('hex'),item.sha256);
  entries.push(...files);
}
writeFileSync('.artifacts/16.4/compatibility-relocation.json',JSON.stringify({label,reason:'Old comparison/snapshot test modules use their historical hardcoded evidence folders. These newly generated label-only files were moved with exact byte hashes into16.4; earlier task files/tests/indexes were not changed.',entries},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({relocatedOwnFiles:entries.length,priorFilesChanged:0}));
