import { currentJavaExecution } from '../engine/java-client';
import { JavaPlayer } from '../engine/java-player';
import { javaPositions, javaJudgeInput } from '../engine/java-protocol';
import type { JavaPacket, JavaResponse } from '../engine/java-types';
import { visibleText } from '../snapshot-export/layout';
import { attachPngSnapshot } from '../snapshot-export/png';
import { waitFor } from '../snapshot-export/browser';
import { SNAPSHOT_LIMITS, SnapshotError } from '../snapshot-export/types';
import { NOTE_LIMITS } from '../study-notes/types';
import { createNotesZip } from '../study-notes/zip';
import { javaPackageRef } from './identities';

const encode = (text: string) => new TextEncoder().encode(text);

export function captureJavaSnapshot(
  response: JavaResponse,
  packet: JavaPacket,
  caseIndex: number,
  cursor: number,
  origin: { title: string; documentId: string; lessonId?: string; sourceUrl?: string },
) {
  const request = currentJavaExecution(response)?.request;
  const result = response.result;
  if (
    !request ||
    !packet.trace ||
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > packet.trace.steps.length ||
    (result.kind === 'run'
      ? result.packet !== packet
      : result.kind !== 'judge' || result.cases[caseIndex]?.packet !== packet)
  )
    throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
  let input;
  if (request.operation.kind === 'run') input = request.operation.input;
  else if (request.operation.kind === 'judge' && result.kind === 'judge') {
    const caseKey = result.cases[caseIndex]?.caseKey;
    const text = javaJudgeInput(result.profileRef.id, caseKey);
    if (result.profileRef.id !== origin.documentId || text === undefined)
      throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
    input = { kind: 'stdin-utf8' as const, text, profileRef: result.profileRef, caseKey };
  } else throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
  const { trace } = packet;
  const currentState = new JavaPlayer(trace).seek(cursor).state;
  const currentStep = trace.steps[cursor - 1] ?? null;
  const range =
    response.nodeMap.find((node) => node.nodeId === currentStep?.nodeId)?.byteRange ?? null;
  const positions = javaPositions(request.source);
  return {
    formatId: 'urn:c-viz:current-snapshot:3.0.0',
    formatVersion: '3.1.0',
    snapshotId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    origin: {
      ...origin,
      packageRef: javaPackageRef,
      learningRevision: 1,
      lessonRef: origin.lessonId ? { id: origin.lessonId, version: '1.0.0' } : null,
      exerciseRef: result.kind === 'judge' ? result.profileRef : null,
    },
    source: {
      encoding: 'UTF-8',
      text: request.source,
      sha256: request.sourceSha256,
      revision: request.sourceRevision,
      nodeMap: response.nodeMap,
    },
    runtime: {
      language: 'java',
      engineId: response.engineId,
      engineVersion: response.engineVersion,
      engineBuildSha256: response.engineBuildSha256,
      runId: response.runId,
      execution: response.execVersion,
      step: response.dslVersion,
      diagnostic: response.diagnosticVersion,
      javaReference: response.javaReference,
      judge: result.kind === 'judge' ? result.judgeVersion : null,
    },
    position: {
      cursor,
      length: trace.steps.length,
      paused: true,
      byteRange: range,
      start: range ? positions.get(range.start) : null,
      end: range ? positions.get(range.end) : null,
    },
    input,
    currentState,
    currentStep,
    terminal: packet.terminal,
  };
}
type Snapshot = ReturnType<typeof captureJavaSnapshot>;

function note(snapshot: Snapshot) {
  const tick = String.fromCharCode(96);
  const samples = [snapshot.source.text, snapshot.input.text, snapshot.currentState.output].join(
    '\n',
  );
  const longest = (samples.match(new RegExp(tick + '+', 'gu')) ?? []).reduce(
    (n, text) => Math.max(n, text.length),
    3,
  );
  const fence = tick.repeat(longest + 1);
  return [
    '# ' + snapshot.origin.title,
    '',
    'Java 学习笔记 · 3.1.0',
    snapshot.capturedAt,
    '',
    '当前步骤 ' + snapshot.position.cursor + '/' + snapshot.position.length,
    '运行标识 ' + snapshot.runtime.runId,
    '课包 ' + snapshot.origin.packageRef.id + '@' + snapshot.origin.packageRef.version,
    ...(snapshot.origin.lessonRef
      ? ['小节 ' + snapshot.origin.lessonRef.id + '@' + snapshot.origin.lessonRef.version]
      : []),
    ...(snapshot.origin.sourceUrl ? ['[原课程来源](' + snapshot.origin.sourceUrl + ')'] : []),
    '',
    '## 源码',
    fence + 'java',
    snapshot.source.text,
    fence,
    '',
    '## 本次输入',
    fence,
    snapshot.input.text,
    fence,
    '',
    '## 当前输出',
    fence,
    snapshot.currentState.output,
    fence,
    '',
  ].join('\n');
}

