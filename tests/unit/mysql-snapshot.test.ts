/** Every captured state comes through the real SQL WASM and private client receipt. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { execute_mysql, initSync } from '../../web/src/generated/mysql/c_viz_mysql';
import { mysqlBuild } from '../../web/src/generated/mysql/engine-build';
import { MysqlClient } from '../../web/src/engine/mysql-client';
import { defaultMysqlSession, mysqlProfile } from '../../web/src/engine/mysql-data';
import { MysqlPlayer } from '../../web/src/engine/mysql-player';
import { captureMysqlSnapshot, mysqlSnapshotMarkdown } from '../../web/src/mysql-course/snapshot';
import { mysqlSourcePositions } from '../../web/src/mysql-course/source';
import { showMysqlCell } from '../../web/src/mysql-course/Tables';

const bytes = new Uint8Array(readFileSync('web/src/generated/mysql/c_viz_mysql_bg.wasm'));
let pages = 0;
beforeAll(() => {
  pages = initSync({ module: bytes }).memory.buffer.byteLength / 65536;
});
class SqlWorker {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  terminate() {}
  postMessage({ id, buffer, remaining }: { id: string; buffer: ArrayBuffer; remaining: number }) {
    const result = execute_mysql(new Uint8Array(buffer), mysqlBuild.wasmSha256, remaining).slice()
      .buffer;
    queueMicrotask(() =>
      this.onmessage?.call(
        this as unknown as Worker,
        new MessageEvent('message', { data: { id, buffer: result, wasmPages: pages } }),
      ),
    );
  }
}
const clients: MysqlClient[] = [];
function client() {
  vi.stubGlobal('Worker', SqlWorker);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'application/wasm' } })),
  );
  const result = new MysqlClient();
  clients.push(result);
  return result;
}
afterEach(() => {
  clients.splice(0).forEach((item) => item.invalidate());
  vi.unstubAllGlobals();
});

test('SQL snapshot binds exact Unicode SQL, initial session, precise decimal and active transaction to its selected cursor', async () => {
  const source =
    '-- 字🙂，保留 CRLF\r\nBEGIN;\r\nUPDATE students SET score = 0 WHERE id = 1;\r\nSELECT AVG(score) AS exact_average FROM students;';
  const session = defaultMysqlSession();
  const response = await client().run(source, session, 'snapshot-revision');
  const packet = response.replay!;
  const player = new MysqlPlayer(packet);
  const end = player.seek(player.length);
  const { record, json } = await captureMysqlSnapshot(
    response,
    player.length,
    'SQL 快照',
    'mysql.document.free',
    () => true,
  );
  expect(record).toMatchObject({
    language: 'mysql',
    dialect: '8.0',
    initialSession: session,
    source: {
      text: source,
      revision: 'snapshot-revision',
      sha256: createHash('sha256').update(source).digest('hex'),
    },
    engine: { buildId: response.buildId, sha256: mysqlBuild.wasmSha256 },
    position: { cursor: player.length, length: player.length },
    state: {
      session: { transaction: { active: true, base: session.database } },
      result: { rows: [[{ kind: 'decimal', value: '43.6667' }]] },
    },
  });
  expect(record.state).toEqual(end);
  expect(JSON.parse(new TextDecoder().decode(json))).toEqual(record);
  const write = packet.trace.steps.findIndex((step) => step.event === 'update') + 1;
  const earlier = await captureMysqlSnapshot(
    response,
    write - 1,
    'SQL 快照',
    'mysql.document.free',
    () => true,
  );
  expect(earlier.record.state).toEqual(player.seek(write - 1));
  expect(earlier.record.state.session.database).toEqual(session.database);
  const changed = await captureMysqlSnapshot(
    response,
    write,
    'SQL 快照',
    'mysql.document.free',
    () => true,
  );
  expect(changed.record.state.session.database).not.toEqual(session.database);
  expect(player.seek(0).session).toEqual(session);
  const markdown = new TextDecoder().decode(mysqlSnapshotMarkdown(record));
  expect(markdown).toContain(source);
  expect(markdown).toContain('43.6667');
  const serialized = /\n(`{3,})json\n([\s\S]+)\n\1\n?$/u.exec(markdown)!;
  expect(JSON.parse(serialized[2])).toEqual(record);
});

test('judge snapshot includes the actual chosen independent session and full four-case result', async () => {
  const profile = mysqlProfile('mysql.exercise.average')!;
  const response = await client().judge(profile.referenceSource, profile.id, 3, 'review-three');
  const captured = await captureMysqlSnapshot(
    response,
    response.replay!.trace.steps.length,
    profile.title,
    profile.id,
    () => true,
  );
  expect(captured.record.reviewCase).toBe(3);
  expect(captured.record.initialSession).toEqual(profile.cases[3].session);
  expect(captured.record.judgement).toMatchObject({ passed: true, complete: true, reviewCase: 3 });
  expect(captured.record.judgement!.cases).toHaveLength(4);
  expect(captured.record.state.result).toEqual(profile.cases[3].expectedResult);
});

test('cloned or invalidated responses, invalid cursors and changes during capture cannot be exported', async () => {
  const engine = client();
  const response = await engine.run("SELECT 0, NULL, '';", defaultMysqlSession());
  await expect(
    captureMysqlSnapshot(structuredClone(response), 0, 'SQL', 'mysql.document.free', () => true),
  ).rejects.toThrow('请先运行');
  await expect(
    captureMysqlSnapshot(response, -1, 'SQL', 'mysql.document.free', () => true),
  ).rejects.toThrow('E_PROTOCOL_INVALID');
  let current = true;
  const pending = captureMysqlSnapshot(response, 0, 'SQL', 'mysql.document.free', () => current);
  current = false;
  await expect(pending).rejects.toThrow('已变化');
  engine.invalidate();
  await expect(
    captureMysqlSnapshot(response, 0, 'SQL', 'mysql.document.free', () => true),
  ).rejects.toThrow('请先运行');
});

test('UTF-8 protocol offsets locate SQL after CRLF, lone CR and non-BMP text without splitting a scalar', () => {
  const source = "-- 字🙂\r\nSELECT '🙂';\rSELECT 0;";
  const positions = mysqlSourcePositions(source);
  const first = new TextEncoder().encode('-- 字🙂\r\n').length;
  expect(positions.get(first)).toEqual({
    utf16Offset: source.indexOf('SELECT'),
    line: 2,
    column: 1,
  });
  const second = new TextEncoder().encode("-- 字🙂\r\nSELECT '🙂';\r").length;
  expect(positions.get(second)).toEqual({
    utf16Offset: source.lastIndexOf('SELECT'),
    line: 3,
    column: 1,
  });
  const emojiByte = new TextEncoder().encode('-- 字').length;
  expect(positions.has(emojiByte + 1)).toBe(false);
  expect(positions.has(emojiByte + 2)).toBe(false);
  expect(positions.has(emojiByte + 3)).toBe(false);
});

test('table presentation distinguishes NULL, zero, empty and whitespace-bearing text while keeping decimals exact', () => {
  expect([
    showMysqlCell({ kind: 'null' }),
    showMysqlCell({ kind: 'int', value: 0 }),
    showMysqlCell({ kind: 'text', value: '' }),
    showMysqlCell({ kind: 'text', value: '林安' }),
    showMysqlCell({ kind: 'text', value: '林安 ' }),
    showMysqlCell({ kind: 'text', value: ' a  b' }),
    showMysqlCell({ kind: 'text', value: 'a\tb\n' }),
    showMysqlCell({ kind: 'decimal', value: '9007199254740991' }),
  ]).toEqual(['NULL', '0', '""', '林安', '"林安 "', '" a  b"', '"a\\tb\\n"', '9007199254740991']);
});
