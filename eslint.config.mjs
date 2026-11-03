import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'target/**',
      '.tools/**',
      '.artifacts/**',
      '.agents/**',
      'web/dist/**',
      'web/src/generated/**',
      'content/engines/**',
      '项目文档/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { 'react-hooks': hooks },
    rules: { ...hooks.configs.recommended.rules },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'console',
          'process',
          'URL',
          'TextDecoder',
          'TextEncoder',
          'WebAssembly',
          'fetch',
          'setTimeout',
          'clearTimeout',
          'Buffer',
        ].map((name) => [name, 'readonly']),
      ),
    },
  },
  {
    files: ['scripts/c6-course/*.mjs'],
    languageOptions: {
      globals: { performance: 'readonly', structuredClone: 'readonly' },
    },
  },
);
