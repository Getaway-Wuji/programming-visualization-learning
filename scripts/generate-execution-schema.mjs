// Build-time specialization of the frozen schema. No generated/runtime eval.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p05 = process.argv.includes('--p05');
const original = fs.readFileSync(
  path.join(
    root,
    p05
      ? 'shared/contracts/P0.5-09-执行与判题-1.1.0.schema.json'
      : 'shared/contracts/02.2-执行与轨迹.schema.json',
  ),
  'utf8',
);
const schema = JSON.parse(original),
  definitions = schema.$defs;
const output = path.join(
  root,
  p05
    ? 'web/src/engine/execution-p05-schema.generated.ts'
    : 'web/src/engine/execution-schema.generated.ts',
);
const functions = [],
  named = new Map(),
  compiled = new Map(),
  patterns = new Map();
let serial = 0;
for (const name of Object.keys(definitions)) named.set(name, `d${serial++}`);
const quote = JSON.stringify;
// A JSON object cannot satisfy two branches that require different string
// constants for the same own property. Prove that narrow case at build time;
// the chosen branch still runs its complete, unmodified schema validator.
// Unresolved/cyclic references, optional tags and overlapping constants keep
// the general oneOf match-count implementation.
function disjointObjectTag(alternatives) {
  const resolve = (rule, seen = new Set()) => {
    if (!rule?.$ref) return rule;
    const prefix = '#/$defs/';
    if (!rule.$ref.startsWith(prefix) || seen.has(rule.$ref)) return null;
    seen.add(rule.$ref);
    return resolve(definitions[rule.$ref.slice(prefix.length)], seen);
  };
  const branches = alternatives.map((rule) => resolve(rule));
  if (!branches.length || branches.some((rule) => rule?.type !== 'object')) return null;
  for (const property of branches[0].required ?? []) {
    const constants = branches.map((rule) => rule.properties?.[property]?.const);
    if (
      branches.every((rule) => rule.required?.includes(property)) &&
      constants.every((value) => typeof value === 'string') &&
      new Set(constants).size === branches.length
    )
      return { property, constants };
  }
  return null;
}
function compile(rule, location = '') {
  if (compiled.has(rule)) return compiled.get(rule);
  const name = `v${serial++}`;
  compiled.set(rule, name);
  const body = [];
  if (rule.$ref)
    body.push(`return ${named.get(rule.$ref.slice('#/$defs/'.length))}(value, context);`);
  else {
    if ('const' in rule) body.push(`if(value!==${quote(rule.const)})return false;`);
    if (rule.enum)
      body.push(
        `if(!(${rule.enum.map((value) => `value===${quote(value)}`).join('||')}))return false;`,
      );
    if (rule.type) {
      const tests = {
        object: 'isRecord(value)',
        array: 'Array.isArray(value)',
        integer: "typeof value==='number'&&Number.isSafeInteger(value)",
        string: "typeof value==='string'",
        boolean: "typeof value==='boolean'",
        null: 'value===null',
      };
      body.push(`if(!(${tests[rule.type]}))return false;`);
    }
    const numbers = [];
    if (rule.minimum !== undefined) numbers.push(`value<${rule.minimum}`);
    if (rule.maximum !== undefined) numbers.push(`value>${rule.maximum}`);
    if (rule.multipleOf !== undefined) numbers.push(`value%${rule.multipleOf}!==0`);
    if (numbers.length)
      body.push(`if(typeof value==='number'&&(${numbers.join('||')}))return false;`);
    if (rule.minLength !== undefined || rule.maxLength !== undefined || rule.pattern) {
      const checks = [];
      if (rule.minLength !== undefined) checks.push(`size<${rule.minLength}`);
      if (rule.maxLength !== undefined) checks.push(`size>${rule.maxLength}`);
      if (rule.pattern) {
        if (!patterns.has(rule.pattern)) patterns.set(rule.pattern, `p${patterns.size}`);
        checks.push(`!${patterns.get(rule.pattern)}.test(value)`);
      }
      body.push(
        `if(typeof value==='string'){${rule.minLength !== undefined || rule.maxLength !== undefined ? 'const size=scalarLength(value);' : ''}if(${checks.join('||')})return false;}`,
      );
    }
    if (
      rule.items ||
      rule.minItems !== undefined ||
      rule.maxItems !== undefined ||
      rule.uniqueItems
    ) {
      const lines = [];
      if (rule.minItems !== undefined) lines.push(`if(value.length<${rule.minItems})return false;`);
      if (rule.maxItems !== undefined) lines.push(`if(value.length>${rule.maxItems})return false;`);
      const deferred =
        location === 'trace/properties/steps' || location === 'trace/properties/checkpoints';
      if (rule.items || rule.uniqueItems) {
        if (rule.uniqueItems) lines.push('const seen=new Set<unknown>();');
        const inner = [];
        inner.push('if((index&1023)===0)context.guard();');
        if (rule.items)
          inner.push(
            `if(!${compile(rule.items, `${location}/items`)}(value[index],context))return false;`,
          );
        if (rule.uniqueItems)
          inner.push(
            "const item=value[index],key=item!==null&&typeof item==='object'?JSON.stringify(item):item;if(seen.has(key))return false;seen.add(key);",
          );
        lines.push(
          `${deferred ? 'if(!context.deferTrace)' : ''}for(let index=0;index<value.length;index++){${inner.join('')}}`,
        );
      }
      body.push(`if(Array.isArray(value)){${lines.join('')}}`);
    }
    if (
      rule.required ||
      rule.properties ||
      rule.propertyNames ||
      rule.additionalProperties !== undefined ||
      rule.minProperties !== undefined ||
      rule.maxProperties !== undefined ||
      rule.dependentRequired
    ) {
      const lines = [];
      if (rule.required)
        lines.push(
          `if(${rule.required.map((key) => `!Object.hasOwn(value,${quote(key)})`).join('||')})return false;`,
        );
      if (rule.minProperties !== undefined)
        lines.push(`if(Object.keys(value).length<${rule.minProperties})return false;`);
      if (rule.maxProperties !== undefined)
        lines.push(`if(Object.keys(value).length>${rule.maxProperties})return false;`);
      if (rule.properties || rule.propertyNames || rule.additionalProperties !== undefined) {
        const propertyKeys = Object.keys(rule.properties ?? {});
        const exactRequired =
          rule.additionalProperties === false &&
          rule.required?.length === propertyKeys.length &&
          propertyKeys.every((key) => rule.required.includes(key));
        const partial =
          rule.properties && rule.additionalProperties === undefined && !rule.propertyNames;
        if (exactRequired || partial) {
          if (exactRequired)
            lines.push(`if(Object.keys(value).length!==${propertyKeys.length})return false;`);
          for (const [key, child] of Object.entries(rule.properties))
            lines.push(
              `if(${partial ? `Object.hasOwn(value,${quote(key)})&&` : ''}!${compile(child, `${location}/properties/${key}`)}(value[${quote(key)}],context))return false;`,
            );
        } else {
          const inner = [];
          if (rule.propertyNames)
            inner.push(
              `if(!${compile(rule.propertyNames, `${location}/propertyNames`)}(key,context))return false;`,
            );
          if (rule.properties) {
            const cases = Object.entries(rule.properties).map(
              ([key, value]) =>
                `case ${quote(key)}:if(!${compile(value, `${location}/properties/${key}`)}(value[key],context))return false;break;`,
            );
            const additional =
              rule.additionalProperties === false
                ? 'return false;'
                : typeof rule.additionalProperties === 'object'
                  ? `if(!${compile(rule.additionalProperties, `${location}/additionalProperties`)}(value[key],context))return false;`
                  : '';
            inner.push(`switch(key){${cases.join('')}default:${additional}break;}`);
          } else if (rule.additionalProperties === false) inner.push('return false;');
          else if (typeof rule.additionalProperties === 'object')
            inner.push(
              `if(!${compile(rule.additionalProperties, `${location}/additionalProperties`)}(value[key],context))return false;`,
            );
          lines.push(`for(const key of Object.keys(value)){${inner.join('')}}`);
        }
      }
      if (rule.dependentRequired)
        for (const [key, required] of Object.entries(rule.dependentRequired))
          lines.push(
            `if(Object.hasOwn(value,${quote(key)})&&(${required.map((key) => `!Object.hasOwn(value,${quote(key)})`).join('||')}))return false;`,
          );
      body.push(`if(isRecord(value)){${lines.join('')}}`);
    }
    if (rule.allOf)
      for (const item of rule.allOf)
        body.push(`if(!${compile(item, `${location}/allOf`)}(value,context))return false;`);
    if (rule.anyOf)
      body.push(
        `if(!(${rule.anyOf.map((item) => `${compile(item, `${location}/anyOf`)}(value,context)`).join('||')}))return false;`,
      );
    if (rule.oneOf) {
      const candidates = rule.oneOf.map((item) => compile(item, `${location}/oneOf`));
      const tag = disjointObjectTag(rule.oneOf);
      body.push(
        tag
          ? `if(!isRecord(value))return false;switch(value[${quote(tag.property)}]){${candidates.map((candidate, index) => `case ${quote(tag.constants[index])}:if(!${candidate}(value,context))return false;break;`).join('')}default:return false;}`
          : `{let matches=0;${candidates.map((candidate) => `if(${candidate}(value,context))matches++;`).join('')}if(matches!==1)return false;}`,
      );
    }
    if (rule.not)
      body.push(`if(${compile(rule.not, `${location}/not`)}(value,context))return false;`);
    if (rule.if)
      body.push(
        `if(${compile(rule.if, `${location}/if`)}(value,context)){${rule.then ? `if(!${compile(rule.then, `${location}/then`)}(value,context))return false;` : ''}}${rule.else ? `else if(!${compile(rule.else, `${location}/else`)}(value,context))return false;` : ''}`,
      );
    body.push('return true;');
  }
  const emitted = body.join('');
  functions.push(
    `function ${name}(value:SchemaValue,context:Context):boolean{${emitted.includes('value') ? '' : 'void value;'}${emitted.includes('context') ? '' : 'void context;'}${emitted}}`,
  );
  return name;
}
for (const [name, rule] of Object.entries(definitions)) {
  const body = compile(rule, name),
    identifier = named.get(name);
  const cacheable = [
    'trace',
    'state',
    'initialState',
    'frame',
    'scope',
    'object',
    'control',
    'allocator',
    'counters',
  ].includes(name);
  functions.push(
    cacheable
      ? `function ${identifier}(value:SchemaValue,context:Context):boolean{if(value!==null&&typeof value==='object'){const known=context.validated.get(value);if(known?.includes(${quote(identifier)}))return true;if(!${body}(value,context))return false;if(known)known.push(${quote(identifier)});else context.validated.set(value,[${quote(identifier)}]);return true;}return ${body}(value,context);}`
      : `function ${identifier}(value:SchemaValue,context:Context):boolean{return ${body}(value,context);}`,
  );
}
const source = `/** Generated by scripts/generate-execution-schema.mjs from frozen EXEC/STEP/DIAG 1.0.0. */
export const FROZEN_EXEC_SCHEMA_SHA256=${quote(createHash('sha256').update(original).digest('hex'))};
export type SchemaValue=null|boolean|number|string|SchemaValue[]|{[key:string]:SchemaValue};
interface Context{guard:()=>void;deferTrace:boolean;validated:WeakMap<object,string[]>}
function isRecord(value:SchemaValue):value is {[key:string]:SchemaValue}{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function scalarLength(value:string):number{let length=value.length;for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){length--;i++;}}return length;}
${[...patterns].map(([pattern, name]) => `const ${name}=new RegExp(${quote(pattern)});`).join('\n')}
${functions.join('\n')}
function context(guard:()=>void,deferTrace:boolean):Context{return {guard,deferTrace,validated:new WeakMap()};}
export function validateRequestSchema(value:SchemaValue):boolean{return ${named.get('request')}(value,context(()=>{},false));}
export function* validateResultSchema(value:SchemaValue,guard:()=>void):Generator<void,boolean,unknown>{const state=context(guard,true);if(!${named.get('result')}(value,state))return false;yield;return yield* validateDeferredTrace(isRecord(value)?value.trace:null,state);}
export function* validateTraceSchema(value:SchemaValue,guard:()=>void):Generator<void,boolean,unknown>{const state=context(guard,true);if(!${named.get('trace')}(value,state))return false;yield;return yield* validateDeferredTrace(value,state);}
function* validateDeferredTrace(value:SchemaValue,state:Context):Generator<void,boolean,unknown>{if(value===null)return true;if(!isRecord(value)||!Array.isArray(value.steps)||!Array.isArray(value.checkpoints))return false;for(const step of value.steps){if(!${named.get('step')}(step,state))return false;yield;}for(const checkpoint of value.checkpoints){if(!${named.get('checkpoint')}(checkpoint,state))return false;yield;}return true;}
`;
// Prettier's API is an installed, pinned build dependency, never a runtime one.
const { format } = await import('prettier');
const formatted = await format(source, {
  filepath: output,
  ...JSON.parse(fs.readFileSync(path.join(root, '.prettierrc.json'), 'utf8')),
});
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== formatted)
    throw new Error('Generated execution schema is stale.');
} else fs.writeFileSync(output, formatted);
