import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const localCourseTools = new Set([
  'scripts/c6-boundaries.py',
  'scripts/c6-build-review.mjs',
  'scripts/c6-build-wasm.mjs',
  'scripts/c6-edit-schema.py',
  'scripts/c6-fixtures.py',
  'scripts/c6-quality.mjs',
  ...[
    'archive-execution.mjs',
    'build-review.mjs',
    'build-wasm.mjs',
    'check-authoring.py',
    'compile.py',
    'publish.py',
    'quality.mjs',
    'read-source.py',
    'record-review.py',
    'scope.json',
    'test-compile.py',
    'test-scope.py',
    'verify-execution.mjs',
    'verify-qualifiers.mjs',
  ].map((name) => `scripts/c6-course/${name}`),
]);
export const isLocalWorkFile = (path) =>
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
      /-release-inputs\.mjs$/.test(path))) ||
  localCourseTools.has(path) ||
  /^scripts\/c6-(?:course\/)?register-\d+\.mjs$/.test(path) ||
  /^scripts\/c6-course\/(?:design-checks|examples|exercises|manuscripts|reviews)\//.test(path);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = execFileSync('git', ['ls-files', '-z'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const invalid = paths.filter(isLocalWorkFile);
  assert.equal(
    invalid.length,
    0,
    `Local AI work files must not be committed:\n${invalid.join('\n')}`,
  );
  console.log(`Repository scope: ${paths.length} tracked files checked; no local AI work files.`);
}
