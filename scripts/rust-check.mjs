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

const manifest = ['--manifest-path', 'engine/python3/Cargo.toml'];
const python = [...manifest, '--target-dir', 'target/python3', '--workspace', '--locked'];
run('cargo', ['+1.99.0', 'fmt', ...manifest, '--all', '--', '--check']);
run('cargo', ['+1.99.0', 'clippy', ...python, '--all-targets', '--', '-D', 'warnings']);
run('cargo', [
  '+1.99.0',
  'clippy',
  ...python,
  '--target',
  'wasm32-unknown-unknown',
  '--',
  '-D',
  'warnings',
]);
run('cargo', ['+1.99.0', 'test', ...python]);
