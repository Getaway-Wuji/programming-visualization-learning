import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import type { MysqlManifest, MysqlLesson } from '../../web/src/mysql-course/repository';
import type {
  MysqlDatabase,
  MysqlProfileCase,
  MysqlResponse,
  MysqlState,
} from '../../web/src/engine/mysql-types';
import { execute_mysql, initSync } from '../../web/src/generated/mysql/c_viz_mysql';
import { mysqlBuild } from '../../web/src/generated/mysql/engine-build';
import { decodeMysqlResponse, mysqlRequest } from '../../web/src/engine/mysql-protocol';
import { MysqlPlayer } from '../../web/src/engine/mysql-player';

const folder = 'content/mysql/course/';
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const asset = (file: string, bytes: Uint8Array) => ({
  file,
  bytes: bytes.length,
  sha256: sha(bytes),
});
const signal = () => new AbortController().signal;
const filesOnDisk = () =>
  new Map(readdirSync(folder).map((file) => [file, new Uint8Array(readFileSync(folder + file))]));
type Fixture = { files: Map<string, Uint8Array<ArrayBuffer>>; manifest: MysqlManifest };
async function setup(mutate?: (fixture: Fixture) => void) {
  vi.resetModules();
  const files = filesOnDisk();
  const manifest = JSON.parse(
    new TextDecoder().decode(files.get('manifest-1.0.0.json')),
  ) as MysqlManifest;
  mutate?.({ files, manifest });
  files.set('manifest-1.0.0.json', encode(manifest));
  vi.doMock('../../web/src/mysql-course/release.generated', () => ({
    mysqlCourseRelease: asset('manifest-1.0.0.json', files.get('manifest-1.0.0.json')!),
  }));
  vi.stubGlobal('location', { origin: 'https://course.test' });
  vi.stubEnv('BASE_URL', '/');
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    expect(new URL(String(url)).origin).toBe('https://course.test');
    expect(options?.credentials).toBe('omit');
    expect(options?.redirect).toBe('error');
    const bytes = files.get(new URL(String(url)).pathname.split('/').at(-1)!);
    return bytes ? new Response(bytes.slice()) : new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetcher);
  return { repo: await import('../../web/src/mysql-course/repository'), files, manifest, fetcher };
}
function changeJson(
  fixture: Fixture,
  file: string,
  mutate: (value: Record<string, unknown>) => void,
) {
  const value = JSON.parse(new TextDecoder().decode(fixture.files.get(file))) as Record<
    string,
    unknown
  >;
  mutate(value);
  const bytes = encode(value);
  fixture.files.set(file, bytes);
  if (file === fixture.manifest.sourceFile.file) fixture.manifest.sourceFile = asset(file, bytes);
  else if (file === fixture.manifest.registryFile.file)
    fixture.manifest.registryFile = asset(file, bytes);
  else {
    const old = fixture.manifest.chunks.find((row) => row.file === file)!;
    Object.assign(old, asset(file, bytes));
  }
}
afterEach(() => {
  vi.doUnmock('../../web/src/mysql-course/release.generated');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

test('published 20 assets load lazily, cover every original node and retain exact frozen profiles', async () => {
  const { repo, fetcher, manifest, files } = await setup();
  expect(files.size).toBe(20);
  const loaded = await repo.loadMysqlManifest(signal());
  expect(loaded).toEqual(manifest);
  const nodes = [];
  for (const row of loaded.catalog)
    nodes.push((await repo.loadMysqlLesson(row.id, signal())).lesson);
  expect(nodes).toHaveLength(374);
  expect(nodes.filter((row) => row.leaf)).toHaveLength(300);
  expect(nodes.filter((row) => row.example?.mode === 'reading')).toHaveLength(288);
  expect(nodes.filter((row) => row.activity?.mode === 'judge')).toHaveLength(12);
  expect(
    nodes.filter((row) => row.coverage === 'toc-only' && row.physicalPage === null),
  ).toHaveLength(353);
  const source = await repo.loadMysqlSource(signal());
  expect(source.catalog).toEqual(manifest.catalog);
  expect(source.coverage).toMatchObject({ physicalPages: 24, bodyNodes: 21, tocOnlyNodes: 353 });
  const profiles = await repo.loadMysqlExercises(signal());
  expect(profiles).toEqual(
    JSON.parse(readFileSync('shared/contracts/mysql-profiles-1.0.0.json', 'utf8')).profiles,
  );
  expect(fetcher).toHaveBeenCalledTimes(20);
  for (const item of [...manifest.chunks, manifest.sourceFile, manifest.registryFile]) {
    expect(files.get(item.file)!.length).toBe(item.bytes);
    expect(sha(files.get(item.file)!)).toBe(item.sha256);
  }
});

const bag = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
function db(database: MysqlDatabase | MysqlProfileCase['expectedDatabase']) {
  return database.tables
    .map((table) => ({
      name: table.name.toLowerCase(),
      columns: table.columns,
      rows: bag(table.rows.map((row) => (Array.isArray(row) ? row : row.values))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function roundTrip(response: MysqlResponse) {
  expect(response.replay).not.toBeNull();
  const player = new MysqlPlayer(response.replay!);
  const initial = player.snapshot();
  for (let cursor = 1; cursor <= player.length; cursor++) player.seek(cursor);
  const end = player.snapshot();
  for (let cursor = player.length - 1; cursor >= 0; cursor--) player.seek(cursor);
  expect(player.snapshot()).toEqual(initial);
  return { initial, end };
}
function expectedState(state: MysqlState, wanted: MysqlProfileCase) {
  expect(state.result.kind).toBe(wanted.expectedResult.kind);
  expect(state.result.affectedRows).toBe(wanted.expectedResult.affectedRows);
  expect(state.result.matchedRows).toBe(wanted.expectedResult.matchedRows);
  expect(state.result.columns).toHaveLength(wanted.expectedResult.columns.length);
  if (wanted.checkColumnNames) expect(state.result.columns).toEqual(wanted.expectedResult.columns);
  expect(wanted.ordered ? state.result.rows : bag(state.result.rows)).toEqual(
    wanted.ordered ? wanted.expectedResult.rows : bag(wanted.expectedResult.rows),
  );
  expect(db(state.session.database)).toEqual(db(wanted.expectedDatabase));
  expect(state.session.transaction.active).toBe(wanted.expectedTransactionActive);
}
test('every published SQL example executes all 48 sessions and 48 selected four-group judgements with complete inverse replay', async () => {
  initSync({ module: new Uint8Array(readFileSync('web/src/generated/mysql/c_viz_mysql_bg.wasm')) });
  const { repo } = await setup();
  const profiles = await repo.loadMysqlExercises(signal());
  let executions = 0,
    judgements = 0;
  for (const p of profiles) {
    const { lesson } = await repo.loadMysqlLesson(p.lessonId, signal());
    expect(lesson.example?.mode).toBe('wasm');
    const source = lesson.example!.source;
    for (const c of p.cases) {
      const request = mysqlRequest(source, { operation: 'execute', session: c.session });
      const response = await decodeMysqlResponse(
        execute_mysql(request.bytes, mysqlBuild.wasmSha256, 1000).slice().buffer,
        request.request,
        mysqlBuild.wasmSha256,
        () => {},
      );
      expect(response.status, p.id + ':' + c.index).toBe('completed');
      const result = roundTrip(response);
      expect(result.initial.session).toEqual(c.session);
      expectedState(result.end, c);
      executions++;
      const judge = mysqlRequest(source, {
        operation: 'judge',
        profile: p.id,
        reviewCase: c.index,
      });
      const judged = await decodeMysqlResponse(
        execute_mysql(judge.bytes, mysqlBuild.wasmSha256, 1000).slice().buffer,
        judge.request,
        mysqlBuild.wasmSha256,
        () => {},
      );
      expect(judged.judgement).toMatchObject({
        passed: true,
        complete: true,
        reviewCase: c.index,
        cases: [
          { index: 0, passed: true },
          { index: 1, passed: true },
          { index: 2, passed: true },
          { index: 3, passed: true },
        ],
      });
      expectedState(roundTrip(judged).end, c);
      judgements++;
    }
  }
  expect({ executions, judgements }).toEqual({ executions: 48, judgements: 48 });
}, 30000);

test('returned copies cannot poison any cached manifest, source, lesson or registry', async () => {
  const { repo } = await setup();
  const m = await repo.loadMysqlManifest(signal()),
    s = await repo.loadMysqlSource(signal());
  const l = await repo.loadMysqlLesson('mysql.lesson.4.3.3', signal()),
    r = await repo.loadMysqlExercises(signal());
  const baseline = structuredClone({ m, s, l, r });
  m.catalog[0].title = 'changed';
  s.coverage.bodyChapters.push(99);
  l.lesson.body[0] = 'changed';
  l.lesson.references[0].url = 'https://invalid.test';
  l.index.catalog.pop();
  r[0].referenceSource = 'DROP TABLE students;';
  r[0].cases[0].session.database.tables.length = 0;
  expect(await repo.loadMysqlManifest(signal())).toEqual(baseline.m);
  expect(await repo.loadMysqlSource(signal())).toEqual(baseline.s);
  expect(await repo.loadMysqlLesson('mysql.lesson.4.3.3', signal())).toEqual(baseline.l);
  expect(await repo.loadMysqlExercises(signal())).toEqual(baseline.r);
});

for (const [name, mutate] of [
  ['extra manifest field', (f: Fixture) => Object.assign(f.manifest, { extra: true })],
  [
    'foreign parent',
    (f: Fixture) => {
      f.manifest.catalog[5].parent = 'mysql.lesson.99';
    },
  ],
  [
    'invented missing physical page',
    (f: Fixture) => {
      f.manifest.catalog[22].physicalPage = 12;
    },
  ],
  [
    'wrong source counts',
    (f: Fixture) => {
      Object.assign(f.manifest.counts, { reading: 287 });
    },
  ],
  [
    'foreign textbook hash',
    (f: Fixture) => {
      f.manifest.source.pdfSha256 = '0'.repeat(64);
    },
  ],
  [
    'foreign engine',
    (f: Fixture) => {
      f.manifest.engineSha256 = '0'.repeat(64);
    },
  ],
] as const)
  test(`valid-hash manifest still rejects ${name}`, async () => {
    const { repo } = await setup(mutate);
    await expect(repo.loadMysqlManifest(signal())).rejects.toThrow(
      /E_MYSQL_CONTENT_(SCHEMA|ENGINE)/,
    );
  });

for (const [name, alter] of [
  ['unknown teaching field', (n: MysqlLesson) => Object.assign(n, { rawLines: ['copied'] })],
  [
    'missing prose',
    (n: MysqlLesson) => {
      n.body = [];
    },
  ],
  [
    'wrong frozen SQL',
    (n: MysqlLesson) => {
      n.example!.source = 'SELECT 1;';
    },
  ],
  [
    'foreign reference',
    (n: MysqlLesson) => {
      n.references[0].url = 'https://evil.test/reference';
    },
  ],
] as const)
  test(`valid-hash unit still rejects ${name}`, async () => {
    const { repo } = await setup((f) =>
      changeJson(f, 'unit-04-1.0.0.json', (u) =>
        alter((u.nodes as MysqlLesson[]).find((n) => n.number === '4.3.3')!),
      ),
    );
    await expect(repo.loadMysqlLesson('mysql.lesson.4.3.3', signal())).rejects.toThrow(
      'E_MYSQL_CONTENT_SCHEMA',
    );
  });
test('valid-hash reading language must be a string rather than a coercible array', async () => {
  const { repo } = await setup((f) =>
    changeJson(f, 'unit-01-1.0.0.json', (u) =>
      Object.assign((u.nodes as MysqlLesson[]).find((n) => n.number === '1.1.1')!.example!, {
        language: ['sql'],
      }),
    ),
  );
  await expect(repo.loadMysqlLesson('mysql.lesson.1.1.1', signal())).rejects.toThrow(
    'E_MYSQL_CONTENT_SCHEMA',
  );
});

test('source and registry are closed shapes even with recomputed valid hashes', async () => {
  const { repo } = await setup((f) => {
    changeJson(f, 'source-1.0.0.json', (s) => Object.assign(s, { localPath: 'private.pdf' }));
    const file = f.manifest.registryFile.file;
    const rows = JSON.parse(new TextDecoder().decode(f.files.get(file))) as {
      referenceSource: string;
    }[];
    rows[0].referenceSource = 'SELECT 1;';
    const bytes = encode(rows);
    f.files.set(file, bytes);
    f.manifest.registryFile = asset(file, bytes);
  });
  await expect(repo.loadMysqlSource(signal())).rejects.toThrow('E_MYSQL_CONTENT_SCHEMA');
  await expect(repo.loadMysqlExercises(signal())).rejects.toThrow('E_MYSQL_CONTENT_SCHEMA');
});
for (const delta of [-1, 1, 0])
  test(`corrupt streamed unit bytes (${delta}) fail and do not enter the cache`, async () => {
    const { repo, files, fetcher } = await setup();
    const file = 'unit-01-1.0.0.json',
      original = files.get(file)!;
    const bad = new Uint8Array(original.length + delta);
    bad.set(original.subarray(0, bad.length));
    if (delta === 0) bad[20] ^= 1;
    files.set(file, bad);
    await expect(repo.loadMysqlLesson('mysql.lesson.1', signal())).rejects.toThrow(
      delta ? 'E_MYSQL_CONTENT_SIZE' : 'E_MYSQL_CONTENT_HASH',
    );
    files.set(file, original);
    expect((await repo.loadMysqlLesson('mysql.lesson.1', signal())).lesson.number).toBe('1');
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith(file))).toHaveLength(2);
  });
test('invalid UTF-8 and duplicate JSON fields fail even when manifest hashes match them', async () => {
  const fixture = await setup();
  const file = 'unit-01-1.0.0.json';
  const original = fixture.files.get(file)!;
  const invalid = original.slice();
  invalid[20] = 255;
  fixture.files.set(file, invalid);
  Object.assign(fixture.manifest.chunks[0], asset(file, invalid));
  // Fresh repository binds the newly signed test manifest, rather than bypassing crypto.
  const altered = await setup((f) => {
    f.files.set(file, invalid);
    Object.assign(f.manifest.chunks[0], asset(file, invalid));
  });
  await expect(altered.repo.loadMysqlLesson('mysql.lesson.1', signal())).rejects.toThrow(
    'E_MYSQL_CONTENT_SCHEMA',
  );
  const duplicate = await setup((f) => {
    const raw = new TextDecoder()
      .decode(f.files.get(file))
      .replace('"version":', '"version": "1.0.0",\n  "version":');
    const bytes = new TextEncoder().encode(raw);
    f.files.set(file, bytes);
    Object.assign(f.manifest.chunks[0], asset(file, bytes));
  });
  await expect(duplicate.repo.loadMysqlLesson('mysql.lesson.1', signal())).rejects.toThrow(
    'E_MYSQL_CONTENT_SCHEMA',
  );
});
test('cached calls honour immediate abort and concurrent abort cannot poison a successful caller', async () => {
  const { repo, files } = await setup();
  await repo.loadMysqlManifest(signal());
  const cached = new AbortController(),
    request = repo.loadMysqlManifest(cached.signal);
  cached.abort();
  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  const gates: (() => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return new Response(files.get(new URL(String(url)).pathname.split('/').at(-1)!)!.slice());
    }),
  );
  const a = new AbortController(),
    first = repo.loadMysqlLesson('mysql.lesson.1', a.signal);
  const failure = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  const second = repo.loadMysqlLesson('mysql.lesson.1.1', signal());
  await vi.waitFor(() => expect(gates).toHaveLength(2));
  a.abort();
  gates.forEach((resolve) => resolve());
  await failure;
  expect((await second).lesson.number).toBe('1.1');
  expect((await repo.loadMysqlLesson('mysql.lesson.1', signal())).lesson.number).toBe('1');
  await expect(repo.loadMysqlLesson('mysql.lesson.999', signal())).rejects.toThrow(
    'E_MYSQL_LESSON_UNKNOWN',
  );
});
