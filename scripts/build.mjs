import { runNode } from './process.mjs';
import { existsSync } from 'node:fs';

const p05 = existsSync('content/c/p05/course-1.0.0.json');
if (p05) process.env.P05_COURSE_BUILD = '1';
if (p05) runNode('scripts/restore-release-evidence.mjs');

runNode('scripts/build-wasm.mjs');
runNode('scripts/build-algorithm-wasm.mjs');
runNode('scripts/build-memory-wasm.mjs');
runNode('scripts/build-content.mjs');
runNode('scripts/build-appearance.mjs');
runNode('scripts/build-teaching-presentation.mjs');
runNode('scripts/build-case-view.mjs');
runNode('scripts/build-prepared-sources.mjs');
if (p05) {
  runNode('scripts/generate-execution-schema.mjs', ['--p05', '--check']);
  runNode('scripts/build-p05-course.mjs');
}
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.config.ts']);
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'tests/browser.vite.config.ts']);
runNode('scripts/artifacts.mjs');
