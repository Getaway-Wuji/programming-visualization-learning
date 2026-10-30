import { describe, expect, it, vi } from 'vitest';
import { EditorHistoryController } from '../../web/src/practice/history';
import type { EditDocumentSnapshot } from '../../web/src/practice/edit-document';
import { assertEditorSnapshot, type EditorScope } from '../../web/src/storage/editor-history';
import { upgradeV2Meta } from '../../web/src/storage/v2-migration';
import { createMeta } from '../../web/src/storage/model';
import { historyMemory } from '../fixtures/editor-history';

const generation = crypto.randomUUID();
const scope: EditorScope = {
  packageRef: { id: 'content.c.p0', version: '1.0.0' },
  exerciseRef: { id: 'exercise.c.echo', version: '1.0.0' },
  programRef: { id: 'program.c.echo', version: '1.0.0' },
  mode: 'independent',
};
function document(revision = 1, text = 'int main() {}', pending = false) {
  // Infrastructure-only capture fixture; restoration/execution uses real Rust below in edit-session.
  return {
    identity: { editId: `edit-${revision}`, documentRevision: revision },
    input: {},
    origin: 'code',
    authoritativeDraft: { kind: 'code', text },
    codeDraft: text,
    analysisPending: pending,
    analysisError: null,
    syncStatus: text.endsWith('int') ? 'invalid' : 'synced',
  } as EditDocumentSnapshot;
}
const draft = {};
async function settled(controller: EditorHistoryController) {
  await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
}
describe('bounded editor capture queue and independent SAVE3 migration', () => {
  it('coalesces analysis, records edits/moves/restores and ignores presentation repeats', async () => {
    const { port, rows } = historyMemory();
    const controller = new EditorHistoryController(port);
    controller.activate(scope);
    controller.capture(document(1, 'int', true), draft);
    await settled(controller);
    const first = [...rows.keys()][0];
    controller.capture(document(1, 'int'), draft);
    await settled(controller);
    expect(rows.size).toBe(1);
    expect(rows.get(first)?.state).toBe('invalid');
    controller.capture(document(2), draft);
    await settled(controller);
    const count = vi.mocked(port.save).mock.calls.length;
    controller.capture(document(2), draft);
    expect(vi.mocked(port.save).mock.calls).toHaveLength(count);
    controller.capture(document(2), { blocks: { languageVersion: 0, blocks: [] } }, true);
    await settled(controller);
    controller.markRestore(first);
    controller.capture(document(3, 'int'), draft);
    await settled(controller);
    expect([...rows.values()].map((r) => r.reason)).toEqual(['initial', 'code', 'move', 'restore']);
    expect([...rows.values()].at(-1)?.restoredFrom).toBe(first);
    controller.activate({ ...scope, mode: 'correction' });
    await settled(controller);
    expect(controller.getSnapshot().items).toEqual([]);
    expect(controller.find(first)).toBeUndefined();
  });
  it('preserves stable IDs and the newest pending analysis while an ACK is delayed', async () => {
    const { port, rows } = historyMemory();
    const save = port.save;
    let release!: () => void;
    port.save = vi.fn<typeof save>(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      port.save = save;
      return save(...args);
    });
    const controller = new EditorHistoryController(port);
    controller.activate(scope);
    controller.capture(document(1, 'int', true), draft);
    controller.capture(document(1, 'int'), draft);
    release();
    await settled(controller);
    expect(rows.size).toBe(1);
    expect([...rows.values()][0]).toMatchObject({ state: 'invalid', captureVersion: 1 });
    expect(vi.mocked(save).mock.calls.at(-1)?.[2]).toBe(true);
  });
  it('keeps failed writes, retries the same identity, and drops late ACKs after clear', async () => {
    const { port, rows } = historyMemory();
    const save = port.save;
    port.save = vi.fn(async () => {
      throw { code: 'S_QUOTA' };
    });
    const controller = new EditorHistoryController(port);
    controller.activate(scope);
    await settled(controller);
    controller.capture(document(), draft);
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('unsaved'));
    const id = controller.getSnapshot().items[0].record.entryId;
    expect(controller.getSnapshot().message).toContain('空间不足');
    controller.capture(document(1, 'int'), draft);
    expect(controller.getSnapshot().status).toBe('unsaved');
    expect(controller.getSnapshot().message).toContain('空间不足');
    port.save = save;
    await controller.retry();
    expect(rows.has(id)).toBe(true);
    let release!: () => void;
    port.save = async (...args) => {
      await new Promise<void>((resolve) => (release = resolve));
      return save(...args);
    };
    controller.capture(document(2), draft);
    controller.leave(true);
    release();
    await vi.waitFor(() => expect(controller.getSnapshot().pending).toBe(0));
    expect(controller.getSnapshot().items).toEqual([]);
  });
  it('bounds unsaved memory and does not save during an active run', async () => {
    const { port } = historyMemory();
    const controller = new EditorHistoryController(port);
    controller.activate(scope);
    await settled(controller);
    controller.pause(true);
    for (let n = 1; n <= 101; n++)
      controller.capture(document(n, `int main(){return ${n};}`), draft);
    expect(port.save).not.toHaveBeenCalled();
    expect(controller.getSnapshot().items).toHaveLength(100);
    expect(controller.getSnapshot().pending).toBe(100);
    expect(controller.getSnapshot().message).toContain('100条或8 MiB');
    controller.leave(true);
    controller.pause(false);
    expect(port.save).not.toHaveBeenCalled();
  });
  it('rejects unknown fields, versions and UTF-8 overflow in closed history rows', async () => {
    const { port, rows } = historyMemory();
    const controller = new EditorHistoryController(port);
    controller.activate(scope);
    controller.capture(document(), draft);
    await settled(controller);
    const row = [...rows.values()][0];
    expect(() => assertEditorSnapshot(row)).not.toThrow();
    for (const changed of [
      { ...row, historyVersion: '2.0.0' },
      { ...row, state: 'executed' },
      { ...row, trace: [] },
      { ...row, codeText: '中'.repeat(10923) },
      { ...row, workspaceJson: ' '.repeat(1048577) },
    ])
      expect(() => assertEditorSnapshot(changed)).toThrow();
  });
  it('changes only valid known-V2 meta, preserving learning authority and rejecting future versions', () => {
    const current = createMeta({
      activePackageRef: scope.packageRef,
      timeZone: 'Asia/Shanghai',
      createdAt: '2026-10-30T00:00:00.000Z',
      generation,
    });
    const old = { ...current, schemaVersion: '2.0.0', dbVersion: 2, revision: 8 };
    expect(upgradeV2Meta(old)).toEqual({ ...current, revision: 9 });
    expect(old).toMatchObject({ schemaVersion: '2.0.0', revision: 8 });
    expect(upgradeV2Meta({ ...old, generation: 'broken' })).toBeNull();
    expect(upgradeV2Meta({ ...old, revision: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(() => upgradeV2Meta({ ...old, schemaVersion: '4.0.0' })).toThrow('S_VERSION_UNKNOWN');
  });
});
