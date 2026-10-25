import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { workspaceDir } from './process.mjs';

export function checkEnvironment({ bindgen = false } = {}) {
  if (process.version !== 'v24.21.0') throw new Error('Use Node 24.21.0 via scripts/task.ps1.');
  const npmVersion = JSON.parse(
    readFileSync(
      new URL('../.tools/node-v24.21.0-win-x64/node_modules/npm/package.json', import.meta.url),
      'utf8',
    ),
  ).version;
  if (npmVersion !== '11.19.0') throw new Error('npm 11.19.0 is required.');
  const versions = { node: process.version, npm: npmVersion };
  for (const tool of ['rustc', 'cargo']) {
    const version = execFileSync(tool, ['+1.99.0', '--version'], {
      cwd: workspaceDir,
      encoding: 'utf8',
    }).trim();
    if (!version.startsWith(`${tool} 1.99.0 `)) throw new Error(`${tool} 1.99.0 is required.`);
    versions[tool] = version;
  }
  if (bindgen) {
    const executable = fileURLToPath(
      new URL('../.tools/wasm-bindgen/bin/wasm-bindgen.exe', import.meta.url),
    );
    const version = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim();
    if (version !== 'wasm-bindgen 0.2.129') throw new Error('wasm-bindgen 0.2.129 is required.');
    versions.bindgen = version;
  }
  return versions;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(checkEnvironment({ bindgen: true }));
