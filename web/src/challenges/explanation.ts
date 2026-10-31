import type { ExecuteResult, TraceStep } from '../engine/protocol';
import { kindLabels } from './content';
import { mapSourceLocation } from '../player/source-location';

export function stepPosition(step: TraceStep, result: ExecuteResult, source: string): string {
  return mapSourceLocation(source, result.nodeMap, step.location).description;
}
const objectNames = new WeakMap<ExecuteResult, Map<string, string>>();
/** Read recorded deltas and observations. Do not evaluate source expressions or predict states. */
export function explainStep(step: TraceStep, result: ExecuteResult, source: string): string[] {
  const lines = [`${kindLabels[step.kind]}。位置：${stepPosition(step, result, source)}。`];
  let names = objectNames.get(result);
  if (!names) {
    names = new Map<string, string>();
    for (const previous of result.trace?.steps ?? [])
      for (const c of previous.changes)
        if (c.op === 'record' && c.table === 'objects') {
          const o = c.after ?? c.before;
          if (o && 'name' in o) names.set(c.id, o.kind === 'int' ? o.name : `${o.name}[]`);
        }
    objectNames.set(result, names);
  }
  for (const c of step.changes) {
    if (c.op === 'cell')
      lines.push(
        `${(names.get(c.objectId) ?? c.objectId).replace('[]', `[${c.index}]`)}：${c.before ?? '未初始化'} → ${c.after ?? '未初始化'}。`,
      );
    if (c.op === 'record' && c.table === 'objects') {
      const o = c.after ?? c.before;
      if (o && 'name' in o)
        lines.push(
          c.before === null
            ? `创建 ${o.name}，容量 ${o.length}。`
            : c.after === null
              ? `释放局部对象 ${o.name}。`
              : `${o.name} 的初值已按轨迹写入。`,
        );
    }
    if (c.op === 'output') lines.push(`本步输出 ${JSON.stringify(c.append)}。`);
    if (c.op === 'control' && step.kind === 'program.return')
      lines.push(`返回值为 ${c.after.returnValue}，局部状态按轨迹退出。`);
  }
  for (const observation of step.observations) {
    if (observation.kind === 'decision')
      lines.push(
        `条件实际得到 ${observation.value}，走${observation.branch === 'true' ? '成立' : '不成立'}路径。`,
      );
    if (observation.kind === 'evaluate')
      lines.push(
        `运算符 ${observation.operator}，实际操作数 ${observation.operands.join('、')}，记录结果 ${observation.value}。`,
      );
    if (observation.kind === 'short-circuit') lines.push('发生逻辑短路，右侧表达式未执行。');
    if (observation.kind === 'swap')
      lines.push(`Rust 确认数组下标 ${observation.indices.join('、')} 的两次写入构成交换。`);
  }
  if (lines.length === 1)
    lines.push('作用域、控制位置及计数变化已同步到当前画面；后退会恢复它们。');
  return lines;
}
