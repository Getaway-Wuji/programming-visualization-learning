import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync,mkdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {basename} from 'node:path';
const dir='.artifacts/16.10',archive='项目文档/验收/16.10-验证原件';
const read=p=>readFileSync(p),sha=b=>createHash('sha256').update(b).digest('hex'),proof=path=>({path,bytes:statSync(path).size,sha256:sha(read(path))});
const save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
assert.equal(existsSync(archive+'/index.json'),false);mkdirSync(archive,{recursive:true});
const files=new Map(),localOnly=[];
const add=(path,origin)=>{if(/\.(?:pfx|p12)$/i.test(path)||/conditions-local-tls[^/]*\.json$/i.test(path))return;if(path.endsWith('.zip')){localOnly.push({...proof(path),origin});return;}if(path.endsWith('-trace.json')&&existsSync(path+'.gz'))return;if(!files.has(path))files.set(path,origin);};
const walk=(path,visit)=>{if(!existsSync(path))return;for(const e of readdirSync(path,{withFileTypes:true})){if(e.isSymbolicLink())continue;const p=path+'/'+e.name;if(e.isDirectory())walk(p,visit);else if(e.isFile())visit(p);}};
for(const e of readdirSync(dir,{withFileTypes:true})){
 if(['clean-workspace','delivery-workspace','node_modules','.tools'].includes(e.name))continue;
 if(/^STATE(?:-\d+)?\.md$/.test(e.name)||/^r1610-collect47(?:-[^.]+)?\.(?:log|exit)$/.test(e.name))continue;
 const p=dir+'/'+e.name;if(e.isDirectory())walk(p,q=>add(q,'root16.10'));else if(e.isFile())add(p,'root16.10');
}
for(const root of [dir+'/clean-workspace/.artifacts',dir+'/clean-workspace/tests/.artifacts'])
 walk(root,p=>{if(p.includes('r1610-'))add(p,'owned isolated browser evidence');});
walk('.artifacts/11.4',p=>{if(/receive-micro-r1610-[^/]+\.json$/.test(p))add(p,'owned unit receive measurement');});
const baseline=JSON.parse(read(dir+'/baseline.json'));
const unitReports=readdirSync(dir).filter(n=>/^r1610-[^/]+\.json$/.test(n)).map(n=>({label:n,r:JSON.parse(read(dir+'/'+n))})).filter(v=>Array.isArray(v.r.testResults));
const legacyUnitRaw=[];
for(const name of readdirSync('.artifacts/14.4')){
 if(!/^memory-bug-(?:execution|raw)-[0-9]{13}\.json(?:\.gz)?$/.test(name))continue;
 const path='.artifacts/14.4/'+name,at=Number(name.match(/[0-9]{13}/)[0]);
 if(at<Date.parse(baseline.createdAtUtc))continue;
 const match=unitReports.map(({label,r})=>({label,suite:r.testResults?.find(t=>t.name.endsWith('/memory-bugs.test.ts'))})).filter(x=>x.suite).sort((a,b)=>Math.abs(a.suite.endTime-at)-Math.abs(b.suite.endTime-at))[0];
 assert.ok(match&&Math.abs(match.suite.endTime-at)<10000,path);
 legacyUnitRaw.push({path,report:match.label,at,deltaMs:match.suite.endTime-at});add(path,'early unit unique numeric capture; mapped by actual suite end time');
}
// Public certificate only. Never copy the private PFX or password metadata.
const cer=dir+'/clean-workspace/.artifacts/11.4/conditions-local-tls.cer';if(existsSync(cer))add(cer,'public ephemeral test certificate');
const entries=[];let n=0;
for(const [path,origin] of [...files].sort(([a],[b])=>a.localeCompare(b))){
 const original=read(path),compress=original.length>131072&&/\.(?:json|jsonl|log|md|txt|trace|network|stacks|har)$/i.test(path);
 const bytes=compress?gzipSync(original):original;
 const file=String(++n).padStart(5,'0')+'-'+basename(path)+(compress?'.gz':/\.log$/i.test(path)?'.txt':'');
 writeFileSync(archive+'/'+file,bytes,{flag:'wx'});
 const entry={file,source:path,origin,encoding:compress?'gzip':'identity',bytes:bytes.length,sha256:sha(bytes),originalBytes:original.length,originalSha256:sha(original)};
 if(path.endsWith('-trace.json.gz')&&existsSync(path.slice(0,-3))){const raw=read(path.slice(0,-3));assert.equal(sha(gunzipSync(original)),sha(raw),path);entry.packedTrace={source:path.slice(0,-3),bytes:raw.length,sha256:sha(raw),exactOriginalStream:true};}
 entries.push(entry);
}
for(const e of entries){const bytes=read(archive+'/'+e.file);assert.equal(sha(bytes),e.sha256);assert.equal(sha(e.encoding==='gzip'?gunzipSync(bytes):bytes),e.originalSha256);}
save(archive+'/index.json',{task:'16.10',release:'1.0.47',createdAtUtc:new Date().toISOString(),entries,localOnly,legacyUnitRaw,exclusions:['whole source workspaces and installation/build caches','private PFX/P12 and certificate password metadata','large plain CDP trace when exact gzip is indexed','internal STATE checkpoints','this collector active log'],boundary:'Original failures and successful actual captures retained. gzip entries have both stored and original byte digests. Local-only ZIPs are not part of repository shipping. This archive does not turn inherited Rust, candidate learning, diagnostics or failed performance into current formal acceptance.'});
console.log(JSON.stringify({archive,entries:entries.length,localOnlyZips:localOnly.length,legacyUniqueUnitRaw:legacyUnitRaw.length}));
