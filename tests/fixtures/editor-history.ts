import { vi } from 'vitest';
import type { EditorHistoryPort } from '../../web/src/practice/history';
import type { EditorSnapshot } from '../../web/src/storage/editor-history';

/** Synthetic storage port only. Integration tests still analyse and execute real Rust/WASM. */
export function historyMemory() {
  const rows = new Map<string, EditorSnapshot>();
  let sequence = 0;
  const context = {
    generation: crypto.randomUUID(),
    activePackageRef: { id: 'content.c.p0', version: '1.0.0' },
    epoch: 0,
  };
  const port: EditorHistoryPort = {
    context: () => context,
    read: vi.fn(async () => structuredClone([...rows.values()])),
    save: vi.fn<EditorHistoryPort['save']>(async (_context, draft, updateOnly) => {
      const old = rows.get(draft.entryId);
      if (!old && updateOnly) return { saved: true, record: null, pruned: 0 };
      const record = { ...structuredClone(draft), sequence: old?.sequence ?? ++sequence };
      rows.set(record.entryId, record);
      return { saved: true, record, pruned: 0 };
    }),
  };
  return { port, rows, context };
}
