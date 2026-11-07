import { restoreFrozenWasm } from './restore-frozen-wasm.mjs';

restoreFrozenWasm({
  build: 'practice',
  version: '1.0.0',
  prefix: 'c_viz_practice',
  lockHash: 'a560fe00f685672acc0ac5d401ccdf4819ad9fbdf800cc4d8fd7ebf35d855baf',
  output: 'web/src/generated/practice',
});
