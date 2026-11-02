import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const paths = execFileSync('git', ['ls-files', '-z'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
  .split('\0')
  .filter(Boolean);
const blocked = (path) =>
  /^(?:\.agents|\.codex|\.taste-skill|\.tools|\.artifacts|项目文档|node_modules|target|test-results|playwright-report|c\+\+ 资源)\//.test(
    path,
  ) ||
  /(?:^|\/)(?:AGENTS|SKILL)\.md$/.test(path) ||
  /^(?:skills-lock\.json|项目守则\.md)$/.test(path) ||
  /\.(?:pdf|log|tmp|bak|tsbuildinfo)$/i.test(path) ||
  /(?:交接|任务包|任务进度)/.test(path) ||
  (/^scripts\//.test(path) &&
    ((/evidence/.test(path) && path !== 'scripts/verify-vertical-evidence.mts') ||
      /^scripts\/(?:register-|author-|p05-0|p05-10|phase3-|phase2-clean-source|check-release-archives|p1-contracts|cbook-)/.test(
        path,
      ) ||
      /-release-inputs\.mjs$/.test(path)));
const invalid = paths.filter(blocked);
assert.equal(
  invalid.length,
  0,
  `Local AI work files must not be committed:\n${invalid.join('\n')}`,
);
console.log(`Repository scope: ${paths.length} tracked files checked; no local AI work files.`);
