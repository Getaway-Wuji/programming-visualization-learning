import { runNode } from './process.mjs';
import { existsSync } from 'node:fs';

const p05 = existsSync('content/c/p05/course-1.0.0.json');
if (p05) process.env.P05_COURSE_BUILD = '1';

runNode('scripts/build-wasm.mjs');
runNode('scripts/build-algorithm-wasm.mjs');
runNode('scripts/build-memory-wasm.mjs');
runNode('scripts/build-advanced-wasm.mjs');
runNode('scripts/build-practice-generator-wasm.mjs');
runNode('scripts/c6-course/restore-legacy-runtime.mjs');
runNode('scripts/c6-course/build-teaching-wasm.mjs');
runNode('scripts/build-python3-wasm.mjs');
runNode('scripts/build-java-wasm.mjs');
runNode('scripts/build-cpp-course-wasm.mjs');
runNode('scripts/build-rust2018-wasm.mjs');
runNode('scripts/build-mysql-wasm.mjs');
runNode('scripts/c6-generate-schema.mjs');
runNode('scripts/c6-course/generate-schema.mjs', ['--check']);
runNode('scripts/c6-course/generate-teaching-schema.mjs', ['--check']);
runNode('scripts/build-ai-schema.mjs');
runNode('scripts/build-content.mjs');
runNode('scripts/build-appearance.mjs');
runNode('scripts/build-teaching-presentation.mjs');
runNode('scripts/build-case-view.mjs');
runNode('scripts/build-prepared-sources.mjs');
runNode('scripts/c6-course/build-content.mjs');
runNode('scripts/c6-course/build-teaching-content.mjs');
runNode('scripts/build-python3-content.mjs');
runNode('scripts/build-java-content.mjs');
runNode('scripts/build-cpp-course-content.mjs');
runNode('scripts/build-rust2018-content.mjs');
runNode('scripts/build-mysql-content.mjs');
if (p05) {
  runNode('scripts/generate-execution-schema.mjs', ['--p05', '--check']);
  runNode('scripts/build-p05-course.mjs');
}
runNode('scripts/c6-course/build-learning-index.mjs');
runNode('scripts/c6-course/build-learning-supplements.mjs');
runNode('scripts/c6-course/build-learning-schemas.mjs');
runNode('scripts/build-learning-navigation.mjs');
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.config.ts']);
runNode('scripts/prepare-ai-gateway.mjs');
runNode('scripts/precompress.mjs');
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'tests/browser.vite.config.ts']);
runNode('scripts/artifacts.mjs');
