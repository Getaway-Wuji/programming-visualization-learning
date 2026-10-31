import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import assert from 'node:assert/strict';
const label=process.argv[2], dir=`.artifacts/16.3/browser/${label}`;
const rows=[];
for(const file of readdirSync(dir).filter(file=>/^cviz-.*\.(json|png)$/.test(file))){
  const bytes=readFileSync(`${dir}/${file}`); let document, width=null,height=null;
  if(file.endsWith('.json'))document=JSON.parse(bytes);
  else {
    assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    for(let at=8;at<bytes.length;){
      const n=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+n);
      assert.equal(crc32(bytes.subarray(at+4,at+8+n)),bytes.readUInt32BE(at+8+n));
      if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(width,1440);assert.ok(height<=8192);}
      const head=Buffer.from('c-viz.snapshot\0\0\0\0\0');
      if(type==='iTXt'&&data.subarray(0,head.length).equals(head)){assert.equal(document,undefined);document=JSON.parse(data.subarray(head.length));}
      at+=n+12;
    }
  }
  assert.ok(document);
  const sha=source=>createHash('sha256').update(source).digest('hex');
  assert.equal(sha(document.source.text),document.source.sha256);
  assert.equal(document.position.paused,true);
  assert.equal(document.trace,undefined);
  rows.push({path:`${dir}/${file}`,bytes:bytes.length,sha256:sha(bytes),width,height,snapshotId:document.snapshotId,origin:document.origin.id,cursor:document.position.cursor,sourceSha256:document.source.sha256,runId:document.runtime.identity.runId,frames:document.currentState.frames.length,objects:document.currentState.objects.length,unicodeSource:document.source.text.startsWith('// 中文😀\r\n')});
}
assert.equal(new Set(rows.map(r=>r.path)).size,rows.length);
assert.equal(new Set(rows.map(r=>r.snapshotId)).size,rows.length);
writeFileSync(`.artifacts/16.3/download-summary-${label}.json`,JSON.stringify({label,files:rows.length,json:rows.filter(r=>!r.width).length,png:rows.filter(r=>r.width).length,rows},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({files:rows.length,png:rows.filter(r=>r.width).length,unicode:rows.find(r=>r.width&&r.unicodeSource)?.path,deep:rows.find(r=>r.width&&r.frames===32)?.path,selected:rows.find(r=>r.width&&r.origin==='functions'&&r.frames>1)?.path}));