async function png(
  snapshot: Snapshot,
  json: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  guard: () => void,
) {
  const { objects, frames } = snapshot.currentState;
  if (
    Object.keys(objects).length > SNAPSHOT_LIMITS.objects ||
    frames.length > SNAPSHOT_LIMITS.frames ||
    Object.values(objects).reduce(
      (n, object) =>
        n +
        (object.kind === 'instance'
          ? Object.keys(object.fields).length
          : object.kind === 'scanner'
            ? 0
            : object.slots.length),
      0,
    ) > SNAPSHOT_LIMITS.liveSlots
  )
    throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
  await waitFor(document.fonts.ready, signal);
  guard();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new SnapshotError('SNAPSHOT_FAILED');
  const width = 1280,
    padding = 24,
    step = 21;
  const font = "14px Consolas,'Microsoft YaHei',monospace";
  const lines: string[] = [];
  const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
  const text = [
    snapshot.origin.title,
    'Java · 步骤 ' + snapshot.position.cursor + '/' + snapshot.position.length,
    '运行 ' + snapshot.runtime.runId,
    '源码',
    snapshot.source.text,
    '实际输入',
    snapshot.input.text,
    '当前输出',
    snapshot.currentState.output,
    '调用帧',
    ...frames.map((frame) => JSON.stringify(frame)),
    '虚拟对象',
    ...Object.entries(objects).map(([id, values]) => id + ' ' + JSON.stringify(values)),
    '控制和计数',
    JSON.stringify(snapshot.currentState.control),
    JSON.stringify(snapshot.currentState.allocator),
    JSON.stringify(snapshot.currentState.counters),
    '执行结局',
    JSON.stringify(snapshot.terminal),
  ].join('\n');
  context.font = font;
  let count = 0;
  const append = (line: string) => {
    lines.push(line);
    if (lines.length * step + padding * 2 > SNAPSHOT_LIMITS.height)
      throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
  };
  for (const row of visibleText(text).split('\n')) {
    let line = '';
    for (const { segment } of segmenter.segment(row)) {
      if (++count % 128 === 0) guard();
      if (line && context.measureText(line + segment).width > width - padding * 2) {
        append(line);
        line = '';
      }
      line += segment;
    }
    append(line);
  }
  try {
    canvas.width = width;
    canvas.height = lines.length * step + padding * 2;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, canvas.height);
    context.font = font;
    context.textBaseline = 'top';
    context.fillStyle = '#23372f';
    lines.forEach((line, i) => {
      if (i % 32 === 0) guard();
      context.fillText(line, padding, padding + i * step);
    });
    const blob = await waitFor(
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (data) => (data ? resolve(data) : reject(new SnapshotError('SNAPSHOT_FAILED'))),
          'image/png',
        ),
      ),
      signal,
    );
    if (blob.size > SNAPSHOT_LIMITS.pngBytes) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
    const data = new Uint8Array(await waitFor(blob.arrayBuffer(), signal));
    guard();
    const result = new Blob([attachPngSnapshot(data, json)], { type: 'image/png' });
    if (result.size > SNAPSHOT_LIMITS.pngBytes) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
    return result;
  } finally {
    canvas.width = canvas.height = 1;
  }
}

export async function prepareJavaSnapshot(
  snapshot: Snapshot,
  format: 'json' | 'png' | 'md' | 'zip',
  signal: AbortSignal,
  check: () => void,
) {
  const guard = () => {
    signal.throwIfAborted();
    check();
  };
  guard();
  const json = encode(JSON.stringify(snapshot, null, 2) + '\n');
  if (json.length > SNAPSHOT_LIMITS.jsonBytes) throw new SnapshotError('SNAPSHOT_PICTURE_LIMIT');
  if (format === 'json') return new Blob([json], { type: 'application/json' });
  if (format === 'md') return new Blob([note(snapshot)], { type: 'text/markdown; charset=utf-8' });
  const picture = await png(snapshot, json, signal, guard);
  if (format === 'png') return picture;
  const image = new Uint8Array(await waitFor(picture.arrayBuffer(), signal));
  return createNotesZip(
    [
      { name: '学习笔记.md', bytes: encode(note(snapshot)) },
      { name: '当前快照.json', bytes: json },
      { name: '当前快照.png', bytes: image },
    ],
    NOTE_LIMITS.packageBytes,
    guard,
  );
}
