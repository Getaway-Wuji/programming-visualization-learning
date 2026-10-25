/** Published input declarations prepared by Rust at build time.
 * Only finite input literals are formatted here; execution always goes through
 * the ordinary Rust request, source, binding and input validation path.
 */
import type { EntityRef, InputBinding, InputValues } from '../content/types';
import { preparedSourceManifest } from '../generated/prepared-sources';
import type { ExecutionCatalog, PreparedSource } from './execution-client';
import { validateInputValues } from './input-data';

export interface PreparedSourceEntry {
  readonly catalogSha256: string;
  readonly packageRef: EntityRef;
  readonly subjectRef: EntityRef;
  readonly programRef: EntityRef;
  readonly inputSpecRef: EntityRef;
  readonly sourceSha256: string;
  /** SHA-256 of canonical JSON for the complete template, including byte ranges. */
  readonly templateSha256: string;
  readonly template: PreparedSource;
}
export interface PreparedSourceManifest {
  readonly preparationVersion: '1.0.0';
  readonly protocolVersion: '1.0.0';
  readonly entries: readonly PreparedSourceEntry[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const noop = () => {};
const sameRef = (left: EntityRef, right: EntityRef) =>
  left?.id === right?.id && left?.version === right?.version;
const ref = ({ id, version }: EntityRef): EntityRef => ({ id, version });

// Refuse non-JSON fields instead of allowing JSON.stringify to silently omit
// them from the identity hash. Published catalog property names are ASCII.
function canonical(value: unknown, guard: () => void, depth = 0): string {
  guard();
  if (depth > 32) throw new Error('PREPARED_METADATA');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('PREPARED_METADATA');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    for (const character of value) {
      const point = character.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff) throw new Error('PREPARED_METADATA');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error('PREPARED_METADATA');
    const items: string[] = [];
    for (let at = 0; at < value.length; at++) {
      if (!Object.hasOwn(value, at)) throw new Error('PREPARED_METADATA');
      items.push(canonical(value[at], guard, depth + 1));
    }
    return `[${items.join(',')}]`;
  }
  if (!value || typeof value !== 'object') throw new Error('PREPARED_METADATA');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('PREPARED_METADATA');
  const object = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(object);
  if (
    keys.some(
      (key) =>
        typeof key !== 'string' ||
        !/^[\x20-\x7e]+$/.test(key) ||
        !Object.getOwnPropertyDescriptor(object, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(object, key)!, 'value'),
    )
  )
    throw new Error('PREPARED_METADATA');
  return `{${(keys as string[])
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key], guard, depth + 1)}`)
    .join(',')}}`;
}
async function sha256(text: string, guard: () => void): Promise<string> {
  guard();
  const result = await crypto.subtle.digest('SHA-256', encoder.encode(text).buffer);
  guard();
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function declaration(binding: InputBinding, values: InputValues): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding.targetName)) return null;
  const item = values[binding.inputKey];
  if (binding.targetKind === 'scalar' && binding.from === 'field' && typeof item === 'number')
    return `int ${binding.targetName} = ${item};`;
  if (
    binding.targetKind === 'logical-length' &&
    binding.from === 'length-of' &&
    Array.isArray(item)
  )
    return `int ${binding.targetName} = ${item.length};`;
  if (
    binding.targetKind === 'array' &&
    binding.from === 'field' &&
    binding.emptyStorage === 'one-zero-placeholder' &&
    Array.isArray(item)
  )
    return `int ${binding.targetName}[${Math.max(1, item.length)}] = {${item.length ? item.join(', ') : '0'}};`;
  return null;
}
function boundary(bytes: Uint8Array, at: number): boolean {
  return (
    Number.isSafeInteger(at) &&
    at >= 0 &&
    at <= bytes.length &&
    (at === bytes.length || (bytes[at] & 0xc0) !== 0x80) &&
    !(at > 0 && bytes[at - 1] === 13 && bytes[at] === 10)
  );
}
function bind(
  catalog: ExecutionCatalog,
  template: PreparedSource,
  values: InputValues,
  guard: () => void,
): PreparedSource | null {
  if (
    !template ||
    Object.keys(template).sort().join() !== 'bindingMap,blockMap,text' ||
    typeof template.text !== 'string' ||
    !Array.isArray(template.blockMap) ||
    !Array.isArray(template.bindingMap) ||
    template.bindingMap.length !== catalog.program.bindings.length
  )
    return null;
  const original = encoder.encode(template.text);
  if (original.length > 32768 || decoder.decode(original) !== template.text) return null;
  const bindings = new Map(catalog.program.bindings.map((entry) => [entry.bindingKey, entry]));
  if (bindings.size !== catalog.program.bindings.length) return null;
  const pieces: Uint8Array[] = [];
  const bindingMap: PreparedSource['bindingMap'] = [];
  let previous = 0;
  let size = 0;
  for (const entry of template.bindingMap) {
    guard();
    if (
      !entry ||
      Object.keys(entry).sort().join() !== 'bindingKey,byteRange' ||
      !entry.byteRange ||
      Object.keys(entry.byteRange).sort().join() !== 'end,start'
    )
      return null;
    const binding = bindings.get(entry.bindingKey);
    const { start, end } = entry.byteRange;
    if (
      !binding ||
      start < previous ||
      end <= start ||
      !boundary(original, start) ||
      !boundary(original, end) ||
      decoder.decode(original.subarray(start, end)) !==
        declaration(binding, catalog.program.exampleInput)
    )
      return null;
    const text = declaration(binding, values);
    if (text === null) return null;
    const prefix = original.subarray(previous, start);
    const replacement = encoder.encode(text);
    pieces.push(prefix, replacement);
    size += prefix.length;
    bindingMap.push({
      bindingKey: entry.bindingKey,
      byteRange: { start: size, end: size + replacement.length },
    });
    size += replacement.length;
    previous = end;
    bindings.delete(entry.bindingKey);
  }
  if (bindings.size !== 0) return null;
  // Rust supplies the reviewed control-node ranges too. Moving byte endpoints
  // across declaration edits preserves them without parsing any C statement.
  const relocate = (at: number): number | null => {
    let shift = 0;
    for (let index = 0; index < template.bindingMap.length; index++) {
      const before = template.bindingMap[index].byteRange;
      const after = bindingMap[index].byteRange;
      if (at <= before.start) return at + shift;
      if (at < before.end) return null;
      shift += after.end - after.start - (before.end - before.start);
    }
    return at + shift;
  };
  const blockMap: PreparedSource['blockMap'] = [];
  const blockIds = new Set<string>();
  for (const block of template.blockMap) {
    guard();
    if (
      !block ||
      Object.keys(block).sort().join() !== 'blockId,byteRange' ||
      !/^control-(if|while|for)-[1-9][0-9]*$/.test(block.blockId) ||
      blockIds.has(block.blockId) ||
      !block.byteRange ||
      Object.keys(block.byteRange).sort().join() !== 'end,start' ||
      block.byteRange.start >= block.byteRange.end ||
      !boundary(original, block.byteRange.start) ||
      !boundary(original, block.byteRange.end)
    )
      return null;
    const start = relocate(block.byteRange.start);
    const end = relocate(block.byteRange.end);
    if (start === null || end === null) return null;
    blockIds.add(block.blockId);
    blockMap.push({ blockId: block.blockId, byteRange: { start, end } });
  }
  const suffix = original.subarray(previous);
  pieces.push(suffix);
  size += suffix.length;
  if (size > 32768) throw new Error('E_SOURCE_LIMIT');
  const output = new Uint8Array(size);
  let offset = 0;
  for (const piece of pieces) {
    guard();
    output.set(piece, offset);
    offset += piece.length;
  }
  return { text: decoder.decode(output), blockMap, bindingMap };
}

/** A miss always falls back to real Rust prepare; no unpublished catalog is trusted. */
export async function tryPreparePublishedSource(
  catalog: ExecutionCatalog,
  values: InputValues,
  guard: () => void = noop,
): Promise<PreparedSource | null> {
  guard();
  if (
    preparedSourceManifest.preparationVersion !== '1.0.0' ||
    preparedSourceManifest.protocolVersion !== '1.0.0' ||
    !Array.isArray(preparedSourceManifest.entries)
  )
    return null;
  const candidates = preparedSourceManifest.entries.filter(
    (entry) =>
      sameRef(entry.packageRef, catalog.packageRef) &&
      sameRef(entry.subjectRef, catalog.subject) &&
      sameRef(entry.programRef, catalog.program) &&
      sameRef(entry.inputSpecRef, catalog.inputSpec) &&
      sameRef(entry.programRef, catalog.subject.programRef) &&
      sameRef(entry.inputSpecRef, catalog.program.inputRef),
  );
  if (candidates.length !== 1) return null;
  // Do not retain mutable caller objects across the independent hash awaits.
  let snapshot: ExecutionCatalog;
  let entry: PreparedSourceEntry;
  let catalogText: string;
  let templateText: string;
  let selected: ReturnType<typeof validateInputValues>;
  try {
    catalogText = canonical(catalog, guard);
    if (encoder.encode(catalogText).byteLength > 65536) return null;
    snapshot = JSON.parse(catalogText) as ExecutionCatalog;
    entry = structuredClone(candidates[0]);
    templateText = canonical(entry.template, guard);
    if (encoder.encode(templateText).byteLength > 65536) return null;
    // Validation also copies each accepted input array before the first await.
    // Defer reporting invalid input until the complete catalog really matches.
    selected = validateInputValues(snapshot.inputSpec, values);
  } catch (error) {
    guard();
    if (error instanceof Error && /^E_[A-Z_]+$/.test(error.message)) throw error;
    return null;
  }
  if (
    (await sha256(catalogText, guard)) !== entry.catalogSha256 ||
    (await sha256(snapshot.program.sourceExample, guard)) !== entry.sourceSha256 ||
    (await sha256(templateText, guard)) !== entry.templateSha256
  )
    return null;
  guard();
  if (!selected.ok) throw new Error('E_INPUT_INVALID');
  const source = bind(snapshot, entry.template, selected.values, guard);
  guard();
  // Explicitly preserve identity/ref checks independently of the catalog digest.
  if (!sameRef(ref(snapshot.program), entry.programRef)) return null;
  return source;
}
