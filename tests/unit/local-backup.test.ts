import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateC6LearningIndex } from '../../web/src/c6-learning';
import { parseC6TeachingManifest } from '../../web/src/content/c6-teaching-validator.mjs';
import { c6TeachingRelease } from '../../web/src/content/c6-teaching-release.generated';
import { createC6ResetMeta } from '../../web/src/storage/c6-reset';
import { toPythonMeta } from '../../web/src/storage/python3-meta';
import { toJavaMeta } from '../../web/src/storage/java-meta';
import { toCppMeta } from '../../web/src/storage/cpp-course-meta';
import { toRustMeta } from '../../web/src/storage/rust2018-meta';
import { toMysqlMeta } from '../../web/src/storage/mysql-meta';
import { emptySnapshot, recordKey, STORE_NAMES } from '../../web/src/storage/model';
import { defaultMysqlSession } from '../../web/src/engine/mysql-data';
import {
  BACKUP_STORES,
  createBackupFile,
  prepareBackupFile,
  restoredBackupRows,
  validateBackupRows,
  type BackupRows,
  type PreparedBackup,
} from '../../web/src/storage/backup';

const manifest = await parseC6TeachingManifest(
  Uint8Array.from(
    readFileSync(new URL('../../content/c/primer6-teaching/manifest-2.0.0.json', import.meta.url)),
  ),
  c6TeachingRelease.manifestSha256,
);
const index = validateC6LearningIndex(
  JSON.parse(
    readFileSync(
      new URL('../../content/c/primer6-learning/index-1.0.0.json', import.meta.url),
      'utf8',
    ),
  ),
  manifest,
);
const generation = '00000000-0000-4000-8000-000000000072';
const at = '2026-11-09T02:00:00.000Z';
function compare(a: IDBValidKey, b: IDBValidKey): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const order = compare(a[i], b[i]);
      if (order) return order;
    }
    return a.length - b.length;
  }
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  throw new Error('Invalid native key');
}
function fresh() {
  const meta = toMysqlMeta(
    toRustMeta(toCppMeta(toJavaMeta(toPythonMeta(createC6ResetMeta(generation, 'UTC', at))))),
  );
  meta.revision = 4;
  const snapshot = emptySnapshot(meta);
  const rows = Object.fromEntries(BACKUP_STORES.map((name) => [name, []])) as unknown as BackupRows;
  for (const name of STORE_NAMES) {
    const list: unknown[] = ['meta', 'settings', 'avatar', 'appearance'].includes(name)
      ? [snapshot[name as 'meta']]
      : snapshot[name as 'progress'];
    rows[name] = list.map((value) => ({ key: recordKey(name, generation, value as never), value }));
  }
  rows.pythonDrafts.push({
    key: [generation, 'py3.document.free'],
    value: {
      draftVersion: '2.1.0',
      generation,
      documentId: 'py3.document.free',
      revision: 1,
      updatedAt: at,
      source: 'print(1)',
    },
  });
  for (const language of ['java', 'cpp', 'rust'] as const)
    rows[`${language}Drafts`].push({
      key: [generation, `${language}.document.free`],
      value: {
        draftVersion: '2.2.0',
        generation,
        documentId: `${language}.document.free`,
        revision: 2,
        updatedAt: at,
        source: `saved-${language}`,
      },
    });
  const session = defaultMysqlSession();
  session.transaction = { active: true, base: structuredClone(session.database) };
  rows.mysqlDrafts.push({
    key: [generation, 'mysql.document.free'],
    value: {
      draftVersion: '1.0.0',
      generation,
      documentId: 'mysql.document.free',
      revision: 3,
      updatedAt: at,
      source: 'SELECT 尚未写完',
      session,
    },
  });
  rows.courseDrafts.push({
    key: [generation, 'saved-c'],
    value: {
      draftVersion: '2.0.0',
      generation,
      documentId: 'saved-c',
      nodeRef: { id: index.lessons[0][1], version: '2.0.0' },
      exerciseRef: null,
      sourceRevision: 'saved-revision',
      source: 'int main(){return 0;}',
      input: '',
      revision: 1,
      updatedAt: at,
    },
  });
  return rows;
}
async function changedFile(change: (archive: Record<string, unknown>) => void, checksum = true) {
  const file = await createBackupFile(fresh(), index, compare);
  const archive = JSON.parse(await file.text());
  change(archive);
  if (checksum)
    archive.sha256 = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(archive.stores)),
        ),
      ),
    ]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
  return new Blob([JSON.stringify(archive)]);
}

