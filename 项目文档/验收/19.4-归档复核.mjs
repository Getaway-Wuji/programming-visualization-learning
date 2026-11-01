// Run from the repository root with the fixed Node. Read-only except for the final receipt.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const read=p=>readFileSync(p),json=p=>JSON.parse(read(p).toString().replace(/^\uFEFF/,'')),sha=b=>createHash('sha256').update(b).digest('hex');
const proof=path=>({path,sha256:sha(read(path))});
const engineeringPath='.artifacts/19.4/engineering-final.json',engineering=json(engineeringPath);
const indexPath='项目文档/验收/19.4-验证原件/index.json',index=json(indexPath),folder=dirname(indexPath);
assert.equal(index.files.length,877);
for(const f of index.files){const b=read(folder+'/'+f.file);assert.equal(sha(b),f.archiveSha256,f.file);assert.equal(sha(f.encoding==='gzip'?gunzipSync(b):b),f.sha256);assert.equal(sha(read(f.source)),f.sha256,'Changed current raw '+f.source);}
for(const f of engineering.docs)assert.equal(sha(read(f.path)),f.sha256);
const protect=json(engineering.protection.path);assert.equal(sha(read(engineering.protection.path)),engineering.protection.sha256);
const changes=new Map(protect.changed.map(f=>[f.path,f.after]));
const baseline=json('.artifacts/19.4/baseline.json');for(const f of baseline.files)assert.equal(sha(read(f.path)),changes.get(f.path)??f.sha256,'Changed baseline after protection audit '+f.path);
const reg=json(engineering.release.path);for(const f of reg.files)assert.equal(sha(read(f.path)),f.sha256);
const priorIndices=['项目文档/验收/19.3-API-Key修订-验证原件/index.json','项目文档/验收/19.3-验证原件/index.json','项目文档/验收/19.2-验证原件/index.json','项目文档/验收/19.1-验证原件/index.json','项目文档/验收/18-整块QA维护前-验证原件/index.json'];
// Use the same complete historical index set as the frozen protection audit.
const oldIndices=['项目文档/验收/19.3-API-Key修订-验证原件/index.json','项目文档/验收/19.3-验证原件/index.json','项目文档/验收/19.2-验证原件/index.json','项目文档/验收/19.1-验证原件/index.json','项目文档/验收/18-整块质量-修改前/index.json','项目文档/验收/18-整块质量原件/index.json',...Array.from({length:6},(_,i)=>`项目文档/验收/18.${i+1}-验证原件/index.json`)];
let oldArchives=0,oldRawPaths=0;for(const p of oldIndices){for(const f of json(p).files){const b=read(dirname(p)+'/'+f.file);assert.equal(sha(b),f.archiveSha256);assert.equal(sha(f.encoding==='gzip'?gunzipSync(b):b),f.sha256);oldArchives++;if(f.source?.startsWith('.artifacts/')||f.source?.startsWith('tests/.artifacts/')){assert.equal(sha(read(f.source)),f.sha256);oldRawPaths++;}}}
assert.equal(oldArchives,7094);assert.equal(oldRawPaths,7090);
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();assert.equal(git(['rev-parse','HEAD']),engineering.git.head);assert.equal(git(['rev-parse','origin/main']),engineering.git.origin);assert.equal(git(['diff','--cached','--name-only']),'');assert.equal(git(['rev-list','--left-right','--count','HEAD...origin/main']),'0\t0');
const finalPath='项目文档/验收/19.4-最终复核.json';
const final={...engineering,at:new Date().toISOString(),engineeringReceipt:proof(engineeringPath),archive:{...proof(indexPath),files:index.files.length,artifactRawPaths:index.files.filter(f=>f.source.startsWith('.artifacts/')||f.source.startsWith('tests/.artifacts/')).length,allThreeLayersVerified:true,oldArchives,oldRawPaths,totalArchives:oldArchives+index.files.length,liveStartupLogException:index.exclusions},verificationScript:proof('项目文档/验收/19.4-归档复核.mjs')};
if(existsSync(finalPath)){const existing=json(finalPath);assert.equal(existing.engineeringReceipt.sha256,final.engineeringReceipt.sha256);assert.equal(existing.archive.sha256,final.archive.sha256);}else writeFileSync(finalPath,JSON.stringify(final,null,2)+'\n',{flag:'wx'});
const docs=[...engineering.docs.map(f=>f.path),'README.md','项目守则.md','项目文档/任务进度与交接.md','项目文档/开发路线与依赖.md','项目文档/需求覆盖与范围裁决.md'];
let links=0;for(const path of docs){let s=new TextDecoder('utf-8',{fatal:true}).decode(read(path));assert.ok(!s.includes('\uFFFD'));if(!path.includes('/19.4-'))s=s.slice(0,s.indexOf('下方旧记录保留历史时点。')+'下方旧记录保留历史时点。'.length);for(const m of s.matchAll(/\]\(<?([^\n)>]+)>?\)/g)){let ref=m[1];if(/^(https?:|#)/.test(ref))continue;ref=decodeURIComponent(ref.split('#')[0]);assert.ok(existsSync(resolve(dirname(path),ref)),path+' -> '+ref);links++;}}
console.log(JSON.stringify({task:'19.4',independentEngineeringComplete:true,taskAccepted:false,release:'1.0.65',sources:451,frontend:2138,formalChrome:24,currentRegressionChrome:21,proxyRust:12,officialModelCalls:0,newArchives:index.files.length,oldArchives,oldRawPaths,allBaselineAndArchiveAndCurrentSourcesVerified:true,localLinksChecked:links,gitStageEmpty:true,noCommitsOrPushes:true}));
