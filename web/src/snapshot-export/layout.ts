import type { MemoryState, MemoryPointer } from '../engine/memory-protocol';
import type { TraceState } from '../engine/protocol';
import {
  memorySlots,
  memoryValueText,
  slotCount,
  virtualAddress,
  MEMORY_PAGE_SIZE,
} from '../memory/presentation';
import { SNAPSHOT_LIMITS, SnapshotError, type SnapshotDocument } from './types';

export type PictureOp =
  | { kind: 'text'; text: string; x: number; y: number; font: string; color: string }
  | {
      kind: 'box';
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      stroke?: string;
    };
export interface SnapshotPicture {
  width: number;
  height: number;
  operations: PictureOp[];
}
const bodyFont = "14px 'Microsoft YaHei','PingFang SC',sans-serif";
const codeFont = "14px Consolas,'Microsoft YaHei',monospace";
const headingFont = "600 17px 'Microsoft YaHei','PingFang SC',sans-serif";
const ink = '#1d2939',
  muted = '#425466';
/** Display controls visibly; JSON retains the untouched strings. No HTML is generated. */
export function visibleText(text: string): string {
  let output = '';
  for (const scalar of text) {
    const point = scalar.codePointAt(0)!;
    output +=
      (point < 32 && ![9, 10, 13].includes(point)) ||
      (point >= 127 && point <= 159) ||
      (point >= 0x202a && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069) ||
      (point >= 0xd800 && point <= 0xdfff)
        ? `\\u${point.toString(16).padStart(4, '0')}`
        : scalar;
  }
  return output.replaceAll('\t', '    ');
}
export function layoutSnapshot(
  document: SnapshotDocument,
  measure: (text: string, font: string) => number,
  check: () => void,
): SnapshotPicture {
  const state = document.currentState,
    memory = document.runtime.domain === 'p1-memory';
  const slots = memory
    ? (state as MemoryState).objects.reduce(
        (sum, object) => sum + (object.alive ? slotCount(object, document.types!) : 0),
        0,
      )
    : (state as TraceState).objects.reduce((sum, object) => sum + object.length, 0);
  if (
    state.objects.length > SNAPSHOT_LIMITS.objects ||
    state.frames.length > SNAPSHOT_LIMITS.frames ||
    slots > SNAPSHOT_LIMITS.liveSlots
  )
    throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
  const operations: PictureOp[] = [];
  let textBytes = 0,
    checks = 0;
  const encoder = new TextEncoder();
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  const text = (value: string, x: number, y: number, font = bodyFont, color = ink) => {
    if (++checks % 64 === 0) check();
    if (y + 24 > SNAPSHOT_LIMITS.height) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
    textBytes += encoder.encode(value).byteLength + 100;
    if (textBytes > SNAPSHOT_LIMITS.layoutBytes) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
    operations.push({ kind: 'text', text: value, x, y, font, color });
  };
  const wrap = (value: string, width: number, font: string) => {
    const lines: string[] = [];
    for (const logical of visibleText(value).split(/\r\n|\r|\n/)) {
      let line = '';
      for (const { segment } of segmenter.segment(logical)) {
        if (++checks % 128 === 0) check();
        const candidate = line + segment;
        if (measure(candidate, font) > width && line) {
          lines.push(line);
          line = segment;
        } else line = candidate;
        if (lines.length > 500) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
      }
      lines.push(line);
    }
    return lines;
  };
  let top = 32;
  const header = (value: string, font = bodyFont) => {
    for (const line of wrap(value, 1360, font)) {
      text(line, 40, top, font);
      top += font === bodyFont ? 22 : 32;
    }
  };
  header(`当前状态快照 · ${document.origin.title}`, "600 24px 'Microsoft YaHei',sans-serif");
  const language =
    typeof document.runtime.language === 'string'
      ? document.runtime.language
      : document.runtime.language.id;
  const mode = { basic: '基础', memory: '内存', stack: '调用栈' }[document.presentation.mode];
  const reason =
    {
      'executed-step': '已完成步',
      'breakpoint-call-site': '断点调用位置',
      terminal: '终止位置',
      initial: '初态',
      'diagnostic-focus': '手动定位诊断',
    }[document.position.highlighted.reason] ?? document.position.highlighted.reason;
  header(
    `${language === 'cpp' ? 'C++' : language === 'c' || language === 'lang.c' ? 'C' : language} · ${mode}视图 · 已暂停 ${document.position.cursor}/${document.position.length} 步 · ${document.position.atTerminal ? '末尾状态' : '当前步骤后的状态'}`,
  );
  header(`案例/观察 ${document.origin.id} · 定义版本 ${document.origin.definitionVersion.value}`);
  header(`快照 ${document.snapshotId} · ${document.capturedAt}`);
  header(
    `格式1.0.0 · 执行${document.runtime.versions.execution} / Step ${document.runtime.versions.step} / 诊断${document.runtime.versions.diagnostic} · 运行 ${document.runtime.identity.runId}`,
  );
  header(`已完成步位置：${document.position.executed.description}`);
  const highlight = document.position.highlighted.range;
  header(
    `源码显示位置：${highlight ? `第${highlight.start.line}行，第${highlight.start.column}列` : '无源码高亮'}（${reason}）`,
  );
  const bodyTop = top + 18,
    left = 40,
    right = 734,
    column = 666;
  let codeY = bodyTop + 16,
    stateY = bodyTop + 16;
  const sourceOpsStart = operations.length;
  text('实际执行源码（完整原文，图片可折行）', left + 12, codeY, headingFont);
  codeY += 32;
  for (const line of wrap(`源码版本 ${document.source.sourceRevision}`, column - 24, bodyFont)) {
    text(line, left + 12, codeY);
    codeY += 22;
  }
  for (const line of wrap(`SHA256 ${document.source.sha256}`, column - 24, codeFont)) {
    text(line, left + 12, codeY, codeFont, muted);
    codeY += 22;
  }
  const lines = document.source.text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const selected =
      highlight &&
      lineNumber >= highlight.start.line &&
      (lineNumber < highlight.end.line ||
        (lineNumber === highlight.end.line &&
          (highlight.end.column > 1 || highlight.start.line === highlight.end.line)));
    const fragments = wrap(lines[index], column - 64, codeFont);
    fragments.forEach((fragment, fragmentIndex) => {
      if (selected)
        operations.push({
          kind: 'box',
          x: left + 8,
          y: codeY - 1,
          width: column - 16,
          height: 22,
          fill: '#fff1bd',
        });
      text(fragmentIndex === 0 ? String(lineNumber) : '↳', left + 12, codeY, codeFont, muted);
      text(fragment, left + 54, codeY, codeFont);
      codeY += 22;
    });
  }
  const sourceOperations = operations.splice(sourceOpsStart);
  const section = (label: string) => {
    stateY += 12;
    text(label, right + 12, stateY, headingFont);
    stateY += 30;
  };
  const row = (value: string, color = ink) => {
    for (const line of wrap(value, column - 24, bodyFont)) {
      text(line, right + 12, stateY, bodyFont, color);
      stateY += 22;
    }
  };
  section('完整当前状态（不受页面选择与分页影响）');
  row(`实际输入：${JSON.stringify(document.input)}`);
  row(`逻辑计数：${JSON.stringify(state.counters)}`);
  row(
    `当前步：${document.currentStep ? `${document.currentStep.seq} · ${document.currentStep.kind}` : '0 · 初态'}`,
  );
  const frames = () => {
    section('调用帧与作用域');
    row(`当前活动帧：${state.control.activeFrameId ?? '无'}`);
    if (!state.frames.length) row('当前没有活动调用帧。', muted);
    for (const frame of state.frames) row(JSON.stringify(frame));
    for (const scope of state.scopes) row(JSON.stringify(scope));
    if (document.currentStep) {
      const exited = document.currentStep.changes
        .filter(
          (change) =>
            change.op === 'record' &&
            change.table === 'frames' &&
            change.before !== null &&
            change.after === null,
        )
        .map((change) => ('id' in change ? change.id : ''));
      if (exited.length) row(`本步已退出帧：${exited.join('、')}；不是当前活绑定。`, muted);
    }
  };
  const objects = () => {
    section('对象与物理存储槽');
    if (!state.objects.length) row('当前没有对象。', muted);
    if (memory) {
      const current = state as MemoryState;
      for (const object of current.objects) {
        row(
          `${object.name} · ${object.id} · ${object.typeName}[${object.length}] · ${virtualAddress(object.baseAddress)} · ${object.storage} · ${object.alive ? '存活' : '已结束，不含旧值'}`,
        );
        row(
          `声明 ${object.declarationNodeId}；帧 ${object.frameId ?? 'null'} / 作用域 ${object.scopeId ?? 'null'}；${object.byteLength}字节；zeroInitialized=${object.zeroInitialized}`,
          muted,
        );
        if (!object.alive) continue;
        const count = slotCount(object, document.types!);
        for (let page = 0; page < Math.ceil(count / MEMORY_PAGE_SIZE); page++)
          for (const slot of memorySlots(object, document.types!, page)) {
            const pointer =
              slot.value && typeof slot.value === 'object' ? (slot.value as MemoryPointer) : null;
            row(
              `${slot.name} (${slot.typeName}) @${slot.address}：${memoryValueText(slot.value, current)}${pointer ? `；类型 ${pointer.pointeeType}，边界[${pointer.lowerBound},${pointer.upperBound}]` : ''}`,
            );
          }
      }
    } else {
      for (const object of (state as TraceState).objects) {
        row(
          `${object.name} · ${object.id} · ${object.kind}[${object.length}] · ${virtualAddress(object.baseAddress)}`,
        );
        row(
          `声明 ${object.declarationNodeId}；帧 ${object.frameId} / 作用域 ${object.scopeId}；缺省值=${object.defaultValue === null ? '未初始化' : object.defaultValue}`,
          muted,
        );
        for (let index = 0; index < object.length; index++) {
          const slot = object.cells.find((cell) => cell.index === index),
            value = slot ? slot.value : object.defaultValue;
          row(
            `[${index}]：${value === null ? '未初始化' : value} @${virtualAddress(object.baseAddress + index * 4)}`,
          );
        }
      }
    }
  };
  if (document.presentation.mode === 'stack') {
    frames();
    objects();
  } else {
    objects();
    frames();
  }
  section('控制、分配器与当前输出');
  row(JSON.stringify(state.control));
  row(JSON.stringify(state.allocator));
  row(state.output || '（当前无输出）');
  if (document.terminalAtCursor) {
    section('当前位置的终止信息');
    row(JSON.stringify(document.terminalAtCursor));
  }
  const height = Math.ceil(Math.max(codeY, stateY) + 88);
  if (height > SNAPSHOT_LIMITS.height) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
  operations.unshift(
    { kind: 'box', x: 0, y: 0, width: 1440, height, fill: '#ffffff' },
    {
      kind: 'box',
      x: left,
      y: bodyTop,
      width: column,
      height: Math.max(codeY, stateY) - bodyTop + 14,
      fill: '#f8fafc',
      stroke: '#d8dee8',
    },
    {
      kind: 'box',
      x: right,
      y: bodyTop,
      width: column,
      height: Math.max(codeY, stateY) - bodyTop + 14,
      fill: '#ffffff',
      stroke: '#d8dee8',
    },
  );
  operations.push(...sourceOperations);
  text(
    '教学虚拟地址，不是宿主真实地址。PNG附有同一完整状态JSON；分享前请确认源码、输入和状态。',
    40,
    height - 42,
    bodyFont,
    muted,
  );
  check();
  return { width: 1440, height, operations };
}