describe('complete DB15 local archive', () => {
  it('round-trips all 29 partitions and six drafts including a live SQL transaction', async () => {
    const original = fresh();
    expect(BACKUP_STORES).toHaveLength(29);
    const file = await createBackupFile(original, index, compare);
    const prepared = await prepareBackupFile(file, index, compare);
    expect(prepared.summary.records).toBe(10);
    const restored = restoredBackupRows(prepared, generation, 4);
    expect(restored.mysqlDrafts).toEqual(original.mysqlDrafts);
    for (const name of BACKUP_STORES.filter((name) => name !== 'meta'))
      expect(restored[name]).toEqual(original[name]);
  });
  it('remaps native generation keys and record generations while preserving historical identities and revisions', async () => {
    const prepared = await prepareBackupFile(
      await createBackupFile(fresh(), index, compare),
      index,
      compare,
    );
    const next = '00000000-0000-4000-8000-000000000073';
    const rows = restoredBackupRows(prepared, next, 20);
    const snapshot = validateBackupRows(rows, index, compare);
    expect(snapshot.meta).toMatchObject({ generation: next, revision: 21 });
    for (const name of [
      'courseDrafts',
      'pythonDrafts',
      'javaDrafts',
      'cppDrafts',
      'rustDrafts',
      'mysqlDrafts',
    ] as const) {
      expect(rows[name][0].key).toEqual([
        next,
        (rows[name][0].value as { documentId: string }).documentId,
      ]);
      expect(rows[name][0].value).toMatchObject({ generation: next });
    }
  });
  it('rejects invented or copied preview capabilities and freezes the real summary', async () => {
    const prepared = await prepareBackupFile(
      await createBackupFile(fresh(), index, compare),
      index,
      compare,
    );
    expect(Object.isFrozen(prepared.summary.storeCounts)).toBe(true);
    expect(() => restoredBackupRows({ ...prepared } as PreparedBackup, generation, 1)).toThrow();
  });
  it('rejects modified bytes before any schema is trusted', async () => {
    const file = await changedFile((archive) => {
      (archive.stores as BackupRows).settings[0].value = {};
    }, false);
    await expect(prepareBackupFile(file, index, compare)).rejects.toThrow('S_RECORD_INVALID');
  });
  it.each(['version', 'dbVersion'])('rejects unsupported %s', async (field) => {
    const file = await changedFile((archive) => {
      archive[field] = field === 'version' ? '99.0.0' : 16;
    });
    await expect(prepareBackupFile(file, index, compare)).rejects.toThrow('S_VERSION_UNKNOWN');
  });
  it.each(['unknown-store', 'key', 'sql-session', 'generation', 'missing-store', 'course-id'])(
    'rejects checksum-valid corrupt archives: %s',
    async (mode) => {
      const file = await changedFile((archive) => {
        const rows = archive.stores as BackupRows;
        if (mode === 'unknown-store') Object.assign(rows, { aiKeys: [] });
        if (mode === 'missing-store') delete (rows as Partial<BackupRows>).receipts;
        if (mode === 'key') rows.javaDrafts[0].key = [generation, 'wrong-key'];
        if (mode === 'sql-session')
          (rows.mysqlDrafts[0].value as Record<string, unknown>).session = {};
        if (mode === 'generation')
          (rows.cppDrafts[0].value as Record<string, unknown>).generation = crypto.randomUUID();
        if (mode === 'course-id')
          (rows.rustDrafts[0].value as Record<string, unknown>).documentId = 'unknown.document';
      });
      await expect(prepareBackupFile(file, index, compare)).rejects.toThrow();
    },
  );
  it('rejects credential fields and oversized or malformed files', async () => {
    const credential = await changedFile((archive) => {
      archive.apiKey = 'never-import-this';
    });
    await expect(prepareBackupFile(credential, index, compare)).rejects.toThrow();
    await expect(prepareBackupFile(new Blob(['{bad-json']), index, compare)).rejects.toThrow();
    await expect(prepareBackupFile(new Blob([]), index, compare)).rejects.toThrow();
  });
});
