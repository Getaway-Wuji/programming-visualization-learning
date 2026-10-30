// Mechanical companion schema; original closed memory schema is never rewritten.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const source = JSON.parse(readFileSync('项目文档/契约/12.2-内存执行.schema.json', 'utf8'));
const registry = JSON.parse(readFileSync('content/cpp/bugs/questions-1.0.0.json', 'utf8'));
const object = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const literal = (constant) => ({ const: constant });
const schema = globalThis.structuredClone(source);
schema.$id = 'urn:programming-visualization:bug-memory:1.0.0';
schema.title = 'BUG-MEMORY-01 companion 1.0.0';
schema.$defs.request.properties.language = literal('cpp');
schema.$defs.request.properties.bug = object({
  version: literal('1.0.0'),
  exerciseId: { enum: registry.questions.map((q) => q.exerciseRef.id) },
  caseKey: { enum: [...new Set(registry.questions.flatMap((q) => q.tests.map((t) => t.caseKey)))] },
});
schema.$defs.request.required.push('bug');
const ids = ['exit-zero', 'stdout-exact', 'input-consumed', 'teaching-target'];
const judgement = object({
  version: literal('1.0.0'),
  registryRef: object({ id: literal(registry.registryRef.id), version: literal('1.0.0') }),
  exerciseRef: object({
    id: { enum: registry.questions.map((q) => q.exerciseRef.id) },
    version: literal('1.0.0'),
  }),
  caseKey: { enum: [...new Set(registry.questions.flatMap((q) => q.tests.map((t) => t.caseKey)))] },
  status: { enum: ['met', 'unmet'] },
  checks: {
    type: 'array',
    minItems: 4,
    maxItems: 4,
    prefixItems: ids.map((id) => object({ id: literal(id), met: { type: 'boolean' } })),
    items: false,
  },
});
judgement.oneOf = [
  {
    properties: {
      status: literal('met'),
      checks: { prefixItems: ids.map(() => ({ properties: { met: literal(true) } })) },
    },
  },
  {
    properties: {
      status: literal('unmet'),
      checks: { contains: { properties: { met: literal(false) } }, minContains: 1 },
    },
  },
];
schema.$defs.result.properties.bugJudgement = judgement;
schema.$defs.result.required.push('bugJudgement');
schema.$defs.result.properties.language = literal('cpp');
schema.$defs.result.allOf = [
  {
    if: { properties: { bugJudgement: { properties: { status: literal('met') } } } },
    then: {
      properties: {
        terminal: { properties: { status: literal('completed'), returnValue: literal(0) } },
        trace: { type: 'object', properties: { completeness: literal('complete') } },
      },
    },
  },
];
const output = JSON.stringify(schema, null, 2) + '\n',
  path = '项目文档/契约/14.4-内存关卡.schema.json';
if (process.argv.includes('--check')) assert.equal(readFileSync(path, 'utf8'), output);
else writeFileSync(path, output, { flag: 'wx' });
console.log('BUG-MEMORY-01 companion schema matches; original EXEC/STEP/DIAG remain closed.');
