import { describe, expect, it } from 'vitest';
import { isLocalWorkFile } from '../../scripts/check-repository.mjs';

describe('repository upload boundary', () => {
  it.each([
    '.agents/skills/example/SKILL.md',
    '.codex/settings.json',
    '.taste-skill/references/example.json',
    'AGENTS.md',
    'nested/SKILL.md',
    'skills-lock.json',
    '项目文档/任务进度与交接.md',
    'c++ 资源/C+Primer+Plus第六版+中文版(1).pdf',
    '.artifacts/raw.json',
    'scripts/c6-register-69.mjs',
    'scripts/c6-register-999.mjs',
    'scripts/c6-quality.mjs',
    'scripts/c6-build-wasm.mjs',
    'scripts/c6-course/register-70.mjs',
    'scripts/c6-course/compile.py',
    'scripts/c6-course/verify-qualifiers.mjs',
    'scripts/c6-course/scope.json',
    'scripts/c6-course/manuscripts/ch01.txt',
    'scripts/c6-course/reviews/ch01.txt',
    'scripts/c6-course/design-checks/ch01.json',
    'scripts/c6-course/examples/ch11.json',
    'scripts/c6-course/exercises/ch02.json',
  ])('rejects local work even if it is force-staged: %s', (path) => {
    expect(isLocalWorkFile(path)).toBe(true);
  });

  it.each([
    'web/src/engine/c6-protocol.ts',
    'engine/c6/src/lib.rs',
    'scripts/c6-course/build-teaching-wasm.mjs',
    'scripts/c6-course/build-teaching-content.mjs',
    'scripts/c6-course/generate-teaching-schema.mjs',
    'scripts/c6-course/restore-legacy-runtime.mjs',
    'scripts/c6-browser.mjs',
    'shared/contracts/21.2-C6执行与判题.schema.json',
    'shared/fixtures/c6/21.3/judge-programs.json',
    'tests/fixtures/c6-current-browser-programs.json',
    'content/c/primer6-teaching/source-2.0.0.json',
    'README.md',
  ])('retains reproducible product/build/test inputs: %s', (path) => {
    expect(isLocalWorkFile(path)).toBe(false);
  });
});
