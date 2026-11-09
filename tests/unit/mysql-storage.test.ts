import { describe, expect, it, vi } from 'vitest';
import { createC6ResetMeta } from '../../web/src/storage/c6-reset';
import { toPythonMeta } from '../../web/src/storage/python3-meta';
import { toJavaMeta } from '../../web/src/storage/java-meta';
import { toCppMeta } from '../../web/src/storage/cpp-course-meta';
import { toRustMeta } from '../../web/src/storage/rust2018-meta';
import { toMysqlMeta } from '../../web/src/storage/mysql-meta';
import { emptySnapshot } from '../../web/src/storage/model';
import {
  assertMysqlCourseState,
  assertMysqlDraftInput,
  type MysqlCourseState,
  type MysqlDraft,
} from '../../web/src/storage/mysql-course';
import { MysqlLearningSession } from '../../web/src/learning/mysql-session';
import { defaultMysqlSession } from '../../web/src/engine/mysql-data';
import { mysqlFreeDocument, isMysqlDocument } from '../../web/src/mysql-course/identities';
import { mysqlLessonIds, mysqlProfiles } from '../../web/src/mysql-course/release.generated';
import type { MysqlSession } from '../../web/src/engine/mysql-types';
import type { StorageClient } from '../../web/src/storage/client';

const at = '2026-11-09T02:00:00.000Z';
const generation = '00000000-0000-4000-8000-000000000043';
function state(): MysqlCourseState {
  const meta = toMysqlMeta(
    toRustMeta(toCppMeta(toJavaMeta(toPythonMeta(createC6ResetMeta(generation, 'UTC', at))))),
  );
  meta.revision = 1;
  return { snapshot: emptySnapshot(meta), rows: { activities: [], drafts: [] } };
}
function draft(session = defaultMysqlSession()): MysqlDraft {
  return {
    draftVersion: '1.0.0',
    generation,
    documentId: mysqlFreeDocument,
    revision: 1,
    updatedAt: at,
    source: 'SELECT',
    session,
  };
}
function activeSession(): MysqlSession {
  const session = defaultMysqlSession();
  session.transaction = { active: true, base: structuredClone(session.database) };
  return session;
}

