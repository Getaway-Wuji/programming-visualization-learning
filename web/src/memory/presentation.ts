import type {
  MemoryObject,
  MemoryPointer,
  MemoryState,
  MemoryType,
  MemoryValue,
} from '../engine/memory-protocol';

export const MEMORY_PAGE_SIZE = 16;
export const memoryStepLabels: Record<string, string> = {
  'memory.allocate': '分配动态对象',
  'memory.release': '释放动态对象',
  'pointer.write': '更新指针',
  'program.enter': '进入程序',
  'function.enter': '进入函数',
  'function.return': '函数返回',
  'program.return': '程序返回',
  'object.declare': '声明对象',
  'value.initialize': '初始化值',
  'value.write': '写入值',
  condition: '判断条件',
  'scope.enter': '进入作用域',
  'scope.exit': '离开作用域',
  'output.append': '输出结果',
  'input.read': '读取输入',
  'control.jump': '转移执行位置',
  nop: '空语句',
};
export const virtualAddress = (value: number) => `0x${value.toString(16).toUpperCase()}`;
export function pointerPresentation(pointer: MemoryPointer, state: MemoryState) {
  if (pointer.objectId === null) return { kind: 'null', label: '空指针', address: null };
  const target = state.objects.find((object) => object.id === pointer.objectId);
  const address = target ? virtualAddress(target.baseAddress + pointer.byteOffset) : null;
  if (!target) return { kind: 'missing', label: '对象不存在', address };
  if (!target.alive) return { kind: 'dangling', label: '悬空引用', address };
  if (pointer.byteOffset === pointer.upperBound)
    return { kind: 'one-past', label: '尾后指针，不可解引用', address };
  return { kind: 'valid', label: '有效引用', address };
}
export function memoryValueText(value: MemoryValue, state: MemoryState): string {
  if (value === null) return '未初始化';
  if (typeof value === 'number') return String(value);
  const pointer = pointerPresentation(value, state);
  return value.objectId === null
    ? pointer.label
    : `${value.objectId} + ${value.byteOffset} 字节 → ${pointer.address} · ${pointer.label}`;
}
export function slotCount(object: MemoryObject, types: readonly MemoryType[]) {
  const type = types.find((item) => item.name === object.typeName)!;
  return object.length * (type.kind === 'struct' ? type.fields.length : 1);
}
/** Bounded layout projection from the wire type table; never evaluates program expressions. */
export function memorySlots(object: MemoryObject, types: readonly MemoryType[], page = 0) {
  if (!object.alive) return [];
  const type = types.find((item) => item.name === object.typeName)!;
  const fields =
    type.kind === 'struct' ? type.fields : [{ name: '', typeName: type.name, byteOffset: 0 }];
  const count = slotCount(object, types);
  const start =
    Math.max(0, Math.min(Math.floor(page), Math.max(0, Math.ceil(count / MEMORY_PAGE_SIZE) - 1))) *
    MEMORY_PAGE_SIZE;
  return Array.from({ length: Math.min(MEMORY_PAGE_SIZE, count - start) }, (_, index) => {
    const ordinal = start + index;
    const element = Math.floor(ordinal / fields.length);
    const field = fields[ordinal % fields.length];
    const byteOffset = element * type.byteSize + field.byteOffset;
    const slotType = types.find((item) => item.name === field.typeName)!;
    const fallback: MemoryValue = !object.zeroInitialized
      ? null
      : slotType.kind === 'int'
        ? 0
        : {
            objectId: null,
            byteOffset: 0,
            lowerBound: 0,
            upperBound: 0,
            pointeeType: slotType.pointeeType!,
          };
    const value = object.cells.find((cell) => cell.byteOffset === byteOffset)?.value ?? fallback;
    // An explicit null is an uninitialized slot, even on a zero-initialized object.
    const explicit = object.cells.find((cell) => cell.byteOffset === byteOffset);
    return {
      ordinal,
      name: `${object.name}${object.length > 1 ? `[${element}]` : ''}${field.name ? `.${field.name}` : ''}`,
      typeName: field.typeName,
      byteOffset,
      address: virtualAddress(object.baseAddress + byteOffset),
      value: explicit ? explicit.value : value,
    };
  });
}

export const memoryDiagnostics: Record<string, string> = {
  E_NULL_POINTER: '尝试访问空指针。先让指针指向存活对象。',
  E_UNINITIALIZED: '尝试读取未初始化的值。先完成初始化。',
  E_DANGLING_POINTER: '指向的对象已经离开作用域或被释放。',
  E_POINTER_BOUNDS: '指针超出可访问范围；尾后位置只能用于边界，不能解引用。',
  E_INVALID_DELETE: '只能释放由单对象 new 获得的原始指针。',
  E_DOUBLE_DELETE: '同一对象已被释放，不能再次 delete。',
  E_CANCELLED: '已取消运行，可以重新运行。',
  E_DEADLINE: '本次运行已超时，可以重新运行。',
};
