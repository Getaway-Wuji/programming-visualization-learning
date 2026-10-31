import type {
  AlgorithmObject,
  AlgorithmResult,
  AlgorithmState,
  AlgorithmStep,
} from '../engine/algorithm-protocol';
import type { PreparedSort } from './types';
export function slotValue(object: AlgorithmObject, index: number): number | null {
  return object.cells.find((cell) => cell.index === index)?.value ?? object.defaultValue;
}
export function sortExplanation(result: AlgorithmResult, cursor: number, prepared: PreparedSort) {
  const step = cursor ? result.trace?.steps[cursor - 1] : null;
  if (!step)
    return {
      title: '初始状态',
      explanation: '尚未执行源码步骤；前进后查看真实存储与输入。',
      step: null,
      range: null,
    };
  const range = result.nodeMap.find((node) => node.nodeId === step.nodeId)?.byteRange ?? null;
  const phase = range ? prepared.phases.findLast((phase) => phase.start <= range.start) : undefined;
  return {
    title: phase?.title ?? '执行程序',
    explanation: phase?.explanation ?? '按实际源码位置查看该步变化。',
    step,
    range,
  };
}
export function writtenSlots(step: AlgorithmStep | null, object: AlgorithmObject) {
  const slots = new Set<number>();
  for (const change of step?.changes ?? []) {
    if (change.op === 'cell' && change.objectId === object.id) slots.add(change.index);
    if (
      change.op === 'record' &&
      change.table === 'objects' &&
      change.id === object.id &&
      change.after &&
      'cells' in change.after &&
      step?.kind === 'value.initialize'
    )
      for (let index = 0; index < object.length; index++) slots.add(index);
  }
  return slots;
}
export function changedValues(step: AlgorithmStep | null, state: AlgorithmState) {
  return (step?.changes ?? []).flatMap((change) => {
    if (change.op !== 'cell') return [];
    const object = state.objects.find((object) => object.id === change.objectId);
    return [
      {
        objectId: change.objectId,
        name: object?.name ?? change.objectId,
        index: change.index,
        before: change.before,
        after: change.after,
      },
    ];
  });
}
