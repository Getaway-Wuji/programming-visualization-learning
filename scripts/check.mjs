import { checkEnvironment } from './environment.mjs';
import { run, runNode } from './process.mjs';

checkEnvironment({ bindgen: true });
runNode('scripts/build.mjs');
runNode('node_modules/typescript/bin/tsc', ['--build']);
runNode('node_modules/eslint/bin/eslint.js', ['.', '--max-warnings', '0']);
runNode('node_modules/prettier/bin/prettier.cjs', [
  '--check',
  'package.json',
  'package-lock.json',
  'tsconfig*.json',
  'vite.config.ts',
  'eslint.config.mjs',
  '.prettierrc.json',
  'web/index.html',
  'web/src',
  'scripts/*.{mjs,mts}',
  'tests',
  'content/README.md',
  'shared/fixtures/README.md',
]);
runNode('scripts/rust-check.mjs');
runNode('scripts/check-repository.mjs');
run('pwsh', ['-NoProfile', '-File', 'scripts/check-schemas.ps1']);
runNode('node_modules/vitest/vitest.mjs', ['run', '--config', 'tests/vitest.config.ts']);
runNode('scripts/startup-check.mjs');
runNode('node_modules/@playwright/test/cli.js', ['test', '--config', 'tests/playwright.config.ts']);
console.log(
  'Engineering quality checks passed. This does not accept interpreter/learning behavior.',
);
