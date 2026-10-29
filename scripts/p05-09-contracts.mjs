// Separate explicit schemas; frozen 1.0.0 sources are never rewritten.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { p05Profiles } from '../web/src/content/validator-p05.mjs';
import { format } from 'prettier';

export const newRules = [
  'entry-output',
  'printf-integer-layout',
  'ordered-output-dependency',
  'scalar-reassignment',
  'temporary-swap',
  'scope-shadow-output',
  'safe-wide-product',
  'integer-quotient-remainder',
  'boolean-classification',
  'short-circuit-guard',
  'if-positive-normalize',
  'nested-sign-branches',
  'interval-membership',
  'while-countdown',
  'break-continue-odd-sum',
  'nested-grid-count',
  'partial-array-initialization',
  'logical-array-print',
  'guarded-array-access',
  'array-extrema',
  'array-positive-count',
  'linear-first-index',
  'adjacent-order-check',
  'bubble-ascending',
  'selection-ascending',
  'binary-first-index',
];
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const contentPath = '项目文档/契约/02.1-内容结构.schema.json';
const execPath = '项目文档/契约/02.2-执行与轨迹.schema.json';
const content = read(contentPath);
content.$id = 'https://programming-visualization.local/contracts/content-1.1.0.schema.json';
content.title = 'CONTENT-01 1.1.0: reviewed P0.5 course extension';
content.properties.contractVersion = { const: '1.1.0' };
content.properties.packageId = { const: 'content.c.p05' };
content.properties.packageVersion = { const: '1.0.0' };
content.properties.purpose = { const: 'publishable' };
content.$defs.judge.properties.rule.enum.push(...newRules);
content.$defs.inputSpec.properties.fields.minItems = 0;
content.$defs.inputValues.minProperties = 0;
content.$defs.program.properties.bindings.minItems = 0;
content.$defs.test.properties.expectedArray.minItems = 0;
save('项目文档/契约/P0.5-09-内容结构-1.1.0.schema.json', content);
writeFileSync(
  'web/src/content/schema-p05.mjs',
  await format(
    `// Generated from the independent CONTENT-01 1.1.0 schema.\nexport const schema = ${JSON.stringify(content)};\n`,
    { parser: 'babel', singleQuote: true, printWidth: 100 },
  ),
);
const execution = read(execPath);
execution.$id = 'https://programming-visualization.local/contracts/execution-1.1.0.schema.json';
execution.title = 'EXEC-01 1.1.0 / JUDGE-OBS-01 1.1.0, unchanged STEP/DIAG/INT 1.0.0';
execution.$defs.judgeRule.enum.push(...newRules);
for (const name of ['request', 'result']) {
  const definition = execution.$defs[name];
  definition.properties.protocolVersion = { const: '1.1.0' };
  definition.properties.judgeVersion = { const: '1.1.0' };
  definition.properties.packageRef = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'version'],
    properties: { id: { const: 'content.c.p05' }, version: { const: '1.0.0' } },
  };
}
execution.$defs.request.properties.mode = { const: 'exercise-test' };
execution.$defs.request.properties.judge = { $ref: '#/$defs/judge' };
execution.$defs.judgeRule.enum = [...newRules];
execution.$defs.judge.allOf = p05Profiles.map(([suffix, rule]) => ({
  if: { properties: { rule: { const: rule } } },
  then: {
    properties: {
      profileRef: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'version'],
        properties: { id: { const: `judge.c.${suffix}` }, version: { const: '1.0.0' } },
      },
    },
  },
}));
execution.$defs.request.allOf.push(
  ...p05Profiles.map(([suffix, rule]) => ({
    if: { properties: { judge: { properties: { rule: { const: rule } } } } },
    then: {
      properties: {
        programRef: {
          properties: {
            id: { const: `program.c.practice-${suffix}` },
            version: { const: '1.0.0' },
          },
        },
        subjectRef: {
          properties: { id: { const: `exercise.c.${suffix}` }, version: { const: '1.0.0' } },
        },
        input: {
          properties: {
            specRef: {
              properties: { id: { const: `input.c.${suffix}` }, version: { const: '1.0.0' } },
            },
          },
        },
      },
    },
  })),
);
// All other fields and result shapes retain the original closed schema.
const branch = execution.$defs.request.allOf[1].then.properties.input.properties;
delete branch.values;
execution.$defs.request.allOf.push({
  if: {
    properties: {
      judge: {
        oneOf: [
          {
            properties: {
              rule: { const: 'entry-output' },
              profileRef: {
                properties: { id: { const: 'judge.c.first-output' }, version: { const: '1.0.0' } },
              },
            },
          },
          {
            properties: {
              rule: { const: 'partial-array-initialization' },
              profileRef: {
                properties: {
                  id: { const: 'judge.c.partial-array-init' },
                  version: { const: '1.0.0' },
                },
              },
            },
          },
        ],
      },
    },
  },
  then: {
    properties: {
      input: { properties: { values: { maxProperties: 0 }, random: { type: 'null' } } },
      source: { properties: { bindingMap: { maxItems: 0 } } },
    },
  },
  else: {
    properties: {
      input: { properties: { values: { minProperties: 1 } } },
      source: { properties: { bindingMap: { minItems: 1 } } },
    },
  },
});
save('项目文档/契约/P0.5-09-执行与判题-1.1.0.schema.json', execution);
save('.artifacts/P0.5-09/contract-sources.json', {
  unchanged: [contentPath, execPath].map((path) => ({
    path,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  })),
  versions: ['1.0.0/1.0.0/1.0.0/1.0.0/1.0.0', '1.1.0/1.0.0/1.0.0/1.1.0/1.0.0'],
  newRules,
});
