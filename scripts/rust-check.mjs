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
run('cargo', ['+1.99.0', 'test', '--workspace', '--exclude', 'c-viz-cpp-course-wasm', '--locked']);
run('cargo', ['+1.99.0', 'test', '-p', 'c-viz-advanced', '--features', 'cpp-course', '--locked']);

for (const language of ['python3', 'java']) {
  const manifest = ['--manifest-path', `engine/${language}/Cargo.toml`];
  const workspace = [...manifest, '--target-dir', `target/${language}`, '--workspace', '--locked'];
  run('cargo', ['+1.99.0', 'fmt', ...manifest, '--all', '--', '--check']);
  run('cargo', ['+1.99.0', 'clippy', ...workspace, '--all-targets', '--', '-D', 'warnings']);
  run('cargo', [
    '+1.99.0',
    'clippy',
    ...workspace,
    '--target',
    'wasm32-unknown-unknown',
    '--',
    '-D',
    'warnings',
  ]);
  run('cargo', ['+1.99.0', 'test', ...workspace]);
}
