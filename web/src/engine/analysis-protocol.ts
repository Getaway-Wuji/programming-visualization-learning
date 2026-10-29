/** AST-MAP-01 boundary validation. It consumes Rust data, never parses C. */
import schemaText from '../../../项目文档/契约/13.1-双向编辑.schema.json?raw';
import type {
  AnalysisNode,
  AnalysisRequest,
  AnalysisResult,
  ValidAnalysisResult,
} from '../blocks/analysis-types';
import type { ExecutionCatalog } from './execution-client';
import type { ByteRange } from './protocol';
import { sourceByteBoundaries } from './protocol';
import { parseChunked, precheckJson } from './execution-json';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Rule {
  $ref?: string;
  const?: Json;
  enum?: Json[];
  type?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  items?: Rule;
  properties?: Record<string, Rule>;
  propertyNames?: Rule;
  additionalProperties?: Rule | boolean;
  required?: string[];
  dependentRequired?: Record<string, string[]>;
  oneOf?: Rule[];
  anyOf?: Rule[];
}
const schema = JSON.parse(schemaText) as { $defs: Record<string, Rule> };
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const object = (value: unknown): value is Record<string, Json> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export class AnalysisProtocolFailure extends Error {
  constructor(public readonly code = 'E_PROTOCOL_INVALID') {
    super(code);
  }
}
function ensure(condition: unknown, code = 'E_PROTOCOL_INVALID'): asserts condition {
  if (!condition) throw new AnalysisProtocolFailure(code);
}
type Validate = (value: Json, guard: () => void) => boolean;
const compiled = new Map<Rule, Validate>();
// Distinct required string tags make these object branches mutually exclusive.
// The selected branch still runs all of its original checks; unproved unions
// retain the general match-count path.
function disjointTag(alternatives: Rule[]): { property: string; constants: string[] } | null {
  const resolve = (rule: Rule, seen = new Set<string>()): Rule | null => {
    if (!rule.$ref) return rule;
    if (!rule.$ref.startsWith('#/$defs/') || seen.has(rule.$ref)) return null;
    seen.add(rule.$ref);
    const next = schema.$defs[rule.$ref.slice('#/$defs/'.length)];
    return next ? resolve(next, seen) : null;
  };
  const branches = alternatives.map((rule) => resolve(rule));
  if (!branches.length || branches.some((rule) => rule?.type !== 'object')) return null;
  for (const property of branches[0]!.required ?? []) {
    const constants = branches.map((rule) => rule?.properties?.[property]?.const);
    if (
      branches.every((rule) => rule?.required?.includes(property)) &&
      constants.every((value): value is string => typeof value === 'string') &&
      new Set(constants).size === branches.length
    )
      return { property, constants };
  }
  return null;
}
function scalarLength(value: string): number {
  let length = value.length;
  for (let at = 0; at < value.length; at++) {
    const high = value.charCodeAt(at);
    if (high < 0xd800 || high > 0xdbff) continue;
    const low = value.charCodeAt(at + 1);
    if (low >= 0xdc00 && low <= 0xdfff) {
      length--;
      at++;
    }
  }
  return length;
}
function compile(rule: Rule): Validate {
  const previous = compiled.get(rule);
  if (previous) return previous;
  let actual: Validate = () => false;
  const validate: Validate = (value, guard) => actual(value, guard);
  compiled.set(rule, validate);
  const referenced = rule.$ref ? schema.$defs[rule.$ref.slice('#/$defs/'.length)] : null;
  ensure(!rule.$ref || (rule.$ref.startsWith('#/$defs/') && referenced));
  const reference = referenced ? compile(referenced) : null;
  const alternatives = (rule.oneOf ?? rule.anyOf)?.map(compile);
  const tag = rule.oneOf ? disjointTag(rule.oneOf) : null;
  const tagged = tag
    ? new Map(tag.constants.map((value, index) => [value, alternatives![index]]))
    : null;
  const properties = Object.fromEntries(
    Object.entries(rule.properties ?? {}).map(([key, child]) => [key, compile(child)]),
  );
  const additional =
    typeof rule.additionalProperties === 'object' ? compile(rule.additionalProperties) : null;
  const item = rule.items ? compile(rule.items) : null;
  const keyShape = rule.propertyNames ? compile(rule.propertyNames) : null;
  const pattern = rule.pattern ? new RegExp(rule.pattern, 'u') : null;
  actual = (value, guard) => {
    guard();
    if (reference && !reference(value, guard)) return false;
    if (Object.hasOwn(rule, 'const') && value !== rule.const) return false;
    if (rule.enum && !rule.enum.includes(value)) return false;
    if (
      rule.type &&
      !(rule.type === 'null'
        ? value === null
        : rule.type === 'array'
          ? Array.isArray(value)
          : rule.type === 'object'
            ? object(value)
            : rule.type === 'integer'
              ? typeof value === 'number' && Number.isSafeInteger(value)
              : typeof value === rule.type)
    )
      return false;
    if (
      typeof value === 'number' &&
      ((rule.minimum !== undefined && value < rule.minimum) ||
        (rule.maximum !== undefined && value > rule.maximum))
    )
      return false;
    if (typeof value === 'string') {
      const length =
        rule.minLength !== undefined || rule.maxLength !== undefined ? scalarLength(value) : 0;
      if (
        (rule.minLength !== undefined && length < rule.minLength) ||
        (rule.maxLength !== undefined && length > rule.maxLength) ||
        (pattern && !pattern.test(value))
      )
        return false;
    }
    if (Array.isArray(value)) {
      if (
        (rule.minItems !== undefined && value.length < rule.minItems) ||
        (rule.maxItems !== undefined && value.length > rule.maxItems)
      )
        return false;
      if (
        rule.uniqueItems &&
        new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length
      )
        return false;
      if (item && !value.every((entry) => item(entry, guard))) return false;
    }
    if (object(value)) {
      if (rule.required?.some((key) => !Object.hasOwn(value, key))) return false;
      for (const [key, entry] of Object.entries(value)) {
        if (keyShape && !keyShape(key, guard)) return false;
        if (Object.hasOwn(properties, key)) {
          if (!properties[key](entry, guard)) return false;
        } else if (rule.additionalProperties === false || (additional && !additional(entry, guard)))
          return false;
      }
      for (const [key, required] of Object.entries(rule.dependentRequired ?? {}))
        if (Object.hasOwn(value, key) && required.some((name) => !Object.hasOwn(value, name)))
          return false;
    }
    if (alternatives) {
      if (tag && tagged) {
        const selected = object(value) ? tagged.get(value[tag.property] as string) : undefined;
        return selected ? selected(value, guard) : false;
      }
      let matches = 0;
      for (const alternative of alternatives) if (alternative(value, guard)) matches++;
      if (rule.oneOf ? matches !== 1 : matches === 0) return false;
    }
    return true;
  };
  return validate;
}
const requestShape = compile(schema.$defs.analysisRequest!);
const resultShape = compile(schema.$defs.analysisResult!);
const failureShape = compile(schema.$defs.analysisFailure!);
const identityKeys = [
  'contextId',
  'contextRevision',
  'documentRevision',
  'editId',
  'operationId',
] as const;
const refKeys = ['packageRef', 'programRef', 'subsetRef'] as const;
export function sameAnalysisIdentity(result: AnalysisResult, request: AnalysisRequest): boolean {
  return (
    identityKeys.every((key) => result.identity[key] === request.identity[key]) &&
    refKeys.every(
      (key) =>
        result.refs[key].id === request.refs[key].id &&
        result.refs[key].version === request.refs[key].version,
    )
  );
}
/** Independent canonical JSON encoding; no dynamic evaluation or user hashing. */
function canonical(value: Json): string {
  if (value === null || typeof value !== 'object') {
    ensure(typeof value !== 'number' || Number.isSafeInteger(value));
    if (typeof value === 'string') ensure(decoder.decode(encoder.encode(value)) === value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}
export function encodeAnalysisRequest(
  request: AnalysisRequest,
  catalog?: ExecutionCatalog,
): Uint8Array<ArrayBuffer> {
  ensure(request.analysisVersion === '1.0.0', 'E_PROTOCOL_VERSION');
  ensure(requestShape(request as unknown as Json, () => {}));
  ensure(encoder.encode(request.sourceText).byteLength <= 32768, 'E_SOURCE_LIMIT');
  if (catalog) {
    ensure(
      request.refs.packageRef.id === catalog.packageRef.id &&
        request.refs.packageRef.version === catalog.packageRef.version &&
        request.refs.programRef.id === catalog.program.id &&
        request.refs.programRef.version === catalog.program.version &&
        request.refs.subsetRef.id === catalog.program.subsetRef.id &&
        request.refs.subsetRef.version === catalog.program.subsetRef.version &&
        request.input.specRef?.id === catalog.program.inputRef.id &&
        request.input.specRef.version === catalog.program.inputRef.version,
      'E_CONTENT_MISMATCH',
    );
  }
  const bytes = encoder.encode(canonical(request as unknown as Json));
  ensure(bytes.byteLength <= 65536, 'E_REQUEST_LIMIT');
  return bytes;
}
function children(node: AnalysisNode): string[] {
  switch (node.kind) {
    case 'function':
      return [node.body];
    case 'block':
      return node.statements;
    case 'declaration':
      return node.initializer.kind === 'none'
        ? []
        : node.initializer.kind === 'scalar'
          ? [node.initializer.expression]
          : node.initializer.elements;
    case 'assignment':
      return [node.target, node.value];
    case 'if':
      return [node.condition, node.thenBlock, ...(node.elseBlock ? [node.elseBlock] : [])];
    case 'while':
      return [node.condition, node.body];
    case 'for':
      return [node.init, node.condition, node.update, node.body].filter(
        (id): id is string => id !== null,
      );
    case 'condition':
      return [node.expression];
    case 'output':
      return node.arguments;
    case 'return':
      return [node.value];
    case 'index':
      return [node.array, node.index];
    case 'unary':
      return [node.operand];
    case 'binary':
      return [node.left, node.right];
    default:
      return [];
  }
}
const expressionKinds = new Set(['integer', 'name', 'index', 'unary', 'binary']);
const statementKinds = new Set([
  'block',
  'declaration',
  'assignment',
  'if',
  'while',
  'for',
  'output',
  'return',
  'break',
  'continue',
  'empty',
]);
function validateRelationships(
  value: ValidAnalysisResult,
  request: AnalysisRequest,
  catalog: ExecutionCatalog | undefined,
  guard: () => void,
) {
  const points = sourceByteBoundaries(request.sourceText);
  const bytes = encoder.encode(request.sourceText);
  const range = (span: ByteRange) =>
    ensure(span.start < span.end && points.has(span.start) && points.has(span.end));
  const contains = (parent: ByteRange, child: ByteRange) =>
    parent.start <= child.start && parent.end >= child.end;
  const nodes = value.checkedAst.nodes;
  const lookup = new Map(nodes.map((node) => [node.nodeId, node]));
  ensure(
    lookup.size === nodes.length &&
      nodes[0]?.nodeId === value.checkedAst.rootId &&
      nodes[0].kind === 'function' &&
      nodes[0].parentId === null,
  );
  const seen = new Set<string>();
  const preorder: string[] = [];
  const stack: AnalysisNode[] = [nodes[0]];
  while (stack.length) {
    guard();
    const node = stack.pop()!;
    ensure(!seen.has(node.nodeId));
    seen.add(node.nodeId);
    preorder.push(node.nodeId);
    range(node.byteRange);
    const childNodes = children(node).map((id) => {
      const child = lookup.get(id);
      ensure(child && child.parentId === node.nodeId && contains(node.byteRange, child.byteRange));
      return child;
    });
    stack.push(...childNodes.reverse());
    const childKind = (id: string, allowed: Set<string>) =>
      ensure(allowed.has(lookup.get(id)?.kind ?? ''));
    const expression = (id: string) => childKind(id, expressionKinds);
    const block = (id: string) => childKind(id, new Set(['block']));
    switch (node.kind) {
      case 'function':
        block(node.body);
        break;
      case 'block':
        for (const id of node.statements) childKind(id, statementKinds);
        break;
      case 'condition':
        expression(node.expression);
        break;
      case 'declaration':
        range(node.nameRange);
        ensure(contains(node.byteRange, node.nameRange));
        ensure(node.arrayLength === null || BigInt(node.arrayLength) <= 2147483647n);
        if (node.initializer.kind === 'scalar') {
          ensure(node.arrayLength === null);
          expression(node.initializer.expression);
        }
        if (node.initializer.kind === 'array') {
          ensure(node.arrayLength !== null);
          for (const id of node.initializer.elements) expression(id);
        }
        break;
      case 'assignment':
        childKind(node.target, new Set(['name', 'index']));
        expression(node.value);
        break;
      case 'if':
        childKind(node.condition, new Set(['condition']));
        block(node.thenBlock);
        if (node.elseBlock) block(node.elseBlock);
        break;
      case 'while':
        childKind(node.condition, new Set(['condition']));
        block(node.body);
        break;
      case 'for':
        if (node.init) childKind(node.init, new Set(['declaration', 'assignment']));
        if (node.condition) childKind(node.condition, new Set(['condition']));
        if (node.update) childKind(node.update, new Set(['assignment']));
        block(node.body);
        break;
      case 'output':
        range(node.formatRange);
        ensure(contains(node.byteRange, node.formatRange));
        for (const id of node.arguments) expression(id);
        break;
      case 'return':
        expression(node.value);
        break;
      case 'integer':
        ensure(BigInt(node.value) <= 2147483647n);
        break;
      case 'name': {
        const declaration = lookup.get(node.resolvedDeclarationId);
        ensure(declaration?.kind === 'declaration' && declaration.name === node.name);
        break;
      }
      case 'index':
        childKind(node.array, new Set(['name']));
        expression(node.index);
        break;
      case 'unary':
        expression(node.operand);
        break;
      case 'binary':
        expression(node.left);
        expression(node.right);
        break;
    }
  }
  ensure(
    seen.size === nodes.length &&
      preorder.every((id, index) => id === nodes[index].nodeId && id === `n${index + 1}`),
  );
  ensure(value.nodeMap.length === nodes.length);
  nodes.forEach((node, index) => {
    const mapped = value.nodeMap[index];
    ensure(
      mapped.nodeId === node.nodeId &&
        mapped.parentId === node.parentId &&
        mapped.kind === (expressionKinds.has(node.kind) ? 'expression' : node.kind) &&
        mapped.byteRange.start === node.byteRange.start &&
        mapped.byteRange.end === node.byteRange.end,
    );
  });
  if (value.checkedAst.headerRange) {
    range(value.checkedAst.headerRange);
    ensure(value.checkedAst.headerRange.end <= nodes[0].byteRange.start);
  }
  const ranges = new Set(nodes.map((node) => `${node.byteRange.start}:${node.byteRange.end}`));
  const mappedIds = new Set<string>();
  const mappedNodes = new Set<string>();
  for (const mapped of value.blockMap) {
    guard();
    range(mapped.byteRange);
    const ordinal = /^block\.analysis\.([1-9][0-9]*)$/.exec(mapped.blockId)?.[1];
    const node = ordinal ? lookup.get(`n${ordinal}`) : undefined;
    ensure(
      !mappedIds.has(mapped.blockId) &&
        node &&
        node.byteRange.start === mapped.byteRange.start &&
        node.byteRange.end === mapped.byteRange.end &&
        ranges.has(`${mapped.byteRange.start}:${mapped.byteRange.end}`),
    );
    mappedIds.add(mapped.blockId);
    mappedNodes.add(node.nodeId);
  }
  for (const node of nodes)
    if (['function', 'if', 'while', 'for'].includes(node.kind))
      ensure(mappedNodes.has(node.nodeId));
  const bindingKeys = new Set<string>();
  const bindingDeclarations = new Map<string, string>();
  for (const mapped of value.bindingMap) {
    guard();
    range(mapped.byteRange);
    ensure(!bindingKeys.has(mapped.bindingKey));
    bindingKeys.add(mapped.bindingKey);
    const declaration = nodes.find(
      (node) =>
        node.kind === 'declaration' &&
        node.byteRange.start === mapped.byteRange.start &&
        node.byteRange.end === mapped.byteRange.end,
    );
    ensure(declaration?.kind === 'declaration');
    if (catalog) {
      const binding = catalog.program.bindings.find(
        (item) => item.bindingKey === mapped.bindingKey,
      );
      ensure(
        binding &&
          binding.targetName === declaration.name &&
          (binding.targetKind === 'array') === (declaration.arrayLength !== null),
      );
      bindingDeclarations.set(binding.targetName, declaration.nodeId);
    }
  }
  if (catalog)
    ensure(
      catalog.program.bindings.length === bindingKeys.size &&
        catalog.program.bindings.every((binding) => bindingKeys.has(binding.bindingKey)),
    );
  for (const node of nodes)
    if (node.kind === 'name' && bindingDeclarations.has(node.name))
      ensure(node.resolvedDeclarationId === bindingDeclarations.get(node.name));
  let triviaEnd = 0;
  for (const item of value.trivia) {
    guard();
    range(item.byteRange);
    ensure(item.byteRange.start >= triviaEnd);
    triviaEnd = item.byteRange.end;
    const text = decoder.decode(bytes.subarray(item.byteRange.start, item.byteRange.end));
    ensure(
      item.kind === 'line-comment'
        ? text.startsWith('//') && !/[\r\n]/.test(text)
        : item.kind === 'block-comment'
          ? text.startsWith('/*') && text.endsWith('*/')
          : /^[\t\n\v\f\r ]+$/.test(text),
    );
  }
}
async function run<T>(iterator: Generator<void, T, unknown>, guard: () => void): Promise<T> {
  let since = performance.now();
  let next = iterator.next();
  while (!next.done) {
    guard();
    if (performance.now() - since >= 6) {
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
      since = performance.now();
      guard();
    }
    next = iterator.next();
  }
  guard();
  return next.value;
}
export async function decodeAnalysisResult(
  buffer: ArrayBuffer,
  request: AnalysisRequest,
  catalog?: ExecutionCatalog,
  guard: () => void = () => {},
): Promise<AnalysisResult> {
  guard();
  ensure(buffer instanceof ArrayBuffer && buffer.byteLength > 0 && buffer.byteLength <= 16777216);
  const text = decoder.decode(buffer);
  const shape = await run(precheckJson(text), guard);
  const parsed =
    shape.containers > 4096 ? await run(parseChunked(text), guard) : (JSON.parse(text) as Json);
  guard();
  ensure(object(parsed) && parsed.analysisVersion === '1.0.0', 'E_PROTOCOL_VERSION');
  ensure((parsed.kind === 'analysisFailure' ? failureShape : resultShape)(parsed, guard));
  const result = parsed as unknown as AnalysisResult;
  ensure(sameAnalysisIdentity(result, request));
  if (result.kind === 'analysisResult' && result.status === 'valid')
    validateRelationships(result, request, catalog, guard);
  if (result.kind === 'analysisResult' && result.status === 'invalid') {
    const points = sourceByteBoundaries(request.sourceText);
    const staticCodes = new Set([
      'E_LEX_INVALID',
      'E_PARSE_INVALID',
      'E_UNSUPPORTED_SYNTAX',
      'E_NAME_INVALID',
      'E_TYPE_INVALID',
      'E_FORMAT_INVALID',
      'E_INPUT_INVALID',
      'E_INPUT_ORDER',
      'E_BINDING_INVALID',
      'E_CONTENT_MISMATCH',
    ]);
    for (const diagnostic of result.diagnostics) {
      ensure(
        diagnostic.origin === 'rust' &&
          ['lex', 'parse', 'semantic', 'preflight'].includes(diagnostic.stage) &&
          staticCodes.has(diagnostic.code),
      );
      if (diagnostic.location.kind === 'source' && diagnostic.location.byteRange) {
        const span = diagnostic.location.byteRange;
        ensure(span.start <= span.end && points.has(span.start) && points.has(span.end));
      }
    }
  }
  guard();
  return result;
}
