import { currentMysqlExecution } from '../engine/mysql-client';
import { MysqlPlayer } from '../engine/mysql-player';
import type { MysqlResponse } from '../engine/mysql-types';
import { c6SourceHash } from '../engine/c6-protocol';
import { mysqlBuild } from '../generated/mysql/engine-build';
import { downloadSnapshot, waitFor } from '../snapshot-export/browser';
import { visibleText } from '../snapshot-export/layout';
import { attachPngSnapshot } from '../snapshot-export/png';
import { SNAPSHOT_LIMITS } from '../snapshot-export/types';
import { createNotesZip } from '../study-notes/zip';
import { mysqlPackageRef } from './identities';
import { mysqlCourseRelease } from './release.generated';
import { mysqlSourcePositions } from './source';

/** Captures only a privately accepted current execution, never a restored draft. */
export async function captureMysqlSnapshot(
  response: MysqlResponse,
  cursor: number,
  title: string,
  documentId: string,
  stillCurrent: () => boolean,
  signal = AbortSignal.timeout(SNAPSHOT_LIMITS.timeoutMs),
) {
  const receipt = currentMysqlExecution(response),
    packet = response.replay;
  const guard = () => {
    signal.throwIfAborted();
    if (!stillCurrent() || !currentMysqlExecution(response))
      throw new Error('当前 SQL、运行或游标已变化，请重新导出。');
  };
  if (!receipt || !packet) throw new Error('请先运行 SQL 并选择一个轨迹步骤。');
  guard();
  const player = new MysqlPlayer(packet),
    state = player.seek(cursor);
  const source = receipt.request.source;
  const sha256 = await waitFor(c6SourceHash(source), signal);
  guard();
  const step = packet.trace.steps[cursor - 1] ?? null;
  const range = response.nodeMap.find((node) => node.id === step?.nodeId)?.byteRange ?? null;
  const positions = mysqlSourcePositions(source);
  const record = {
    formatVersion: '1.0.0',
    language: 'mysql',
    dialect: '8.0',
    capturedAt: new Date().toISOString(),
    origin: {
      title,
      documentId,
      packageRef: mysqlPackageRef,
      courseSha256: mysqlCourseRelease.sha256,
    },
    identity: response.identity,
    engine: { buildId: response.buildId, sha256: mysqlBuild.wasmSha256 },
    source: {
      text: source,
      sha256,
      revision: receipt.request.sourceRevision,
      nodeMap: response.nodeMap,
    },
    initialSession: packet.trace.initialState.session,
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
  const json = new TextEncoder().encode(JSON.stringify(record, null, 2));
  if (json.length > SNAPSHOT_LIMITS.jsonBytes) throw new Error('此步骤的状态超过导出上限。');
  guard();
  return { record, json, guard, signal };
}

export function mysqlSnapshotMarkdown(
  record: Awaited<ReturnType<typeof captureMysqlSnapshot>>['record'],
) {
  const fullRecord = JSON.stringify(record, null, 2);
  const longest = (fullRecord.match(/`+/gu) ?? []).reduce(
    (n, match) => Math.max(n, match.length),
    2,
  );
  const fence = '`'.repeat(longest + 1);
  return new TextEncoder().encode(
    [
      '# ' + record.origin.title,
      '',
      `MySQL 8.0 · 步骤 ${record.position.cursor} / ${record.position.length}`,
      '源码修订 ' + record.source.revision,
      '源码 SHA-256 ' + record.source.sha256,
      '引擎 SHA-256 ' + record.engine.sha256,
      '判题复盘组 ' + (record.reviewCase === null ? '无' : record.reviewCase + 1),
      '',
      '## SQL',
      fence + 'sql',
      record.source.text,
      fence,
      '',
      '## 当前数据库、事务与查询结果',
      fence + 'text',
      JSON.stringify(record.state, null, 2),
      fence,
      '',
      '## 初始会话、完整步骤状态与运行身份',
      fence + 'json',
      fullRecord,
      fence,
      '',
    ].join('\n'),
  );
}

export async function exportMysqlSnapshot(
  format: 'json' | 'md' | 'png' | 'zip',
  response: MysqlResponse,
  cursor: number,
  title: string,
  documentId: string,
  stillCurrent: () => boolean,
) {
  const { record, json, guard, signal } = await captureMysqlSnapshot(
    response,
    cursor,
    title,
    documentId,
    stillCurrent,
  );
  const markdown = mysqlSnapshotMarkdown(record);
  const filename = 'mysql-step-' + cursor;
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
  try {
    const width = 1200,
      font = '15px Consolas, "Microsoft YaHei", monospace';
    const lines: string[] = [];
    const summary = [
      title,
      `MySQL 8.0 · 步骤 ${cursor} / ${record.position.length}`,
      '源码 SHA-256 ' + record.source.sha256,
      '引擎 SHA-256 ' + record.engine.sha256,
      '源码修订 ' + record.source.revision,
      '运行 ' + response.identity.runId,
      'SQL',
      record.source.text,
      '当前数据库',
      ...record.state.session.database.tables.map((table) =>
        [
          table.name,
          JSON.stringify(table.columns),
          ...table.rows.map((row) => JSON.stringify(row)),
        ].join('\n'),
      ),
      '活动事务与起点数据库',
      JSON.stringify(record.state.session.transaction),
      '查询与执行结果',
      JSON.stringify(record.state.result),
      '控制、当前步骤与终态',
      JSON.stringify({
        control: record.state.control,
        step: record.step,
        terminal: record.terminal,
      }),
      '初始会话',
      JSON.stringify(record.initialSession),
    ].join('\n');
    if (new TextEncoder().encode(summary).length > SNAPSHOT_LIMITS.layoutBytes)
      throw new Error('此步骤的状态超过图片上限。');
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
    const image = attachPngSnapshot(
      new Uint8Array(await waitFor(blob.arrayBuffer(), signal)),
      json,
    );
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
  } finally {
    canvas.width = canvas.height = 1;
  }
}
