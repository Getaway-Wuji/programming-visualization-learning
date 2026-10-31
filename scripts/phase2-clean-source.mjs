import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const directory = process.argv[2] ?? 'clean-workspace';
assert.ok(['clean-workspace', 'delivery-workspace'].includes(directory));
const root = resolve('.'),
  destination = resolve(`.artifacts/16.10/${directory}`);
const reportPath = `.artifacts/16.10/${directory === 'clean-workspace' ? 'clean-source' : 'delivery-source'}.json`;
assert.ok(destination.startsWith(root + '\\.artifacts\\16.10\\'));
assert.equal(existsSync(destination), false, 'Use a fresh isolated source destination.');
assert.equal(existsSync(reportPath), false, 'Keep previous source-copy evidence.');
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const external = '项目文档/交接/2026-10-31-GitHub-Actions失败排查-交接.md';
const externalStatePath = '.artifacts/16.10/external-changes47.json';
const externalState = existsSync(externalStatePath)
  ? JSON.parse(readFileSync(externalStatePath, 'utf8'))
  : { deliveryOverrides: [], externalAdded: [] };
const overrides = new Map(externalState.deliveryOverrides.map((item) => [item.path, item]));
const externalAdded = new Set(externalState.externalAdded.map((item) => item.path));
const sourceFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((p) => p && p !== external && !externalAdded.has(p));
const shippingRequired = [];
for (const task of readdirSync('项目文档/验收/发布凭据')) {
  const indexPath = `项目文档/验收/发布凭据/${task}/index.json`;
  if (!existsSync(indexPath)) continue;
  const index = JSON.parse(readFileSync(indexPath));
  for (const item of index.files ?? []) {
    const path = `项目文档/验收/发布凭据/${task}/${item.file}`;
    assert.equal(hash(path), item.sha256, path);
    if (!sourceFiles.includes(path)) {
      shippingRequired.push({
        path,
        sha256: item.sha256,
        reason:
          'Exact immutable build receipt required by the existing restore script; ignored suffix is not permission to omit it.',
      });
      sourceFiles.push(path);
    }
  }
}
const copied = sourceFiles.map((path) => {
  const override = overrides.get(path);
  const source = override?.from ?? path;
  if (override) {
    assert.ok(['.gitignore', '.github/workflows/webpack.yml'].includes(path));
    assert.equal(resolve(source), resolve(root, '.artifacts/16.10/clean-workspace', path));
    assert.equal(hash(source), override.sha256, source);
  }
  const target = resolve(destination, path);
  assert.ok(target.startsWith(destination + '\\'));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { path, sha256: hash(source), ...(override ? { sourceOverride: override } : {}) };
});
// Installation/tool caches are explicit shared prerequisites; no generated
// product files, target directory or evidence cache comes from the main tree.
for (const name of ['node_modules', '.tools'])
  symlinkSync(resolve(name), resolve(destination, name), 'junction');
assert.equal(existsSync(resolve(destination, '.artifacts')), false);
assert.equal(existsSync(resolve(destination, 'target')), false);
assert.equal(existsSync(resolve(destination, 'web/src/generated')), false);
assert.equal(existsSync(resolve(destination, 'web/public/content')), false);
const report = {
  task: '16.10',
  sourceRoot: root,
  destination,
  copied,
  shippingRequired,
  excluded: [external, ...externalAdded],
  deliveryOverrides: externalState.deliveryOverrides,
  sharedInstallCaches: ['node_modules', '.tools'],
  sourceControlledCopy: true,
  sourceSelection:
    'Git-visible source paths with explicit pre-CI configuration overrides recorded above.',
  gitMetadataCopied: false,
  noPriorArtifactCache: true,
  noGeneratedProductCopied: true,
  noTargetCacheCopied: true,
  notFreshMachineInstall: true,
};
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    copied: copied.length,
    shippingRequired,
    excluded: external,
    clean: destination,
  }),
);
