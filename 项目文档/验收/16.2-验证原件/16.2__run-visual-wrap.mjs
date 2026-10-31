import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
await new Promise((resolve, reject) => {
  const probe = createServer(); probe.once('error', reject);
  probe.listen(4178, '127.0.0.1', () => probe.close(resolve));
});
const server = spawn(process.execPath, ['scripts/serve-checks.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', (chunk) => { serverLog += chunk; }); server.stderr.on('data', (chunk) => { serverLog += chunk; });
try {
  for (let index = 0; !serverLog.includes('http://127.0.0.1:4178'); index++) { assert.ok(index < 100 && server.exitCode === null); await delay(50); }
  assert.equal((await fetch('http://127.0.0.1:4178')).status, 200);
  mkdirSync('.artifacts/16.2/taste/inspect-wrap', { recursive: true });
  const child = spawn(process.execPath, ['.artifacts/16.2/inspect-visible-source.mjs', 'http://127.0.0.1:4178/#/compare', '--out', '.artifacts/16.2/taste/inspect-wrap', '--widths', '1440,768,390', '--app', '--allow', 'gradient', '--json'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  writeFileSync('.artifacts/16.2/inspector-output-wrap.log', output, { flag: 'wx' });
  assert.equal(code, 0, output.slice(-1500));
  const report = JSON.parse(readFileSync('.artifacts/16.2/taste/inspect-wrap/report.json', 'utf8'));
  console.log(JSON.stringify({ findings: report.findings }));
} finally {
  server.kill();
  writeFileSync('.artifacts/16.2/inspector-server-wrap.log', serverLog, { flag: 'wx' });
}
