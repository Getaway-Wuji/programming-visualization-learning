import { C6TypeTable } from '../engine/c6-player';
import type { C6Object, C6Type, C6Value } from '../engine/c6-types';

/** Decode display values and virtual layout only; all values come from Rust state. */
export function c6ValueText(value: C6Value, objects: readonly C6Object[]): string {
  if (value === null) return '未初始化';
  if (typeof value === 'number') return String(value);
  if ('bits' in value) {
    const bytes = new DataView(new ArrayBuffer(8));
    if (value.kind === 'f32') bytes.setUint32(0, Number.parseInt(value.bits, 16));
    else bytes.setBigUint64(0, BigInt(`0x${value.bits}`));
    return `${value.kind === 'f32' ? bytes.getFloat32(0) : bytes.getFloat64(0)} · 0x${value.bits}`;
  }
  if (value.objectId === null) return 'NULL';
  const object = objects.find((o) => o.id === value.objectId);
  return `${value.objectId} + ${value.byteOffset} 字节${object ? ` · 虚拟 0x${(object.baseAddress + value.byteOffset).toString(16)}` : ''}`;
}
export function c6ObjectSlots(
  object: C6Object,
  table: C6TypeTable,
): { name: string; byteOffset: number; typeName: string; value: C6Value }[] {
  const slots: { name: string; byteOffset: number; typeName: string; value: C6Value }[] = [];
  const visit = (type: C6Type, offset: number, name: string) => {
    if (type.kind === 'array') {
      const element = table.get(type.elementType!);
      for (let i = 0; i < type.elementCount; ++i)
        visit(element, offset + i * element.byteSize, `${name}[${i}]`);
    } else if (type.kind === 'struct') {
      for (const field of type.fields)
        visit(table.get(field.typeName), offset + field.byteOffset, `${name}.${field.name}`);
    } else
      slots.push({
        name,
        byteOffset: offset,
        typeName: type.name,
        value: table.cell(object, offset),
      });
  };
  visit(table.get(object.typeName), 0, object.name);
  return slots;
}
