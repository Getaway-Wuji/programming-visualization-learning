import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const policy = JSON.parse(readFileSync('.artifacts/block-style-hashes.json', 'utf8'));
assert.equal(policy.version, '13.4.0');
assert.equal(policy.hashes.length, 2);
assert.ok(policy.hashes.every((hash) => /^[A-Za-z0-9+/]{43}=$/.test(hash)));
writeFileSync(
  'web/dist/ai-gateway-policy.json',
  JSON.stringify({ version: '1.0.0', styleHashes: policy.hashes }) + '\n',
);
console.log('Production AI gateway CSP prepared from the reviewed Blockly style hashes.');
