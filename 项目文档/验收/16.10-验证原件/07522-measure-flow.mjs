import {createServer} from 'vite';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='.artifacts/16.10';
const source=readFileSync(dir+'/candidate46-tenth-before/execution-json.ts','utf8');

const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
try{
const before=(await server.ssrLoadModule('/'+dir+'/candidate46-tenth-before/benchmark-scanner.ts')).precheckJson;
const after=(await server.ssrLoadModule('/web/src/engine/execution-json.ts')).precheckJson;
const path='.artifacts/11.4/qa-candidate-06/regression/case-set/browser-captures/chrome/bubble-sort-maximum/result.json';
const bytes=readFileSync(path),text=bytes.toString('utf8'),rows=[];
for(let i=0;i<8;i++)for(const variant of i%2?['after','before']:['before','after']){
 const start=performance.now(),work=({before,after})[variant](text);let n=work.next(),yields=0;while(!n.done){yields++;n=work.next()};rows.push({trial:i+1,variant,ms:performance.now()-start,containers:n.value.containers,yields});
}
writeFileSync(dir+'/flow-scan-ab-second.json',JSON.stringify({path,sha256:createHash('sha256').update(bytes).digest('hex'),boundary:'Isolated same archived real Rust packet AB/BA lexical scan only; no browser acceptance.',rows},null,2)+'\n',{flag:'wx'});
console.log(rows);
}finally{await server.close()}