import { restoreFrozenWasm } from './restore-frozen-wasm.mjs';

restoreFrozenWasm({
  build: 'advanced',
  version: '0.1.0',
  prefix: 'c_viz_advanced',
  lockHash: '61b82250cf96773c51bcb29396f2d450b49d190e73874dd72e921070ac5d437a',
  output: 'web/src/generated/advanced',
});
