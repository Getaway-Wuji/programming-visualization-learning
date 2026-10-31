import type {
  MemoryObject,
  MemoryResult,
  MemoryState,
  MemoryType,
} from '../engine/memory-protocol';
import { memorySlots } from '../memory/presentation';
import type { PreparedClassic } from './content';
export function classicMainObjects(state: MemoryState) {
  const frame = state.frames.find((f) => f.parentFrameId === null);
  return frame ? state.objects.filter((o) => o.alive && o.frameId === frame.id) : [];
}
export function scalarValue(object: MemoryObject | undefined, types: readonly MemoryType[]) {
  const v = object ? memorySlots(object, types)[0]?.value : null;
  return typeof v === 'number' ? v : null;
}
/** Layout reads only real storage; no disk move solver or input sequence is accepted. */
export function hanoiView(state: MemoryState, types: readonly MemoryType[]) {
  const objects = classicMainObjects(state),
    n = scalarValue(
      objects.find((o) => o.name === 'n'),
      types,
    ),
    positions = objects.find((o) => o.name === 'positions'),
    moveState = objects.find((o) => o.name === 'moveState'),
    slots = positions ? memorySlots(positions, types) : [],
    active = n !== null && n >= 0 && n <= 5 ? n : null;
  const disks =
    active === null || !positions
      ? []
      : Array.from({ length: active }, (_, i) => {
          const v = slots[i]?.value;
          return { index: i, size: i + 1, peg: typeof v === 'number' ? v : null };
        });
  return {
    n,
    positions,
    moveState,
    disks,
    pegs: [0, 1, 2].map((peg) => ({ peg, disks: disks.filter((d) => d.peg === peg).toReversed() })),
    rawMoves: moveState ? memorySlots(moveState, types) : [],
    layoutReady: Boolean(positions) && active !== null && disks.every((d) => d.peg !== null),
    layoutIssue: disks.some((d) => d.peg !== null && (d.peg < 0 || d.peg > 2)),
  };
}
export function classicExplanation(
  result: MemoryResult,
  cursor: number,
  prepared: PreparedClassic,
) {
  const step = cursor ? (result.trace?.steps[cursor - 1] ?? null) : null,
    range = step ? (result.nodeMap.find((n) => n.nodeId === step.nodeId)?.byteRange ?? null) : null,
    phase = range ? prepared.phases.findLast((p) => p.start <= range.start) : null;
  const events: Record<string, [string, string]> = {
    'program.enter': ['进入main', '建立真实帧，变量尚待声明/输入，不预先填入结果。'],
    'program.return': ['main已返回', '自动对象成为无当前值的墓碑；后退恢复存储与帧。'],
    'function.enter': [
      '进入真实函数帧',
      '各次调用的参数对象和数组别名由Rust记录，不复制盘位置数组。',
    ],
    'function.return': [
      '返回实际调用者',
      '当前活动帧已回到调用者，源码仍是刚完成的return；不偷偷移动游标。',
    ],
    'scope.enter': ['进入实际作用域', '这是源码块边界，不代表完成一次算法动作。'],
    'scope.exit': ['离开实际作用域', '局部对象按真实delta结束，后退恢复。'],
  };
  const e = step ? events[step.kind] : undefined;
  return {
    title: e?.[0] ?? phase?.title ?? '初始状态',
    explanation:
      e?.[1] ?? phase?.explanation ?? '尚未执行，源码、数值/盘图、内存和栈共用一个游标。',
  };
}
