/** Independent STEP1.4 projector. It applies Rust facts and never evaluates C. */
import type {
  C6Change,
  C6Object,
  C6Pointer,
  C6Result,
  C6State,
  C6Step,
  C6Type,
  C6Value,
} from './c6-types';
export function c6Assert(value: unknown): asserts value {
  if (!value) throw new Error('E_PROTOCOL_INVALID');
}
export function c6Equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a))
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => c6Equal(v, b[i]));
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((k) => Object.hasOwn(y, k) && c6Equal(x[k], y[k]))
  );
}
const size = (s: string) => new TextEncoder().encode(s).length;
export class C6TypeTable {
  readonly types: Map<string, C6Type>;
  constructor(types: C6Type[]) {
    this.types = new Map(types.map((t) => [t.name, t]));
    c6Assert(types.length === this.types.size && types.length <= 128);
    const counts = new Set<string>();
    for (const t of types) {
      const get = (name: string | null) => {
        const value = name === null ? undefined : this.types.get(name);
        c6Assert(value);
        return value;
      };
      if (['int', 'uint', 'f32', 'pointer'].includes(t.kind))
        c6Assert(t.byteSize === 4 && t.alignment === 4);
      if (t.kind === 'char') c6Assert(t.byteSize === 1 && t.alignment === 1);
      if (t.kind === 'f64') c6Assert(t.byteSize === 8 && t.alignment === 8);
      if (t.kind === 'void') c6Assert(t.byteSize === 0 && t.alignment === 1);
      c6Assert(t.kind === 'struct' || t.fields.length === 0);
      if (t.kind === 'pointer') {
        const p = get(t.pointeeType);
        c6Assert(!['pointer', 'array', 'void'].includes(p.kind));
      } else c6Assert(t.pointeeType === null);
      if (t.kind === 'array') {
        const b = get(t.elementType);
        c6Assert(
          b.kind !== 'array' &&
            b.kind !== 'pointer' &&
            b.kind !== 'void' &&
            t.elementCount >= 1 &&
            t.elementCount <= (b.kind === 'char' ? 64 : 30) &&
            t.byteSize === b.byteSize * t.elementCount &&
            t.alignment === b.alignment,
        );
      } else c6Assert(t.elementType === null && t.elementCount === 0);
      if (t.kind === 'struct') {
        c6Assert(t.fields.length > 0 && t.fields.length <= 8);
        let at = 0,
          align = 1;
        const names = new Set<string>();
        for (const f of t.fields) {
          const b = get(f.typeName);
          c6Assert(!['struct', 'void'].includes(b.kind) && !names.has(f.name));
          names.add(f.name);
          at = Math.ceil(at / b.alignment) * b.alignment;
          c6Assert(at === f.byteOffset);
          at += b.byteSize;
          align = Math.max(align, b.alignment);
        }
        c6Assert(t.byteSize === Math.ceil(at / align) * align && t.alignment === align);
        const nominal = t.name.replace(/^const /, '');
        if (nominal.startsWith('struct ')) counts.add(nominal);
      }
    }
    c6Assert(counts.size <= 8);
  }
  get(name: string) {
    const t = this.types.get(name);
    c6Assert(t);
    return t;
  }
  slot(type: C6Type, offset: number): C6Type {
    c6Assert(Number.isInteger(offset) && offset >= 0 && offset < type.byteSize);
    if (type.kind === 'array')
      return this.slot(this.get(type.elementType!), offset % this.get(type.elementType!).byteSize);
    if (type.kind === 'struct') {
      const field = type.fields.find(
        (f) => offset >= f.byteOffset && offset < f.byteOffset + this.get(f.typeName).byteSize,
      );
      c6Assert(field);
      return this.slot(this.get(field.typeName), offset - field.byteOffset);
    }
    c6Assert(offset === 0 && type.kind !== 'void');
    return type;
  }
  compatible(a: C6Type, b: C6Type) {
    return (
      a.kind === b.kind &&
      a.byteSize === b.byteSize &&
      c6Equal(a.fields, b.fields) &&
      a.pointeeType === b.pointeeType &&
      a.elementType === b.elementType &&
      a.elementCount === b.elementCount
    );
  }
  value(value: C6Value, type: C6Type) {
    if (value === null) return;
    if (['int', 'uint', 'char'].includes(type.kind)) {
      c6Assert(
        typeof value === 'number' &&
          Number.isInteger(value) &&
          value >= (type.kind === 'int' ? -2147483648 : 0) &&
          value <= (type.kind === 'int' ? 2147483647 : type.kind === 'char' ? 127 : 4294967295),
      );
      return;
    }
    c6Assert(typeof value === 'object');
    if (type.kind === 'f32' || type.kind === 'f64') {
      c6Assert(
        'kind' in value &&
          value.kind === type.kind &&
          new RegExp(`^[0-9a-f]{${type.kind === 'f32' ? 8 : 16}}$`).test(value.bits),
      );
      const exponent =
        type.kind === 'f32'
          ? (BigInt(`0x${value.bits}`) >> 23n) & 255n
          : (BigInt(`0x${value.bits}`) >> 52n) & 2047n;
      c6Assert(exponent !== (type.kind === 'f32' ? 255n : 2047n));
      return;
    }
    c6Assert(
      type.kind === 'pointer' && 'pointeeType' in value && value.pointeeType === type.pointeeType,
    );
    this.pointer(value);
  }
  pointer(p: C6Pointer, objects?: C6Object[]) {
    const t = this.get(p.pointeeType);
    c6Assert(t.kind !== 'void' && t.kind !== 'pointer' && t.kind !== 'array');
    if (p.objectId === null) {
      c6Assert(p.byteOffset === 0 && p.lowerBound === 0 && p.upperBound === 0);
      return;
    }
    c6Assert(
      p.lowerBound >= 0 &&
        p.lowerBound < p.upperBound &&
        p.lowerBound <= p.byteOffset &&
        p.byteOffset <= p.upperBound &&
        (p.byteOffset - p.lowerBound) % t.byteSize === 0,
    );
    if (!objects) return;
    const object = objects.find((o) => o.id === p.objectId);
    c6Assert(object && p.upperBound <= object.byteLength);
    const domain = (ty: C6Type, offset: number): boolean => {
      if (
        this.compatible(ty, t) &&
        p.lowerBound === offset &&
        p.upperBound === offset + ty.byteSize
      )
        return true;
      if (ty.kind === 'array') {
        const element = this.get(ty.elementType!);
        if (
          this.compatible(element, t) &&
          p.lowerBound === offset &&
          p.upperBound === offset + ty.byteSize
        )
          return true;
        for (let i = 0; i < ty.elementCount; i++)
          if (domain(element, offset + i * element.byteSize)) return true;
      }
      if (ty.kind === 'struct')
        return ty.fields.some((f) => domain(this.get(f.typeName), offset + f.byteOffset));
      return false;
    };
    c6Assert(domain(this.get(object.typeName), 0));
  }
  default(object: C6Object, offset: number): C6Value {
    const type = this.slot(this.get(object.typeName), offset);
    if (!object.zeroInitialized) return null;
    if (type.kind === 'f32' || type.kind === 'f64')
      return { kind: type.kind, bits: '0'.repeat(type.kind === 'f32' ? 8 : 16) };
    if (type.kind === 'pointer')
      return {
        objectId: null,
        byteOffset: 0,
        lowerBound: 0,
        upperBound: 0,
        pointeeType: type.pointeeType!,
      };
    return 0;
  }
  cell(object: C6Object, offset: number): C6Value {
    const cell = object.cells.find((c) => c.byteOffset === offset);
    return cell ? cell.value : this.default(object, offset);
  }
  set(object: C6Object, offset: number, value: C6Value) {
    this.value(value, this.slot(this.get(object.typeName), offset));
    const at = object.cells.findIndex((c) => c.byteOffset >= offset),
      found = at >= 0 && object.cells[at].byteOffset === offset;
    if (c6Equal(value, this.default(object, offset))) {
      if (found) object.cells.splice(at, 1);
    } else if (found) object.cells[at] = { byteOffset: offset, value: structuredClone(value) };
    else
      object.cells.splice(at < 0 ? object.cells.length : at, 0, {
        byteOffset: offset,
        value: structuredClone(value),
      });
  }
}
function one(state: C6State, c: C6Change, types: C6TypeTable, reverse: boolean, kind: string) {
  if (c.op === 'output') {
    const before = reverse ? c.afterBytes : c.beforeBytes;
    const after = reverse ? c.beforeBytes : c.afterBytes;
    c6Assert(size(state.output) === before && c.afterBytes === c.beforeBytes + size(c.append));
    if (reverse) {
      c6Assert(state.output.endsWith(c.append));
      state.output = state.output.slice(0, state.output.length - c.append.length);
    } else state.output += c.append;
    c6Assert(size(state.output) === after);
    return;
  }
  if (c.op === 'record') {
    const before = reverse ? c.after : c.before,
      after = reverse ? c.before : c.after;
    const table = state[c.table];
    c6Assert(c.index >= 0 && c.index <= table.length);
    if (before === null) {
      c6Assert(after !== null && after.id === c.id && c.index <= table.length);
      (table as (typeof after)[]).splice(c.index, 0, structuredClone(after));
    } else {
      c6Assert(before.id === c.id && c6Equal(table[c.index], before));
      if (after === null) table.splice(c.index, 1);
      else {
        c6Assert(after.id === c.id);
        (table as (typeof after)[])[c.index] = structuredClone(after);
      }
    }
  } else if (c.op === 'cell') {
    const before = reverse ? c.after : c.before,
      after = reverse ? c.before : c.after;
    const at = state.objects.findIndex((o) => o.id === c.objectId),
      object = state.objects[at];
    c6Assert(
      object &&
        object.alive &&
        (object.writable || kind === 'value.initialize') &&
        c6Equal(types.cell(object, c.byteOffset), before),
    );
    const changed = { ...object, cells: object.cells.slice() };
    types.set(changed, c.byteOffset, after as C6Value);
    state.objects[at] = changed;
  } else {
    const before = reverse ? c.after : c.before,
      after = reverse ? c.before : c.after;
    c6Assert(c6Equal(state[c.op], before));
    Object.assign(state, { [c.op]: structuredClone(after) });
  }
}
/** A malformed later atom restores the entire previously accepted state. */
export function applyC6Step(state: C6State, step: C6Step, types: C6TypeTable, reverse = false) {
  const changes = reverse ? [...step.changes].reverse() : step.changes,
    applied: C6Change[] = [];
  try {
    for (const c of changes) {
      one(state, c, types, reverse, step.kind);
      applied.push(c);
    }
  } catch (error) {
    for (const c of applied.reverse()) one(state, c, types, !reverse, step.kind);
    throw error;
  }
}
export class C6Player {
  readonly types: C6TypeTable;
  readonly state: C6State;
  cursor = 0;
  constructor(readonly result: C6Result) {
    c6Assert(result.trace);
    this.types = new C6TypeTable(result.types);
    this.state = structuredClone(result.trace.initialState);
  }
  seek(cursor: number) {
    c6Assert(
      this.result.trace &&
        Number.isInteger(cursor) &&
        cursor >= 0 &&
        cursor <= this.result.trace.steps.length,
    );
    while (this.cursor < cursor) {
      applyC6Step(this.state, this.result.trace.steps[this.cursor], this.types);
      this.cursor++;
    }
    while (this.cursor > cursor) {
      applyC6Step(this.state, this.result.trace.steps[this.cursor - 1], this.types, true);
      this.cursor--;
    }
    return this.state;
  }
}
