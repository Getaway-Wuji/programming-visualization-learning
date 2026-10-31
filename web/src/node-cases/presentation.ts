import type {
  MemoryObject,
  MemoryPointer,
  MemoryResult,
  MemoryState,
  MemoryStep,
  MemoryType,
  MemoryValue,
} from '../engine/memory-protocol';
import { memorySlots, memoryValueText, pointerPresentation } from '../memory/presentation';
import type { NodeCase, PreparedNodeCase } from './content';
export function mainObject(state: MemoryState, name: string) {
  const main = state.frames.find((f) => f.parentFrameId === null);
  return main
    ? state.objects.find((o) => o.alive && o.frameId === main.id && o.name === name)
    : undefined;
}
export function objectValue(object: MemoryObject | undefined, types: readonly MemoryType[]) {
  return object ? (memorySlots(object, types)[0]?.value ?? null) : null;
}
export function mainScalar(state: MemoryState, types: readonly MemoryType[], name: string) {
  const v = objectValue(mainObject(state, name), types);
  return typeof v === 'number' ? v : null;
}
export function pointerView(value: MemoryValue, state: MemoryState) {
  if (value === null) return { kind: 'uninitialized', label: '未初始化', value: null };
  if (typeof value === 'number')
    return { kind: 'unexpected', label: `非指针值${value}`, value: null };
  return { ...pointerPresentation(value, state), label: memoryValueText(value, state), value };
}
/** Current object/edge layout only: no operation tape, insertion/search logic or traversal answers. */
export function nodesView(
  state: MemoryState,
  types: readonly MemoryType[],
  spec: NodeCase,
  step: MemoryStep | null = null,
) {
  const anchorName = spec.kind === 'list' ? 'head' : 'root',
    anchorObject = mainObject(state, anchorName),
    anchor = pointerView(objectValue(anchorObject, types), state),
    type = types.find((t) => t.name === 'Node');
  const all = state.objects.filter((o) => o.typeName === 'Node' && o.storage === 'heap');
  const live = all
    .filter((o) => o.alive)
    .map((object) => {
      const slots = memorySlots(object, types),
        value = slots.find(
          (s) => s.byteOffset === type!.fields.find((f) => f.name === 'value')!.byteOffset,
        )!.value;
      const fields = (type?.fields ?? [])
        .filter((f) => f.name !== 'value')
        .map((field) => {
          const raw = slots.find((s) => s.byteOffset === field.byteOffset)!.value;
          return { name: field.name, byteOffset: field.byteOffset, ...pointerView(raw, state) };
        });
      const changed =
        step?.changes.some((c) => c.op === 'cell' && c.objectId === object.id) ||
        step?.changes.some((c) => c.op === 'record' && c.table === 'objects' && c.id === object.id);
      return { object, value, fields, changed: Boolean(changed) };
    });
  const byId = new Map(live.map((n) => [n.object.id, n]));
  // Follow only recorded valid links for placement; these levels are not a traversal result.
  const depths = new Map<string, number>(),
    queue: { id: string; depth: number }[] = [];
  if (anchor.kind === 'valid' && anchor.value?.objectId && byId.has(anchor.value.objectId))
    queue.push({ id: anchor.value.objectId, depth: 0 });
  for (let i = 0; i < queue.length && i <= live.length * 3; i++) {
    const q = queue[i];
    if (depths.has(q.id)) continue;
    depths.set(q.id, q.depth);
    for (const f of byId.get(q.id)!.fields)
      if (
        f.kind === 'valid' &&
        f.value?.objectId &&
        byId.has(f.value.objectId) &&
        !depths.has(f.value.objectId)
      )
        queue.push({ id: f.value.objectId, depth: q.depth + 1 });
  }
  const pendingDepth = depths.size ? Math.max(...depths.values()) + 1 : 0,
    width = spec.kind === 'list' ? 380 : 680;
  const groups = new Map<number, string[]>();
  for (const n of live) {
    const d = depths.get(n.object.id) ?? pendingDepth;
    groups.set(d, [...(groups.get(d) ?? []), n.object.id]);
  }
  const nodes = live.map((n) => {
    const reachable = depths.has(n.object.id),
      depth = depths.get(n.object.id) ?? pendingDepth,
      group = groups.get(depth)!;
    return {
      ...n,
      reachable,
      x: ((group.indexOf(n.object.id) + 1) * width) / (group.length + 1),
      y: 70 + depth * 112,
    };
  });
  const positions = new Map(nodes.map((n) => [n.object.id, n]));
  const edges = nodes.flatMap((n) =>
    n.fields
      .filter((f) => f.kind === 'valid' && f.value?.objectId && positions.has(f.value.objectId))
      .map((f) => ({
        from: n.object.id,
        to: f.value!.objectId!,
        field: f.name,
        start: { x: n.x, y: n.y + 30 },
        end: {
          x: positions.get(f.value!.objectId!)!.x,
          y: positions.get(f.value!.objectId!)!.y - 30,
        },
      })),
  );
  const pointers = state.objects
    .filter((o) => o.alive && types.find((t) => t.name === o.typeName)?.kind === 'pointer')
    .map((object) => ({ object, ...pointerView(objectValue(object, types), state) }));
  return {
    anchorName,
    anchorObject,
    anchor,
    nodes,
    edges,
    pointers,
    ended: all.filter((o) => !o.alive),
    reachableCount: depths.size,
    width,
    height: live.length ? Math.max(...nodes.map((n) => n.y)) + 70 : 120,
    size: mainScalar(state, types, 'size'),
    processed: mainScalar(state, types, 'processed'),
    outcome: mainScalar(state, types, 'outcome'),
    consumed: mainScalar(state, types, 'consumed'),
  };
}
export const nodeOutcomeText: Record<number, string> = {
  0: '本条处理中 / 尚无结果',
  1: '插入成功',
  2: '删除成功',
  3: '遍历完成',
  4: '已满，插入拒绝',
  5: '位置非法，操作拒绝',
  6: '重复值，插入拒绝',
  7: '已找到',
  8: '未找到',
  9: '未知编码，停止',
};
export function nodeExplanation(result: MemoryResult, cursor: number, prepared: PreparedNodeCase) {
  const step = cursor ? (result.trace?.steps[cursor - 1] ?? null) : null,
    range = step ? (result.nodeMap.find((n) => n.nodeId === step.nodeId)?.byteRange ?? null) : null,
    phase = range ? prepared.phases.findLast((p) => p.start <= range.start) : null;
  const events: Record<string, [string, string]> = {
    'program.enter': ['进入main', '建立真实帧；入口、计数和节点尚待实际声明。'],
    'program.return': ['main返回', '自动对象死亡，已清理heap保留墓碑；后退恢复全部实际对象。'],
    'function.enter': ['进入实际调用帧', '形参是本次调用的真实对象；不是新建第二份树或链表。'],
    'function.return': [
      '返回实际调用者',
      '返回值和调用帧按本步变化恢复调用者；刚返回帧的局部不冒充当前对象。',
    ],
    'scope.enter': ['进入源码作用域', '这是实际块边界，不表示完成新命令。'],
    'scope.exit': ['离开源码作用域', '自动对象成为墓碑；heap是否结束以实际delete为准。'],
  };
  const event = step ? events[step.kind] : undefined;
  return {
    title: event?.[0] ?? phase?.title ?? '初始状态',
    explanation:
      event?.[1] ?? phase?.explanation ?? '尚未执行任何操作，图形、内存和栈共用一个实际游标。',
  };
}
export type NodePointer = MemoryPointer;
