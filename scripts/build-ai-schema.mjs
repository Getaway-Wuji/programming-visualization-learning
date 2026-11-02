import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import standalone from 'ajv/dist/standalone/index.js';
import assert from 'node:assert/strict';
import { format } from 'prettier';
const schema = JSON.parse(readFileSync('shared/contracts/19.3-AI解释2.0.0.schema.json', 'utf8'));
const save = (path, text) => {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
};
const ajv = new Ajv2020({ strict: false, allErrors: false, code: { source: true, esm: true } });
ajv.addSchema(schema);
const names = {
  request: 'request',
  response: 'response',
  error: 'error',
  check: 'configCheck',
  checked: 'configChecked',
};
const refs = Object.fromEntries(
  Object.entries(names).map(([name, def]) => [name, schema.$id + '#/$defs/' + def]),
);
mkdirSync('web/src/ai-debug', { recursive: true });
mkdirSync('web/src/generated/ai', { recursive: true });
let source = standalone(ajv, refs);
let replaced = 0;
source = source.replace(
  /const (\w+)\s*=\s*require\(["']ajv\/dist\/runtime\/ucs2length["']\)\.default;/g,
  (_, name) => {
    replaced++;
    return `const ${name} = (value) => Array.from(value).length;`;
  },
);
assert.equal(replaced, 1, 'Review any generated validator runtime changes.');
assert.doesNotMatch(source, /\brequire\s*\(|new Function|\beval\s*\(/);
save(
  'web/src/generated/ai/schema.generated.mjs',
  await format(
    '// Generated from the trusted AI-EXPLAIN2 schema; no runtime compilation.\n' + source,
    { parser: 'babel', singleQuote: true, printWidth: 100 },
  ),
);
save(
  'web/src/ai-debug/model-schema.generated.json',
  await format(JSON.stringify(schema.$defs.modelOutput), { parser: 'json', printWidth: 100 }),
);
save(
  'web/src/generated/ai/schema.generated.d.mts',
  Object.keys(names)
    .map((name) => `export function ${name}(value: unknown): boolean;`)
    .join('\n') + '\n',
);
console.log('AI2 static schema validators generated; no API calls.');
