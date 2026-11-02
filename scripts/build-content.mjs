import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';

const root = new URL('../', import.meta.url);
const frozen = [
  [
    'shared/contracts/02.1-内容结构.schema.json',
    '696f241dbdc21baadfc1b37a252dd262d7ef6bc43827ea15538cca42f20bcf82',
  ],
  [
    'shared/contracts/02.1-内容样例.json',
    '0117b47ef6a0c9d9ea87b645a57ec401f9cad5002b4ee7ba7315ccdf5088e85c',
  ],
  [
    'shared/contracts/02.1-非法配置样例.json',
    '4f064b2478a95043774fd7b282997f52ce17182667693b78b5c908e932d8160f',
  ],
];
const inputs = [];
for (const [path, expected] of frozen) {
  const bytes = await readFile(new URL(path, root));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== expected) throw new Error(`Frozen CONTENT-01 source changed: ${path}`);
  inputs.push(bytes);
}
const [schemaBytes, sampleBytes, badBytes] = inputs;
const schema = JSON.parse(schemaBytes.toString('utf8'));
const sample = JSON.parse(sampleBytes.toString('utf8'));
const bad = JSON.parse(badBytes.toString('utf8'));
const baseline = {};
for (const key of [
  'languages',
  'subsets',
  'chapters',
  'lessons',
  'knowledgePoints',
  'inputSpecs',
  'programs',
  'judgeProfiles',
  'exercises',
  'cases',
  'blocks',
  'rewardSources',
]) {
  baseline[key] = Object.fromEntries(
    sample[key].map((entity) => {
      const data = { id: entity.id };
      const selected =
        key === 'subsets'
          ? ['capabilityIds']
          : key === 'inputSpecs'
            ? ['fields', 'relations']
            : key === 'programs'
              ? ['inputRef', 'bindings', 'blockRefs']
              : key === 'blocks'
                ? ['connectionType', 'slotTypes', 'operators', 'capabilityIds']
                : key === 'exercises'
                  ? ['programRef', 'tests']
                  : key === 'cases'
                    ? ['kind', 'programRef', 'resultRule']
                    : key === 'rewardSources'
                      ? ['eventType']
                      : [];
      for (const field of selected) data[field] = entity[field];
      if (key === 'exercises')
        data.judgeRule = sample.judgeProfiles.find(
          (profile) => profile.id === entity.judgeRef.id,
        ).rule;
      return [entity.id, data];
    }),
  );
}
await mkdir(new URL('web/src/content/', root), { recursive: true });
for (const [name, data, sourceHash] of [
  ['schema', schema, frozen[0][1]],
  ['baseline', baseline, frozen[1][1]],
]) {
  const source = `// Generated from frozen CONTENT-01 1.0.0; source SHA256: ${sourceHash}\nexport const ${name} = ${JSON.stringify(data)};\n`;
  await writeFile(
    new URL(`web/src/content/${name}.mjs`, root),
    await format(source, { parser: 'babel', singleQuote: true, printWidth: 100 }),
  );
}
// Both build and browser use this exact validator. No alternate fixture-only implementation.
const { parseContent, ContentError } = await import(new URL('web/src/content/validator.mjs', root));
const parsed = parseContent(sampleBytes);
const records = [{ id: 'valid.contract-fixture', result: 'accepted' }];
function applyOperation(object, operation) {
  const parts = operation.path
    .slice(1)
    .split('/')
    .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'));
  const last = parts.pop();
  let parent = object;
  for (const key of parts) parent = parent[key];
  if (operation.op === 'set') parent[last] = globalThis.structuredClone(operation.value);
  else if (operation.op === 'append')
    parent[last].push(globalThis.structuredClone(operation.value));
  else if (operation.op === 'remove' && Array.isArray(parent)) parent.splice(Number(last), 1);
  else if (operation.op === 'remove') delete parent[last];
  else throw new Error(`Unknown fixture operation: ${operation.op}`);
}
function expectedFailure(id, bytes, code) {
  try {
    parseContent(bytes);
  } catch (error) {
    if (error instanceof ContentError && error.code === code) {
      records.push({ id, result: 'rejected', code });
      return;
    }
    throw new Error(`${id}: expected ${code}, received ${error.code}`, { cause: error });
  }
  throw new Error(`${id}: expected ${code}, accepted unexpectedly`);
}
for (const scenario of bad.scenarios) {
  const input = globalThis.structuredClone(sample);
  for (const operation of scenario.operations) applyOperation(input, operation);
  expectedFailure(
    scenario.id,
    new TextEncoder().encode(JSON.stringify(input)),
    scenario.expectedCode,
  );
}
for (const scenario of bad.rawJsonScenarios)
  expectedFailure(scenario.id, new TextEncoder().encode(scenario.rawJson), scenario.expectedCode);
// Static sample bytes remain contract-fixture; publishing is not authorized by this build.
const destination = new URL('web/public/content/sample/', root);
await mkdir(destination, { recursive: true });
await writeFile(new URL('02.1-content-1.0.0.json', destination), sampleBytes);
let entityCount = 0;
let refCount = 0;
const countRefs = (value) => {
  if (Array.isArray(value)) {
    value.forEach(countRefs);
    return;
  }
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 2 && 'id' in value && 'version' in value) refCount++;
    else Object.values(value).forEach(countRefs);
  }
};
for (const key of Object.keys(baseline)) entityCount += parsed[key].length;
countRefs(parsed);
if (entityCount !== 82 || refCount !== 405)
  throw new Error(`Frozen graph changed: ${entityCount} entities / ${refCount} refs`);
const manifest = {
  contractVersion: '1.0.0',
  packageId: parsed.packageId,
  packageVersion: parsed.packageVersion,
  purpose: parsed.purpose,
  file: '02.1-content-1.0.0.json',
  bytes: sampleBytes.length,
  sha256: frozen[1][1],
  schemaSha256: frozen[0][1],
  entityCount,
  refCount,
  staticValidation: 'schema-and-config-only',
  rustCValidation: false,
  publicationVerified: false,
};
await writeFile(new URL('manifest.json', destination), `${JSON.stringify(manifest, null, 2)}\n`);
await mkdir(new URL('.artifacts/', root), { recursive: true });
await writeFile(
  new URL('.artifacts/content-checks.json', root),
  `${JSON.stringify({ manifest, sources: frozen, checks: records }, null, 2)}\n`,
);
console.log(
  `CONTENT-01: ${entityCount} entities / ${refCount} refs, ${records.length} fixture checks passed; sample preview at ${fileURLToPath(destination)}.`,
);

await import('./build-reading.mjs');
await import('./build-practice.mjs');
await import('./build-block-assets.mjs');
if (process.env.P05_COURSE_BUILD === '1') await import('./build-p05-predecessor.mjs');
else await import('./build-course-learning.mjs');
