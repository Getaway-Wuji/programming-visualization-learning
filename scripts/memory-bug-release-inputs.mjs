import { readFileSync } from 'node:fs';
const prior = JSON.parse(readFileSync('content/c/p0/blockly-release-1.0.23.json', 'utf8'));
export const memoryBugPaths = [
  ...new Set([
    ...prior.files.map((e) => e.path),
    'content/cpp/bugs/questions-1.0.0.json',
    ...['content', 'protocol', 'authority', 'history', 'session'].map(
      (n) => `web/src/memory-bugs/${n}.ts`,
    ),
    'web/src/memory-bugs/worker.ts',
    'web/src/memory-bugs/MemoryBugPage.tsx',
    'web/src/memory-bugs/memory-bugs.css',
    'engine/memory/Cargo.toml',
    'engine/memory/src/lib.rs',
    'engine/memory/src/bug.rs',
    'engine/memory/src/runtime.rs',
    'engine/memory/src/syntax.rs',
    'engine/memory-wasm/Cargo.toml',
    'engine/memory-wasm/src/lib.rs',
    ...['memory-client', 'memory-module', 'memory-protocol', 'memory-player', 'memory-worker'].map(
      (n) => `web/src/engine/${n}.ts`,
    ),
    'web/src/memory/controller.ts',
    'web/src/memory/MemoryPanel.tsx',
    'web/src/memory/presentation.ts',
    'web/src/debug/DebugSource.tsx',
    'web/src/debug/breakpoints.ts',
    'web/src/learning/service.ts',
    'scripts/build-memory-wasm.mjs',
    'scripts/memory-bug-release-inputs.mjs',
  ]),
];
