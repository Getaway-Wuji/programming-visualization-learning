import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const workspaceDir = fileURLToPath(new URL('../', import.meta.url));

export function run(command, args = []) {
  const result = spawnSync(command, args, { cwd: workspaceDir, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}.`);
}

export function runNode(relativePath, args = []) {
  run(process.execPath, [
    fileURLToPath(new URL(relativePath, new URL('../', import.meta.url))),
    ...args,
  ]);
}
