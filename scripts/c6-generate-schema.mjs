// Build-time Ajv compilation; the browser loads static code and never compiles schemas.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
const source = new URL('../shared/contracts/21.2-C6执行与判题.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, ''));
const ajv = new Ajv2020({
  strict: false,
  allErrors: false,
  inlineRefs: false,
  code: { source: true, esm: true },
});
ajv.addSchema(schema, 'c6');
const names = {};
for (const name of ['request', 'result', 'judgeRequest', 'judgeResult']) {
  const id = `c6-${name}`;
  ajv.addSchema({ $ref: `c6#/$defs/${name}` }, id);
  names[name] = id;
}
const editSchema = JSON.parse(
  readFileSync(new URL('../shared/contracts/21.3-C6编辑映射.schema.json', import.meta.url), 'utf8'),
);
ajv.addSchema(editSchema, 'c6-edit');
for (const name of ['editRequest', 'editResult']) {
  const id = `c6-${name}`;
  ajv.addSchema({ $ref: `c6-edit#/$defs/${name}` }, id);
  names[name] = id;
}
const folder = new URL('../web/src/generated/c6/', import.meta.url);
mkdirSync(folder, { recursive: true });
const rawCode = standaloneCode(ajv, names);
// Ajv's standalone ESM output still emits this single static CJS runtime reference.
// Bind it through a static ESM import so the same validator works in browser and Node QA.
const code = `import ucs2length from 'ajv/dist/runtime/ucs2length.js';\n${rawCode.replaceAll('require("ajv/dist/runtime/ucs2length").default', 'ucs2length.default ?? ucs2length')}`;
writeFileSync(new URL('schema.mjs', folder), code);
writeFileSync(
  new URL('schema.d.mts', folder),
  Object.keys(names)
    .map((name) => `export function ${name}(value: unknown): boolean;`)
    .join('\n') + '\n',
);
writeFileSync(
  new URL('diagnostic-codes.ts', folder),
  `// Exact frozen DIAG1.4 vocabulary.\nexport const c6DiagnosticCodes=${JSON.stringify(schema.$defs.result.properties.terminal.properties.code.anyOf[0].enum)} as const;\n`,
);
const catalog = JSON.parse(
  readFileSync(new URL('../engine/c6/resources/judges-1.0.0.json', import.meta.url), 'utf8'),
);
const domains = catalog.profiles.map((p) => ({
  id: p.ref.id,
  targets: p.semanticTargets,
  cases: p.testDomain.map((c) => ({
    inputBytes: Buffer.byteLength(c.stdin),
    outputSha256: createHash('sha256').update(c.expectedStdout).digest('hex'),
    guard: c.observationRule.startsWith('actual-zero-guard')
      ? 'guard.zero'
      : c.observationRule.startsWith('actual-getchar-EOF')
        ? 'guard.eof'
        : c.observationRule.startsWith('actual-scanf-return')
          ? 'guard.scan-failure'
          : c.observationRule.startsWith('actual-invalid-index')
            ? 'guard.invalid-index'
            : c.observationRule.startsWith('actual-base-case')
              ? 'guard.recursion-base'
              : null,
  })),
}));
writeFileSync(
  new URL('judge-domains.ts', folder),
  `// Frozen profile metadata and expected-output hashes. No C implementation.\nexport const judgeDomains=${JSON.stringify(domains)} as const;\n`,
);
console.log(`C6 static validators: ${code.length} characters`);
