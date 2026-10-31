import type { AlgorithmResult, AlgorithmState, AlgorithmStep } from '../engine/algorithm-protocol';
import { slotValue } from '../algorithms/presentation';
import type { StructureCase, PreparedStructure } from './content';
export function scalarValue(state: AlgorithmState, name: string) {
  const object = state.objects.find((o) => o.name === name && o.kind === 'int');
  return object ? slotValue(object, 0) : null;
}
/** Read-only layout projection from the current trace state; no operation tape is accepted. */
export function structureView(
  state: AlgorithmState,
  step: AlgorithmStep | null,
  spec: StructureCase,
) {
  const data = state.objects.find((o) => o.name === 'data' && o.kind === 'int-array'),
    top = scalarValue(state, 'top'),
    head = scalarValue(state, 'head'),
    tail = scalarValue(state, 'tail');
  const quantity =
    spec.kind === 'stack' ? top : head !== null && tail !== null ? tail - head : null;
  const ready = quantity !== null && (spec.kind === 'stack' || (head !== null && tail !== null)),
    layoutValid =
      ready &&
      quantity >= 0 &&
      quantity <= spec.capacity &&
      (spec.kind === 'stack' || (head! >= 0 && tail! >= head!));
  const indices = layoutValid
    ? Array.from({ length: quantity }, (_, i) =>
        spec.kind === 'stack' ? i : (head! + i) % spec.capacity,
      )
    : null;
  const writeSet = new Set(
    step?.changes.flatMap((c) => (c.op === 'cell' && c.objectId === data?.id ? [c.index] : [])) ??
      [],
  );
  return {
    data,
    top,
    head,
    tail,
    quantity,
    layoutValid,
    layoutIssue: ready && !layoutValid,
    indices,
    logical:
      indices && data ? indices.map((index) => ({ index, value: slotValue(data, index) })) : null,
    reader: layoutValid
      ? spec.kind === 'stack'
        ? quantity > 0
          ? quantity - 1
          : null
        : head! % spec.capacity
      : null,
    writer: layoutValid
      ? spec.kind === 'stack'
        ? quantity < spec.capacity
          ? quantity
          : null
        : tail! % spec.capacity
      : null,
    outcome: scalarValue(state, 'outcome'),
    processed: scalarValue(state, 'processed'),
    cells: data
      ? Array.from({ length: spec.capacity }, (_, index) => ({
          index,
          value: slotValue(data, index),
          valid: indices ? indices.includes(index) : null,
          write: writeSet.has(index),
          virtualAddress: data.baseAddress + index * 4,
        }))
      : [],
  };
}
export const outcomeText: Record<number, string> = {
  0: '尚无结果 / 本条处理中',
  1: '入操作成功',
  2: '出操作成功',
  3: '已满，本次入被拒绝',
  4: '为空，本次出被拒绝',
  5: '非法内部编码，停止',
};
export function structureExplanation(
  result: AlgorithmResult,
  cursor: number,
  prepared: PreparedStructure,
) {
  const step = cursor ? (result.trace?.steps[cursor - 1] ?? null) : null,
    range = step ? (result.nodeMap.find((n) => n.nodeId === step.nodeId)?.byteRange ?? null) : null;
  const phase = range ? prepared.phases.findLast((p) => p.start <= range.start) : null;
  const lifecycle: Record<string, [string, string]> = {
    'program.enter': ['进入main', '建立真实执行帧；数据结构栈与运行调用栈不是同一对象。'],
    'program.return': ['main已返回', '自动对象与作用域按真实步骤离开，后退可恢复完整状态。'],
    'scope.enter': ['进入当前作用域', '这是实际源码块的进入步骤，不等于又执行了一条业务操作。'],
    'scope.exit': [
      '结束当前作用域',
      '局部对象按本步真实变化离开；main的数据数组在自身作用域结束前仍保留。',
    ],
  };
  const event = step ? lifecycle[step.kind] : undefined;
  return {
    step,
    range,
    title: event?.[0] ?? phase?.title ?? '初始状态',
    explanation:
      event?.[1] ?? phase?.explanation ?? '尚未执行源码步骤；当前没有预演或预填的数据结构。',
  };
}
