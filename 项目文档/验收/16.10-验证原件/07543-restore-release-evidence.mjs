// Restore exact reviewed build inputs from the source-controlled release archive.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const archive = '项目文档/验收/发布凭据/P0.5-1.0.16';
const read = (path) => readFileSync(resolve(root, path));
const json = (path) =>
  JSON.parse(
    read(path)
      .toString('utf8')
      .replace(/^\uFEFF/, ''),
  );
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const index = json(`${archive}/index.json`);
assert.equal(index.version, '1.0.0');
assert.equal(index.registration.path, 'content/c/p0/blockly-release-1.0.16.json');
assert.equal(sha(read(index.registration.path)), index.registration.sha256);
const registration = json(index.registration.path);
const expected = Object.values(registration.evidence).map(({ path, sha256 }) => ({ path, sha256 }));
assert.deepEqual(
  index.files.map(({ path, sha256 }) => ({ path, sha256 })),
  expected,
);
assert.equal(new Set(index.files.map(({ path }) => path)).size, expected.length);
const prepared = index.files.map((entry) => {
  assert.match(entry.path, /^\.artifacts\/P0\.5-09\/[A-Za-z0-9_./-]+\.json$/);
  assert.ok(!entry.path.split('/').includes('..'));
  assert.match(entry.file, /^[A-Za-z0-9_-]+\.json$/);
  const bytes = read(`${archive}/${entry.file}`);
  assert.equal(sha(bytes), entry.sha256, `Archived release evidence changed: ${entry.file}`);
  const target = resolve(root, entry.path);
  if (existsSync(target))
    assert.equal(
      sha(readFileSync(target)),
      entry.sha256,
      `Existing evidence differs: ${entry.path}`,
    );
  return { ...entry, target, bytes };
});
let restored = 0;
// Validate the whole archive and every existing destination before writing any file.
for (const entry of prepared) {
  if (existsSync(entry.target)) continue;
  mkdirSync(dirname(entry.target), { recursive: true });
  writeFileSync(entry.target, entry.bytes, { flag: 'wx' });
  restored++;
}
console.log(
  `Reviewed release evidence: ${prepared.length} verified; ${restored} missing files restored.`,
);

// A successor carries its own immutable archive; never rewrite the predecessor.
for (const release of [
  '1.0.17',
  '1.0.18',
  '1.0.19',
  '1.0.20',
  '1.0.21',
  '1.0.22',
  '1.0.23',
  '1.0.24',
  '1.0.25',
  '1.0.26',
  '1.0.27',
  '1.0.28',
  '1.0.29',
  '1.0.30',
  '1.0.31',
  '1.0.32',
  '1.0.33',
  '1.0.34',
  '1.0.35',
  '1.0.36',
  '1.0.37',
  '1.0.38',
  '1.0.39',
  '1.0.40',
  '1.0.41',
  '1.0.42',
  '1.0.43',
  '1.0.44',
  '1.0.45',
]) {
  const successor = `content/c/p0/blockly-release-${release}.json`;
  if (!existsSync(resolve(root, successor))) continue;
  const task =
    release === '1.0.45'
      ? '16.10'
      : release === '1.0.44'
        ? '16.9'
        : release === '1.0.43'
          ? '16.8'
          : release === '1.0.42'
            ? '16.7'
            : release === '1.0.41'
              ? '16.6'
              : release === '1.0.40'
                ? '16.5'
                : release === '1.0.39'
                  ? '16.4'
                  : release === '1.0.38'
                    ? '16.3'
                    : ['1.0.36', '1.0.37'].includes(release)
                      ? '16.2'
                      : release === '1.0.35'
                        ? '16.1'
                        : ['1.0.30', '1.0.31', '1.0.32', '1.0.33', '1.0.34'].includes(release)
                          ? '15.4'
                          : ['1.0.28', '1.0.29'].includes(release)
                            ? '15.3'
                            : ['1.0.26', '1.0.27'].includes(release)
                              ? '15.2'
                              : release === '1.0.25'
                                ? '15.1'
                                : release === '1.0.24'
                                  ? '14.4'
                                  : ['1.0.22', '1.0.23'].includes(release)
                                    ? '14.3'
                                    : release === '1.0.21'
                                      ? '14.1'
                                      : release === '1.0.20'
                                        ? '13.5'
                                        : release === '1.0.19'
                                          ? '13.4'
                                          : '13.3';
  const nextArchive = `项目文档/验收/发布凭据/${task}-${release}`;
  const nextIndex = json(`${nextArchive}/index.json`);
  assert.equal(nextIndex.registration.path, successor);
  assert.equal(sha(read(successor)), nextIndex.registration.sha256);
  const nextRegistration = json(successor);
  assert.deepEqual(
    nextIndex.files.map(({ path, sha256 }) => ({ path, sha256 })),
    Object.values(nextRegistration.evidence).map(({ path, sha256 }) => ({ path, sha256 })),
  );
  const nextFiles = nextIndex.files.map((entry) => {
    // The immutable 33 UI-lint receipt is JSON with a .log suffix.
    const jsonLog =
      ['1.0.33', '1.0.34'].includes(release) &&
      entry.path === '.artifacts/15.4/ui-lint-vector-final.log';
    assert.match(
      entry.path,
      new RegExp(
        `^\\.artifacts/${task.replace('.', '\\.')}\\/[A-Za-z0-9_.-]+\\.${jsonLog ? 'log' : 'json'}$`,
      ),
    );
    assert.match(entry.file, jsonLog ? /^ui-lint-vector-final\.log$/ : /^[A-Za-z0-9_.-]+\.json$/);
    const bytes = read(`${nextArchive}/${entry.file}`);
    assert.equal(sha(bytes), entry.sha256);
    if (jsonLog) JSON.parse(bytes.toString('utf8'));
    const target = resolve(root, entry.path);
    if (existsSync(target)) assert.equal(sha(readFileSync(target)), entry.sha256);
    return { target, bytes };
  });
  for (const { target, bytes } of nextFiles) {
    if (existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  console.log(`13.3 successor evidence: ${nextFiles.length} verified.`);
}
