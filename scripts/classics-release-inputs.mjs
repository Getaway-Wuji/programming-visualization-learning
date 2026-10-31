import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.43.json', 'utf8'));
export const classicsPaths = [
  ...new Set([
    ...prior.files.map((f) => f.path),
    'content/algorithms/cpp/classics-1.0.0.json',
    ...['hanoi', 'euclidean-gcd', 'trial-division-prime', 'palindrome-number'].map(
      (n) => `content/algorithms/cpp/${n}-1.0.0.cpp`,
    ),
    ...[
      'content.ts',
      'controller.ts',
      'presentation.ts',
      'ClassicState.tsx',
      'ClassicCatalog.tsx',
      'ClassicPage.tsx',
      'classics.css',
    ].map((n) => `web/src/classics/${n}`),
    'scripts/classics-content.mjs',
    'scripts/classics-release-inputs.mjs',
    '项目文档/契约/16.9-C++经典案例与汉诺塔存储.md',
  ]),
];
