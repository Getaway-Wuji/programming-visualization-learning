import { currentRustExecution } from '../engine/rust2018-client';
import { Rust2018Player } from '../engine/rust2018-player';
import type { RustResponse } from '../engine/rust2018-protocol';
import { c6SourceHash } from '../engine/c6-protocol';
import { downloadSnapshot, waitFor } from '../snapshot-export/browser';
import { attachPngSnapshot } from '../snapshot-export/png';
import { visibleText } from '../snapshot-export/layout';
import { SNAPSHOT_LIMITS } from '../snapshot-export/types';
import { createNotesZip } from '../study-notes/zip';
import { rustPackageRef } from './identities';
import { rustSourcePositions } from './source';

export async function exportRustSnapshot(
  format: 'json' | 'md' | 'png' | 'zip',
  response: RustResponse,
  input: string,
  cursor: number,
  title: string,
  documentId: string,
  stillCurrent: () => boolean,
) {
  const receipt = currentRustExecution(response);
  const packet = response.replay;
  const signal = AbortSignal.timeout(SNAPSHOT_LIMITS.timeoutMs);
  const guard = () => {
    signal.throwIfAborted();
    if (!stillCurrent() || !currentRustExecution(response))
      throw new Error('当前运行或游标已变化，请重新导出。');
  };
  if (!receipt || !packet?.trace) throw new Error('请先运行并选择一个轨迹步骤。');
  guard();
  const player = new Rust2018Player(packet);
  const state = player.seek(cursor);
  const source = receipt.request.source;
  const actualInput =
    receipt.request.operation === 'execute'
      ? receipt.request.input
      : receipt.request.operation === 'judge'
        ? (await import('../engine/rust2018-protocol')).rustJudgeInput(
            receipt.request.profile,
            receipt.request.reviewCase,
          )
        : undefined;
  guard();
  if (actualInput === undefined || input !== actualInput)
    throw new Error('实际输入与当前运行不一致。');
  const positions = rustSourcePositions(source);
  const step = packet.trace.steps[cursor - 1] ?? null;
  const range = response.nodeMap.find((node) => node.id === step?.nodeId)?.byteRange ?? null;
  const sha256 = await waitFor(c6SourceHash(source), signal);
  guard();
  const record = {
    formatVersion: '1.0.0',
    language: 'rust',
    edition: '2018',
    capturedAt: new Date().toISOString(),
    origin: { title, documentId, packageRef: rustPackageRef },
    identity: response.identity,
    engine: { buildId: response.buildId },
    source: {
      text: source,
      sha256,
      revision: receipt.request.sourceRevision,
      nodeMap: response.nodeMap,
    },
    input,
    reviewCase: response.judgement?.reviewCase ?? null,
    position: {
      cursor,
      length: player.length,
      range,
      start: range ? positions.get(range.start) : null,
    },
    state,
    step,
    terminal: packet.terminal,
    judgement: response.judgement,
  };
  const encoder = new TextEncoder();
  const json = encoder.encode(JSON.stringify(record, null, 2));
  if (json.length > SNAPSHOT_LIMITS.jsonBytes) throw new Error('此步骤的状态超过导出上限。');
  const inputText = input;
  const output = state.output;
  const fullRecord = new TextDecoder().decode(json);
  const longest = (fullRecord.match(/`+/gu) ?? []).reduce(
    (n, match) => Math.max(n, match.length),
    2,
  );
  const fence = '`'.repeat(longest + 1);
  const markdown = encoder.encode(
    [
      '# ' + title,
      '',
      'Rust 2018 · 步骤 ' + cursor + ' / ' + player.length,
      '源码修订 ' + receipt.request.sourceRevision,
      '源码 SHA-256 ' + sha256,
      '判题复盘组 ' + (response.judgement ? response.judgement.reviewCase + 1 : '无'),
      '',
      '## 源码',
      fence + 'rust',
      source,
      fence,
      '',
      '## 实际输入',
      fence + 'text',
      inputText || '无',
      fence,
      '',
      '## 当前输出',
      fence + 'text',
      output || '无',
      fence,
      '',
      '## 当前完整状态与运行身份',
      fence + 'json',
      fullRecord,
      fence,
      '',
    ].join('\n'),
  );
  const filename = 'rust-step-' + cursor;
  if (format === 'json' || format === 'md') {
    guard();
    downloadSnapshot(
      new Blob([format === 'json' ? json : markdown], {
        type: format === 'json' ? 'application/json' : 'text/markdown',
      }),
      filename + '.' + format,
    );
    return;
  }
  await waitFor(document.fonts.ready, signal);
  guard();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('无法生成图片。');
  const width = 1200;
  const font = '15px Consolas, "Microsoft YaHei", monospace';
  const lines: string[] = [];
  const summary = [
    title,
    `Rust 2018 · 步骤 ${cursor} / ${player.length}`,
    `源码 SHA-256 ${sha256}`,
    `源码修订 ${receipt.request.sourceRevision}`,
    `运行 ${response.identity.runId}`,
    `判题复盘组 ${response.judgement ? response.judgement.reviewCase + 1 : '无'}`,
    '源码',
    source,
    '实际输入',
    inputText,
    '当前输出',
    output,
    '调用帧',
    ...state.frames.map((frame) => JSON.stringify(frame)),
    '变量绑定与移动',
    ...state.bindings.map((binding) => JSON.stringify(binding)),
    '虚拟对象',
    ...state.objects.map((object) => JSON.stringify(object)),
    '活动借用',
    ...state.loans.map((loan) => JSON.stringify(loan)),
    '临时值',
    ...state.temporaries.map((temporary) => JSON.stringify(temporary)),
    '控制、分配状态及当前步骤',
    JSON.stringify({
      control: state.control,
      allocator: state.allocator,
      step,
      terminal: packet.terminal,
    }),
  ].join('\n');
  context.font = font;
  for (const row of visibleText(summary).split('\n')) {
    let line = '';
    for (const scalar of row) {
      if (line && context.measureText(line + scalar).width > width - 48) {
        lines.push(line);
        line = '';
      }
      line += scalar;
      if (lines.length > 360) throw new Error('此步骤的状态超过图片上限。');
    }
    lines.push(line);
    if (lines.length > 360) throw new Error('此步骤的状态超过图片上限。');
    if (lines.length % 32 === 0) guard();
  }
  canvas.width = width;
  canvas.height = 48 + lines.length * 22;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#202526';
  context.font = font;
  context.textBaseline = 'top';
  lines.forEach((line, at) => context.fillText(line, 24, 24 + at * 22));
  const blob = await waitFor(
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('无法生成图片。'))),
        'image/png',
      ),
    ),
    signal,
  );
  guard();
  if (blob.size > SNAPSHOT_LIMITS.pngBytes) throw new Error('图片超过导出上限。');
  const image = attachPngSnapshot(new Uint8Array(await blob.arrayBuffer()), json);
  guard();
  const result =
    format === 'png'
      ? new Blob([image], { type: 'image/png' })
      : await createNotesZip(
          [
            { name: 'snapshot.json', bytes: json },
            { name: 'notes.md', bytes: markdown },
            { name: 'snapshot.png', bytes: image },
          ],
          12 * 1024 * 1024,
          guard,
        );
  guard();
  downloadSnapshot(result, filename + '.' + format);
}
