import { spawn } from 'node:child_process';
import { once } from 'node:events';
const server = spawn(process.execPath, ['scripts/serve-checks.mjs'], { windowsHide:true, stdio:['ignore','pipe','inherit'], env:process.env });
try {
  await Promise.race([once(server.stdout, 'data'), once(server, 'exit').then(()=>{throw Error('QA server exited');})]);
  const child = spawn(process.execPath, ['.artifacts/16.5/inspect-recursive.mjs','http://127.0.0.1:4178/#/'+(process.argv[3]??'algorithms/case.cpp.merge-sort'),'--out',process.argv[2] ?? '.artifacts/16.5/taste/inspect-final','--widths','1440,768,390','--app','--allow','gradient','--json'], { windowsHide:true, stdio:'inherit', env:process.env });
  const [code] = await once(child,'exit'); process.exitCode = code ?? 1;
} finally { server.kill(); await once(server,'exit').catch(()=>{}); }
