import { currentCppExecution } from '../engine/cpp-course-client';
import { AdvancedPlayer } from '../engine/advanced-player';
import type { CppCourseResponse, CppInput } from '../engine/cpp-course-protocol';
import { downloadSnapshot, waitFor } from '../snapshot-export/browser';
import { attachPngSnapshot } from '../snapshot-export/png';
import { visibleText } from '../snapshot-export/layout';
import { SNAPSHOT_LIMITS } from '../snapshot-export/types';
import { createNotesZip } from '../study-notes/zip';
import { cppPackageRef } from './identities';
import { cppSourcePositions } from './source';

export async function exportCppSnapshot(
  format: 'json' | 'md' | 'png' | 'zip',
  response: CppCourseResponse,
  input: CppInput,
  cursor: number,
  title: string,
  documentId: string,
  stillCurrent: () => boolean,
) {
  const receipt = currentCppExecution(response);
  const packet = response.replay;
  const signal = AbortSignal.timeout(SNAPSHOT_LIMITS.timeoutMs);
  const guard = () => {
    signal.throwIfAborted();
    if (!stillCurrent() || !currentCppExecution(response))
      throw new Error('当前运行或游标已变化，请重新导出。');
  };
  if (!receipt || !packet?.trace) throw new Error('请先运行并选择一个轨迹步骤。');
  guard();
  const player = new AdvancedPlayer();
  player.accept(packet);
  if (!player.seek(cursor)) throw new Error('当前轨迹位置不可用。');
  const position = player.snapshot();
  const source = receipt.request.source;
  const positions = cppSourcePositions(source);
  const record = {
    formatVersion: '1.0.0',
    language: 'cpp',
    capturedAt: new Date().toISOString(),
    origin: { title, documentId, packageRef: cppPackageRef },
    identity: response.identity,
    engine: packet.engine,
    source: { text: source, revision: receipt.request.sourceRevision, nodeMap: packet.nodeMap },
    input,
    reviewCase: response.judgement?.reviewCase ?? null,
    position: {
      cursor,
      length: position.length,
      range: position.byteRange,
      start: position.byteRange ? positions.get(position.byteRange.start) : null,
    },
    state: position.state,
    step: packet.trace.steps[cursor - 1] ?? null,
    terminal: packet.terminal,
  };
  const encoder = new TextEncoder();
  const json = encoder.encode(JSON.stringify(record, null, 2));
  if (json.length > SNAPSHOT_LIMITS.jsonBytes) throw new Error('此步骤的状态超过导出上限。');
  const inputText = input.values.join(input.kind === 'lines' ? '\n' : ' ');
  const output = position.state?.output ?? '';
  const longest = (source.match(/`+/gu) ?? []).reduce((n, match) => Math.max(n, match.length), 2);
  const fence = '`'.repeat(longest + 1);
  const markdown = encoder.encode(
    [
      '# ' + title,
      '',
      'C++ · 步骤 ' + cursor + ' / ' + position.length,
      '源码修订 ' + receipt.request.sourceRevision,
      '',
      '## 源码',
      fence + 'cpp',
      source,
      fence,
      '',
      '## 实际输入',
      inputText || '无',
      '',
      '## 当前输出',
      output || '无',
      '',
    ].join('\n'),
  );
  const filename = 'cpp-step-' + cursor;
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
    `C++ · 步骤 ${cursor} / ${position.length}`,
    '源码',
    source,
    '实际输入',
    inputText,
    '当前输出',
    output,
    '调用帧',
    ...position.state!.frames.map((frame) => JSON.stringify(frame)),
    '虚拟对象',
    ...position.state!.objects.map((object) => JSON.stringify(object)),
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
