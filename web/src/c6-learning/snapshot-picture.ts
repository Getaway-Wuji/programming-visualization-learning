import type { SnapshotPicture, PictureOp } from '../snapshot-export/layout';
import { visibleText } from '../snapshot-export/layout';
import { C6TypeTable } from '../engine/c6-player';
import { c6ObjectSlots, c6ValueText } from './presentation';
import type { C6SnapshotDocument } from './snapshot';
import { SNAPSHOT_LIMITS, SnapshotError } from '../snapshot-export/types';
import { attachPngSnapshot } from '../snapshot-export/png';
import { waitFor } from '../snapshot-export/browser';

const font = "14px Consolas,'Microsoft YaHei',monospace";
const heading = "600 17px 'Microsoft YaHei',sans-serif";
export function layoutC6Snapshot(
  document: C6SnapshotDocument,
  measure: (value: string, font: string) => number,
  check: () => void,
): SnapshotPicture {
  const state = document.currentState,
    types = new C6TypeTable(document.types);
  const slots = state.objects.map((object) => c6ObjectSlots(object, types));
  if (
    state.objects.length > SNAPSHOT_LIMITS.objects ||
    state.frames.length > SNAPSHOT_LIMITS.frames ||
    state.objects.reduce((n, o, i) => n + (o.alive ? slots[i].length : 0), 0) >
      SNAPSHOT_LIMITS.liveSlots
  )
    throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
  const operations: PictureOp[] = [],
    width = 1280,
    padding = 28;
  let y = padding,
    byteCount = 0;
  let segmentCount = 0;
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  const line = (text: string, style = font, highlight = false) => {
    check();
    const wrapped: string[] = [];
    for (const paragraph of visibleText(text).split('\n')) {
      let current = '';
      for (const { segment } of segmenter.segment(paragraph)) {
        if (++segmentCount % 128 === 0) check();
        if (current && measure(current + segment, style) > width - 2 * padding) {
          wrapped.push(current);
          current = '';
        }
        current += segment;
      }
      wrapped.push(current);
    }
    for (const text of wrapped) {
      if (y + 24 > SNAPSHOT_LIMITS.height) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
      byteCount += new TextEncoder().encode(text).length + 128;
      if (byteCount > SNAPSHOT_LIMITS.layoutBytes)
        throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
      if (highlight)
        operations.push({
          kind: 'box',
          x: padding - 4,
          y,
          width: width - padding * 2 + 8,
          height: 24,
          fill: '#edf1e6',
        });
      operations.push({ kind: 'text', x: padding, y, text, font: style, color: '#23372f' });
      y += 24;
    }
  };
  const section = (title: string) => {
    y += 16;
    line(title, heading);
    y += 8;
  };
  line(document.origin.title, heading);
  line(`C · ${document.capturedAt} · 步骤 ${document.position.cursor}/${document.position.length}`);
  line(
    `运行 ${document.runtime.identity.runId} · ${document.position.completeness === 'prefix' ? '停止前轨迹' : '完整轨迹'}`,
  );
  line('完整当前状态 · 虚拟地址不是宿主地址 · 不受界面分页或选中对象影响');
  section('完整源码');
  const range = document.position.executedRange;
  document.source.text
    .split('\n')
    .forEach((text, i) =>
      line(
        `${String(i + 1).padStart(4)} | ${text}`,
        font,
        !!range && i + 1 >= range.start.line && i + 1 <= range.end.line,
      ),
    );
  section('实际输入');
  line(document.input.text || '（空输入）');
  if (document.input.profileRef)
    line(
      `判据 ${document.input.profileRef.id}@${document.input.profileRef.version} · ${document.input.caseKey}`,
    );
  section('当前位置与输出');
  line(
    document.currentStep
      ? `${document.currentStep.kind} · ${range ? `第${range.start.line}行` : '无源码位置'}`
      : '初始状态',
  );
  line(state.output || '（暂无输出）');
  section(`完整调用栈 · ${state.frames.length} 帧`);
  for (const frame of state.frames)
    line(
      `${frame.id} ${frame.functionName} · 父帧 ${frame.parentFrameId ?? '无'} · 作用域 ${frame.scopeIds.join(', ')}`,
    );
  section(`完整虚拟对象 · ${state.objects.length} 个`);
  state.objects.forEach((object, i) => {
    line(
      `${object.id} ${object.name} · ${object.typeName} · 0x${object.baseAddress.toString(16)} · ${object.byteLength}字节 · ${object.alive ? '存活' : '已结束'} · ${object.storage} · ${object.writable ? '可写' : '只读'}`,
    );
    for (const slot of slots[i])
      line(
        `  +${slot.byteOffset} ${slot.name} (${slot.typeName}) = ${c6ValueText(slot.value, state.objects)}`,
      );
  });
  section('完整作用域与别名');
  for (const scope of state.scopes)
    line(
      `${scope.id} · 帧 ${scope.frameId ?? '全局'} · 对象 ${scope.objectIds.join(', ')} · ${scope.aliases.map((a) => `${a.name}→${a.objectId}`).join(', ')}`,
    );
  section('控制、输入游标与虚拟分配状态');
  line(JSON.stringify(state.control));
  line(JSON.stringify(state.allocator));
  line(JSON.stringify(state.counters));
  section('本次执行结局');
  line(JSON.stringify(document.executionOutcome));
  if (y + padding > SNAPSHOT_LIMITS.height) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
  return {
    width,
    height: y + padding,
    operations: [
      { kind: 'box', x: 0, y: 0, width, height: y + padding, fill: '#ffffff' },
      ...operations,
    ],
  };
}
export async function renderC6SnapshotPng(
  document: C6SnapshotDocument,
  json: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  check: () => void,
): Promise<Blob> {
  await waitFor(globalThis.document.fonts.ready, signal);
  check();
  const canvas = globalThis.document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new SnapshotError('SNAPSHOT_FAILED');
  try {
    const layout = layoutC6Snapshot(
      document,
      (text, font) => {
        context.font = font;
        return context.measureText(text).width;
      },
      check,
    );
    canvas.width = layout.width;
    canvas.height = layout.height;
    context.textBaseline = 'top';
    for (const [i, operation] of layout.operations.entries()) {
      if (i % 32 === 0) check();
      if (operation.kind === 'box') {
        context.fillStyle = operation.fill;
        context.fillRect(operation.x, operation.y, operation.width, operation.height);
      } else {
        context.font = operation.font;
        context.fillStyle = operation.color;
        context.fillText(operation.text, operation.x, operation.y);
      }
    }
    check();
    const png = await waitFor(
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new SnapshotError('SNAPSHOT_FAILED'))),
          'image/png',
        ),
      ),
      signal,
    );
    check();
    if (png.size > SNAPSHOT_LIMITS.pngBytes) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
    const bytes = new Uint8Array(await waitFor(png.arrayBuffer(), signal));
    check();
    const blob = new Blob([attachPngSnapshot(bytes, json)], { type: 'image/png' });
    if (blob.size > SNAPSHOT_LIMITS.pngBytes) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
    return blob;
  } finally {
    canvas.width = canvas.height = 1;
  }
}
