import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, delimiter } from 'node:path';
const [label, mode] = process.argv.slice(2);
assert.match(label ?? '', /^r1610-perf-[a-z0-9-]+$/);
assert.ok(['pilot', 'formal', 'profile', 'initialization'].includes(mode));
const workspace = resolve('.artifacts/16.10/clean-workspace'),
  output = resolve('.artifacts/16.10');
assert.equal(existsSync(resolve(output, label + '.json')), false);
const files = [
  'scripts/phase2-performance-host.mjs',
  'scripts/phase2-performance-host.d.mts',
  'tests/phase2-performance.config.ts',
  'tests/browser/phase2-performance-probe.ts',
  'tests/browser/phase2-performance.spec.ts',
];
const sources = files.map((path) => {
  copyFileSync(path, resolve(workspace, path));
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
});
const runtimeSources = [
  'web/src/content/course-bundle.ts',
  'web/src/engine/execution-client.ts',
  'web/src/engine/protocol.ts',
  'web/src/engine/execution-json.ts',
  'web/src/learning/service.ts',
  'web/src/memory-bugs/MemoryBugPage.tsx',
].map((path) => {
  const sha256 = createHash('sha256')
    .update(readFileSync(resolve(workspace, path)))
    .digest('hex');
  assert.equal(sha256, createHash('sha256').update(readFileSync(path)).digest('hex'), path);
  return { path, sha256 };
});
const generated = readFileSync(
  resolve(workspace, 'web/src/content/p05-course-release.generated.ts'),
  'utf8',
);
const candidate = /registered: false/.test(generated);
mkdirSync(resolve(workspace, '.artifacts/11.4'), { recursive: true });
if (!existsSync(resolve(workspace, '.artifacts/11.4/conditions-local-tls.cer'))) {
  const certificate = spawnSync(
    'pwsh.exe',
    ['-NoProfile', '-NonInteractive', '-File', 'scripts/performance-certificate.ps1'],
    { cwd: workspace, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(certificate.status, 0, certificate.stderr);
}
const result = spawnSync(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'tests/phase2-performance.config.ts',
    ...(mode === 'pilot'
      ? ['--grep', 'maximum-scale']
      : mode === 'profile'
        ? ['--grep', 'CPU diagnostic']
        : mode === 'initialization'
          ? ['--grep', 'archive initialization diagnostic']
          : ['--grep-invert', 'CPU diagnostic|archive initialization diagnostic']),
  ],
  {
    cwd: workspace,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ''),
      TASK_EVIDENCE_TASK: '16.10',
      TASK_EVIDENCE_LABEL: label,
      PHASE2_PERF_PILOT: mode === 'pilot' ? '1' : '0',
    },
  },
);
const localReport = resolve(workspace, `.artifacts/16.10/${label}.json`);
if (existsSync(localReport)) copyFileSync(localReport, resolve(output, label + '.json'));
writeFileSync(
  resolve(output, label + '-sources.json'),
  JSON.stringify(
    {
      task: '16.10',
      mode,
      sources,
      runtimeSources,
      candidate,
      priorRelease: '1.0.46',
      intendedRelease: '1.0.47',
      productUnchanged: false,
      generatedSha256: createHash('sha256').update(generated).digest('hex'),
      workspace,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
writeFileSync(resolve(output, label + '.log'), (result.stdout ?? '') + (result.stderr ?? ''), {
  flag: 'wx',
});
writeFileSync(resolve(output, label + '.exit'), String(result.status ?? 1) + '\n', { flag: 'wx' });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = result.status ?? 1;