describe('MySQL independent SQL plus session drafts', () => {
  it('admits exactly free, twelve exercises and twelve runnable leaves', () => {
    const runnable: string[] = Object.values(mysqlProfiles).map((p) => p.lesson);
    const ids = [
      mysqlFreeDocument,
      ...Object.keys(mysqlProfiles),
      ...mysqlLessonIds.filter(isMysqlDocument),
    ];
    expect(new Set(ids).size).toBe(25);
    expect(runnable.every(isMysqlDocument)).toBe(true);
    expect(isMysqlDocument('mysql.lesson.1')).toBe(false);
    expect(isMysqlDocument(mysqlLessonIds.find((id) => !runnable.includes(id))!)).toBe(false);
  });
  it('saves unfinished Unicode SQL with the complete active transaction and rejects result credentials', () => {
    const input = { source: 'SELECT 😃 尚未写完', session: activeSession() };
    expect(() => assertMysqlDraftInput(input)).not.toThrow();
    for (const extra of ['result', 'control', 'trace', 'judgement', 'proof'])
      expect(() => assertMysqlDraftInput({ ...input, [extra]: null })).toThrow('S_RECORD_INVALID');
    expect(() => assertMysqlDraftInput({ source: '\ud800', session: input.session })).toThrow(
      'S_RECORD_INVALID',
    );
    expect(() =>
      assertMysqlDraftInput({ source: '界'.repeat(10923), session: input.session }),
    ).toThrow('S_RECORD_INVALID');
  });
  it.each([
    'active-base-null',
    'inactive-with-base',
    'bad-base-id',
    'schema-changed',
    'decimal-column',
  ])('rejects malformed transaction/session: %s', (mode) => {
    const session = activeSession();
    if (mode === 'active-base-null') session.transaction.base = null;
    if (mode === 'inactive-with-base') session.transaction.active = false;
    if (mode === 'bad-base-id') session.transaction.base!.nextRowId = 0;
    if (mode === 'schema-changed') session.transaction.base!.tables[0].name = 'different';
    if (mode === 'decimal-column')
      session.database.tables[0].rows[0].values[0] = { kind: 'decimal', value: '1' };
    expect(() => assertMysqlDraftInput({ source: '', session })).toThrow('S_RECORD_INVALID');
  });
  it('rejects accessors, cycles, sparse arrays and exotic objects without invoking getters', () => {
    const getter = vi.fn(() => defaultMysqlSession());
    expect(() =>
      assertMysqlDraftInput({
        source: '',
        get session() {
          return getter();
        },
      }),
    ).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const sparse = defaultMysqlSession();
    delete sparse.database.tables[0];
    expect(() => assertMysqlDraftInput({ source: '', session: sparse })).toThrow();
    const cyclic = { source: '', session: null as unknown };
    cyclic.session = cyclic;
    expect(() => assertMysqlDraftInput(cyclic)).toThrow();
    expect(() => assertMysqlDraftInput({ source: '', session: new Date() })).toThrow();
  });
  it('checks closed record version, generation, document identity and source-plus-session aggregate quota', () => {
    const current = state();
    current.rows.drafts = [draft()];
    expect(() => assertMysqlCourseState(current)).not.toThrow();
    for (const patch of [
      { generation: crypto.randomUUID() },
      { documentId: 'java.document.free' },
      { draftVersion: '2.2.0' },
      { result: {} },
    ])
      expect(() =>
        assertMysqlCourseState({
          ...current,
          rows: { activities: [], drafts: [{ ...draft(), ...patch } as MysqlDraft] },
        }),
      ).toThrow();
    const database: MysqlSession['database'] = {
      nextRowId: 191,
      tables: [
        {
          name: 'large',
          columns: [
            {
              name: 'value',
              type: 'varchar',
              length: 256,
              nullable: false,
              primaryKey: false,
              unique: false,
              defaultValue: null,
            },
          ],
          rows: Array.from({ length: 190 }, (_, index) => ({
            id: index + 1,
            values: [{ kind: 'text' as const, value: 'x'.repeat(250) }],
          })),
        },
      ],
    };
    const session: MysqlSession = {
      database,
      transaction: { active: true, base: structuredClone(database) },
    };
    expect(() => assertMysqlDraftInput({ source: '', session })).not.toThrow();
    const ids = [
      mysqlFreeDocument,
      ...Object.keys(mysqlProfiles),
      ...Object.values(mysqlProfiles).map((p) => p.lesson),
    ];
    current.rows.drafts = ids.map((documentId) => ({ ...draft(session), documentId, source: '' }));
    expect(() => assertMysqlCourseState(current)).toThrow('S_QUOTA');
  });

  function setup() {
    let current = state();
    let epoch = 3;
    const read = vi.fn(async () => structuredClone(current));
    const commit = vi.fn(async (_generation, revision, prepare) => {
      expect(revision).toBe(current.snapshot.meta.revision);
      const recipe = prepare(structuredClone(current));
      if (recipe.draft) {
        current.rows.drafts = [recipe.draft];
        current.snapshot.meta.revision++;
        assertMysqlCourseState(current);
      }
      return { saved: true as const, revision: current.snapshot.meta.revision, replayed: false };
    });
    let queued: (() => Promise<unknown>) | undefined;
    const session = new MysqlLearningSession({
      current: () => ({ epoch, snapshot: current.snapshot, writable: true, rollback: false }),
      storage: () =>
        ({ readMysqlCourse: read, commitMysqlCourse: commit }) as unknown as StorageClient,
      run: <T>(action: () => Promise<T>) => {
        queued = action;
        return action();
      },
      openDay: vi.fn(),
      saved: async (result) => result,
      rewards: (ops) => ops,
      clock: () => at,
    });
    return {
      session,
      commit,
      current: () => current,
      advance: () => {
        epoch++;
      },
      invoke: () => queued!(),
      set: (next: MysqlCourseState) => {
        current = next;
      },
    };
  }
  it('uses document CAS, treats a session-only edit as a write, and keeps identical input a no-op', async () => {
    const fixture = setup();
    const input = { source: 'SELECT', session: defaultMysqlSession() };
    const first = await fixture.session.saveDraft(mysqlFreeDocument, input, null, 3);
    await expect(fixture.session.saveDraft(mysqlFreeDocument, input, null, 3)).rejects.toThrow(
      'S_REVISION_CONFLICT',
    );
    const noOp = await fixture.session.saveDraft(mysqlFreeDocument, input, first.revision, 3);
    expect(noOp.revision).toBe(first.revision);
    const changed = { ...input, session: activeSession() };
    const second = await fixture.session.saveDraft(mysqlFreeDocument, changed, first.revision, 3);
    expect(second.revision).toBe(first.revision + 1);
    expect(second.session.transaction.active).toBe(true);
    expect(fixture.current().snapshot.progress).toEqual([]);
    fixture.advance();
    await expect(fixture.session.readDraft(mysqlFreeDocument, 3)).rejects.toThrow(
      'S_GENERATION_STALE',
    );
  });
  it('captures session and SQL before any queued delay', async () => {
    const fixture = setup();
    const input = { source: 'SELECT', session: activeSession() };
    const pending = fixture.session.saveDraft(mysqlFreeDocument, input, null, 3);
    input.source = 'changed';
    input.session.transaction.active = false;
    const saved = await pending;
    expect(saved.source).toBe('SELECT');
    expect(saved.session.transaction.active).toBe(true);
  });
});
