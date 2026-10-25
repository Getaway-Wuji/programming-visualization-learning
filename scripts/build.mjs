import { runNode } from './process.mjs';

runNode('scripts/build-wasm.mjs');
runNode('scripts/build-content.mjs');
runNode('scripts/build-appearance.mjs');
runNode('scripts/build-case-view.mjs');
runNode('scripts/build-prepared-sources.mjs');
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.config.ts']);
runNode('node_modules/vite/bin/vite.js', ['build', '--config', 'tests/browser.vite.config.ts']);
runNode('scripts/artifacts.mjs');
