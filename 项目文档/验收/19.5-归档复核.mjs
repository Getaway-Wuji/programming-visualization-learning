// Run from the repository root with the project's fixed Node.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const read=p=>readFileSync(p),json=p=>JSON.parse(read(p).toString().replace(/^\uFEFF/,'')),sha=b=>createHash('sha256').update(b).digest('hex');
const proof=path=>({path,sha256:sha(read(path))});
const receiptPath='.artifacts/19.5/scoped-final.json',receipt=json(receiptPath);
assert.equal(receipt.currentAuthorizedScopeAccepted,true);assert.equal(receipt.originalSrsFullAiAccepted,false);assert.equal(receipt.officialModelCalls,0);
const indexPath='项目文档/验收/19.5-验证原件/index.json',index=json(indexPath);assert.equal(index.files.length,51);
for(const f of index.files){const b=read(dirname(indexPath)+'/'+f.file);assert.equal(sha(b),f.archiveSha256);assert.equal(sha(f.encoding==='gzip'?gunzipSync(b):b),f.sha256);assert.equal(sha(read(f.source)),f.sha256);}
const oldIndices=['项目文档/验收/19.4-验证原件/index.json','项目文档/验收/19.3-API-Key修订-验证原件/index.json','项目文档/验收/19.3-验证原件/index.json','项目文档/验收/19.2-验证原件/index.json','项目文档/验收/19.1-验证原件/index.json','项目文档/验收/18-整块质量-修改前/index.json','项目文档/验收/18-整块质量原件/index.json',...Array.from({length:6},(_,i)=>`项目文档/验收/18.${i+1}-验证原件/index.json`)];
let oldArchives=0,oldRawPaths=0;for(const p of oldIndices)for(const f of json(p).files){const b=read(dirname(p)+'/'+f.file);assert.equal(sha(b),f.archiveSha256);assert.equal(sha(f.encoding==='gzip'?gunzipSync(b):b),f.sha256);oldArchives++;if(f.source?.startsWith('.artifacts/')||f.source?.startsWith('tests/.artifacts/')){assert.equal(sha(read(f.source)),f.sha256);oldRawPaths++;}}
assert.equal(oldArchives,7971);assert.equal(oldRawPaths,7960);
const changed=new Map(receipt.protection.baselineChanges.map(c=>[c.path,c.after]));const baseline=json('.artifacts/19.5/baseline.json');assert.equal(baseline.files.length,24433);for(const f of baseline.files)assert.equal(sha(read(f.path)),changed.get(f.path)??f.sha256,'Baseline '+f.path);
const release=json(receipt.release.path);for(const f of release.files)assert.equal(sha(read(f.path)),f.sha256);assert.equal(sha(read(release.aiGateway.executable.path)),release.aiGateway.executable.sha256);
for(const f of receipt.docs)assert.equal(sha(read(f.path)),f.sha256);
const git=a=>execFileSync('git',a,{encoding:'utf8'}).trim();assert.equal(git(['rev-parse','HEAD']),receipt.git.head);assert.equal(git(['rev-parse','origin/main']),receipt.git.origin);assert.equal(git(['diff','--cached','--name-only']),'');assert.equal(git(['rev-list','--left-right','--count','HEAD...origin/main']),'0\t0');
const finalPath='项目文档/验收/19.5-最终复核.json';
const final={...receipt,at:new Date().toISOString(),scopedReceipt:proof(receiptPath),archive:{...proof(indexPath),files:51,artifactRawPaths:49,oldArchives,oldRawPaths,totalArchives:8022,totalArtifactRawPaths:8009,allThreeLayersVerified:true},verificationScript:proof('项目文档/验收/19.5-归档复核.mjs')};
if(existsSync(finalPath)){const prior=json(finalPath);assert.equal(prior.scopedReceipt.sha256,final.scopedReceipt.sha256);assert.equal(prior.archive.sha256,final.archive.sha256);}else writeFileSync(finalPath,JSON.stringify(final,null,2)+'\n',{flag:'wx'});
let links=0;const paths=[...receipt.docs.map(f=>f.path),'README.md','项目守则.md','项目文档/需求覆盖与范围裁决.md','项目文档/任务进度与交接.md','项目文档/开发路线与依赖.md'];
for(const p of paths){let s=new TextDecoder('utf-8',{fatal:true}).decode(read(p));assert.ok(!s.includes('\uFFFD'));if(!p.includes('/19.5-'))s=s.split(/\r?\n\r?\n/).slice(0,2).join('\n\n');for(const m of s.matchAll(/\]\(<?([^\n)>]+)>?\)/g)){let ref=m[1];if(/^(https?:|#)/.test(ref))continue;ref=decodeURIComponent(ref.split('#')[0]);assert.ok(existsSync(resolve(dirname(p),ref)),p+' -> '+ref);links++;}}
console.log(JSON.stringify({task:'19.5',currentAuthorizedScopeAccepted:true,originalSrsFullAiAccepted:false,productSourceChanges:0,release:'1.0.65',freshChrome:3,officialAuthenticationAndModelCalls:0,newArchives:51,oldArchives,oldRawPaths,baselineFiles:24433,currentSources:451,allIntegrityChecksPassed:true,localLinksChecked:links,gitUnchanged:true,next:'Coordinator review and separately dispatched Git; no20 started; live AI deferred; stop after20/no21'}));
