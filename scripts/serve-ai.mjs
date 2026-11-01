import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const binary = resolve('server/ai-proxy/target/release/c-viz-ai-proxy.exe');
if (!existsSync(binary) || !existsSync('web/dist/ai-gateway-policy.json')) {
  console.error(
    'Build the product and AI gateway before starting: npm run build, then npm run ai:build.',
  );
  process.exit(1);
}
const args = process.argv.slice(2);
if (
  args.length % 2 ||
  args.some((arg, i) => i % 2 === 0 && !['--port', '--origin', '--base'].includes(arg))
) {
  console.error(
    'Supported nonsecret options: --port, --origin, --base. Never pass a Key to this command.',
  );
  process.exit(1);
}
const child = spawn(binary, ['--static', resolve('web/dist'), ...args], {
  stdio: 'inherit',
  windowsHide: true,
});
for (const event of ['SIGINT', 'SIGTERM']) process.on(event, () => child.kill());
child.on('error', () => {
  console.error('The AI gateway could not start.');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
