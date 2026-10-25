import type { InputBinding, InputValues } from '../content/types';
import type { ExecuteResult, TraceCounters, TraceObject, TraceStep } from '../engine/protocol';
import type { PlayerSnapshot } from './model';

export const VISIBLE_OBJECTS = 64;
export const VISIBLE_CELLS = 30;
export const VISIBLE_EVENTS = 32;
const comparisons = new Set(['<', '<=', '>', '>=', '==', '!=']);
const steps: Record<TraceStep['kind'], string> = {
  'program.enter': '进入 main',
  'object.declare': '声明对象',
  'value.initialize': '初始化',
  'value.write': '写入数值',
  condition: '判断条件',
  'scope.enter': '进入作用域',
  'scope.exit': '退出作用域',
  'output.append': '追加输出',
  'control.jump': '控制跳转',
  'program.return': '程序返回',
  nop: '空语句',
};
export const valueText = (value: number | null) => (value === null ? '未初始化' : String(value));

export interface CellView {
  index: number;
  value: number | null;
  read: boolean;
  written: boolean;
}
export interface ObjectView {
  id: string;
  name: string;
  scopeId: string;
  kind: TraceObject['kind'];
  length: number;
  storageLength: number;
  cells: CellView[];
}
export interface TracePresentation {
  summary: string;
  objects: ObjectView[];
  objectCount: number;
  events: string[];
  eventCount: number;
  retired: string[];
  output: string;
  counters: TraceCounters;
}

/** Display projection only. Values/observations/deltas are supplied by Rust and
 * already restored by the single player; no expression or algorithm is evaluated.
 */
export function presentTrace(
  view: PlayerSnapshot,
  result: ExecuteResult | undefined,
  input: InputValues,
  bindings: readonly InputBinding[],
): TracePresentation | null {
  if (!view.state || view.cursor === null || !result?.trace || !view.identity) return null;
  if (
    (Object.keys(view.identity) as (keyof typeof view.identity)[]).some(
      (key) => view.identity![key] !== result.identity[key],
    )
  )
    return null;
  const state = view.state;
  const step = view.cursor > 0 ? result.trace.steps[view.cursor - 1] : undefined;
  const known = new Map(state.objects.map((object) => [object.id, object]));
  const reads = new Map<string, Set<number>>();
  const writes = new Map<string, Set<number>>();
  const initialized = new Set<string>();
  const retired: string[] = [];
  const events: string[] = [];
  const name = (id: string, index?: number) => {
    const object = known.get(id);
    return `${object?.name ?? id}${object?.kind === 'int-array' && index !== undefined ? `[${index}]` : ''} (${id})`;
  };
  // A return/jump may read objects that are no longer alive in the post-state.
  // Recover their display identity from this atomic step's supplied records only.
  for (const change of step?.changes ?? []) {
    if (change.op === 'record' && change.table === 'objects') {
      const record = (change.after ?? change.before) as TraceObject;
      known.set(record.id, record);
    }
  }
  for (const observation of view.observations) {
    if (observation.kind === 'read') {
      const indices = reads.get(observation.objectId) ?? new Set<number>();
      indices.add(observation.index);
      reads.set(observation.objectId, indices);
      events.push(`读取 ${name(observation.objectId, observation.index)}：${observation.value}`);
    } else if (observation.kind === 'evaluate' && comparisons.has(observation.operator)) {
      events.push(
        `比较 ${observation.operands.join(` ${observation.operator} `)} → ${observation.value}`,
      );
    } else if (observation.kind === 'decision') {
      events.push(
        `条件结果 ${observation.value}：${observation.branch === 'true' ? '成立' : '不成立'}`,
      );
    } else if (observation.kind === 'short-circuit') {
      events.push(`短路：未计算右侧节点 ${observation.skippedNodeId}`);
    } else if (observation.kind === 'swap') {
      events.push(`交换 ${name(observation.objectId)} 的下标 ${observation.indices.join('、')}`);
    }
  }
  for (const change of step?.changes ?? []) {
    if (change.op === 'cell') {
      const indices = writes.get(change.objectId) ?? new Set<number>();
      indices.add(change.index);
      writes.set(change.objectId, indices);
      events.push(
        `写入 ${name(change.objectId, change.index)}：${valueText(change.before)} → ${valueText(change.after)}`,
      );
    } else if (change.op === 'record' && change.table === 'objects') {
      const object = (change.after ?? change.before) as TraceObject;
      if (!change.after) retired.push(`${object.name} (${object.id}，${object.scopeId})`);
      else if (step?.kind === 'value.initialize') {
        initialized.add(object.id);
        events.push(`初始化数组 ${name(object.id)}`);
      }
    } else if (change.op === 'output') {
      events.push(`追加输出 ${JSON.stringify(change.append)}`);
    }
  }
  const objects = state.objects.slice(0, VISIBLE_OBJECTS).map((object): ObjectView => {
    const binding = bindings.find(
      (binding) =>
        binding.targetKind === 'array' &&
        result.resolvedBindings.some(
          (resolved) =>
            resolved.bindingKey === binding.bindingKey &&
            resolved.declarationNodeId === object.declarationNodeId,
        ),
    );
    const values = binding && input[binding.inputKey];
    const length = Array.isArray(values) ? values.length : object.length;
    const valueAt = (index: number) => {
      let low = 0,
        high = object.cells.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (object.cells[middle].index < index) low = middle + 1;
        else high = middle;
      }
      return object.cells[low]?.index === index ? object.cells[low].value : object.defaultValue;
    };
    return {
      id: object.id,
      name: object.name,
      scopeId: object.scopeId,
      kind: object.kind,
      length,
      storageLength: object.length,
      cells: Array.from({ length: Math.min(length, VISIBLE_CELLS) }, (_, index) => ({
        index,
        value: valueAt(index),
        read: reads.get(object.id)?.has(index) ?? false,
        written: initialized.has(object.id) || (writes.get(object.id)?.has(index) ?? false),
      })),
    };
  });
  return {
    summary: step
      ? `刚完成第 ${view.cursor} 步：${steps[step.kind]}`
      : '初始状态：尚未执行任何步骤',
    objects,
    objectCount: state.objects.length,
    events: events.slice(0, VISIBLE_EVENTS),
    eventCount: events.length,
    retired: retired.slice(0, VISIBLE_OBJECTS),
    output: state.output,
    counters: state.counters,
  };
}
