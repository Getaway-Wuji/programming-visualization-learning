import { checkEnvironment } from './environment.mjs';
import { run } from './process.mjs';

checkEnvironment();
run('cargo', ['+1.99.0', 'fmt', '--all', '--', '--check']);
run('cargo', [
  '+1.99.0',
  'clippy',
  '--workspace',
  '--all-targets',
  '--locked',
  '--',
  '-D',
  'warnings',
]);
run('cargo', [
  '+1.99.0',
  'clippy',
  '--workspace',
  '--target',
  'wasm32-unknown-unknown',
  '--locked',
  '--',
  '-D',
  'warnings',
]);
run('cargo', ['+1.99.0', 'test', '--workspace', '--locked']);
