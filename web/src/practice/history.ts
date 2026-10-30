import type { EditDocumentSnapshot } from './edit-document';
import type { BlockWorkspaceDraft } from '../blocks/workspace';
import {
  assertEditorSnapshot,
  EDIT_HISTORY_LIMITS,
  historyBytes,
  sameEditorScope,
  type EditorHistoryContext,
  type EditorHistorySave,
  type EditorScope,
  type EditorSnapshot,
  type EditorSnapshotDraft,
} from '../storage/editor-history';

export interface EditorHistoryPort {
  context(): EditorHistoryContext | null;
  read(context: EditorHistoryContext): Promise<EditorSnapshot[]>;
  save(
    context: EditorHistoryContext,
    record: EditorSnapshotDraft,
    updateOnly: boolean,
  ): Promise<EditorHistorySave>;
}
export interface EditorHistoryItem {
  record: EditorSnapshot;
  saved: boolean;
}
export interface EditorHistoryState {
  items: readonly EditorHistoryItem[];
  status: 'loading' | 'ready' | 'saving' | 'unsaved' | 'unavailable';
  pending: number;
  pruned: number;
  message: string;
}
const inputText = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
export const editorHistoryInput = inputText;
type Pending = { context: EditorHistoryContext; record: EditorSnapshot; updateOnly: boolean };

/** Editor-only queue. It never constructs learning events or reuses execution authority. */
export class EditorHistoryController {
  private state: EditorHistoryState = {
    items: [],
    status: 'unavailable',
    pending: 0,
    pruned: 0,
    message: '',
  };
  private listeners = new Set<() => void>();
  private scope?: EditorScope;
  private writerId = crypto.randomUUID();
  private bank = new Map<string, EditorHistoryItem>();
  private pending = new Map<string, Pending>();
  private last?: { id: string; editId: string; content: string };
  private lease = 0;
  private reading = 0;
  private pumping = false;
  private paused = false;
  private blocked = false;
  private restoredFrom: string | null = null;
  private order = new Map<string, number>();
  private ordinal = 0;
  constructor(private readonly port?: EditorHistoryPort) {}
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<EditorHistoryState> = {}) {
    const items = [...this.bank.values()]
      .filter((item) => this.scope && sameEditorScope(item.record.scope, this.scope))
      .sort((a, b) =>
        a.saved !== b.saved
          ? a.saved
            ? 1
            : -1
          : b.record.sequence - a.record.sequence ||
            (this.order.get(b.record.entryId) ?? 0) - (this.order.get(a.record.entryId) ?? 0),
      )
      .slice(0, 100);
    this.state = { ...this.state, ...patch, items, pending: this.pending.size };
    for (const listener of this.listeners) listener();
  }
  activate(scope: EditorScope) {
    this.scope = structuredClone(scope);
    this.last = undefined;
    void this.reload();
  }
  leave(invalidate = false) {
    this.scope = undefined;
    this.last = undefined;
    ++this.reading;
    if (invalidate) {
      ++this.lease;
      this.bank.clear();
      this.pending.clear();
      this.order.clear();
      this.blocked = false;
      this.restoredFrom = null;
    }
    this.publish({ status: this.pending.size ? 'unsaved' : 'ready' });
  }
  pause(value: boolean) {
    this.paused = value;
    if (!value) void this.pump();
  }
  markRestore(id: string) {
    this.restoredFrom = id;
  }
  find(id: string) {
    const value = this.bank.get(id)?.record;
    return value && this.scope && sameEditorScope(value.scope, this.scope)
      ? structuredClone(value)
      : undefined;
  }
  capture(document: EditDocumentSnapshot, draft: BlockWorkspaceDraft, move = false) {
    if (!this.scope || !this.port) return;
    const context = this.port.context();
    const workspaceJson = JSON.stringify(draft),
      inputJson = inputText(document.input);
    const content = JSON.stringify([
      document.authoritativeDraft.kind,
      document.codeDraft,
      workspaceJson,
      inputJson,
    ]);
    const status = document.analysisPending
      ? 'pending'
      : document.analysisError
        ? 'error'
        : document.syncStatus;
    const restoring = this.restoredFrom;
    const previous = this.last && this.bank.get(this.last.id);
    const reuse =
      !restoring &&
      previous &&
      !move &&
      (this.last!.editId === document.identity.editId || this.last!.content === content);
    if (move && this.last?.content === content) return;
    const state: EditorSnapshot = {
      historyVersion: this.scope.mode === 'reconstruction' ? '1.1.0' : '1.0.0',
      entryId: reuse ? previous.record.entryId : crypto.randomUUID(),
      writerId: this.writerId,
      generation: context?.generation ?? this.writerId,
      sequence: reuse ? previous.record.sequence : 0,
      captureVersion: reuse ? previous.record.captureVersion + 1 : 0,
      createdAt: reuse ? previous.record.createdAt : new Date().toISOString(),
      scope: structuredClone(this.scope),
      reason: reuse
        ? previous.record.reason
        : restoring
          ? 'restore'
          : move
            ? 'move'
            : this.last
              ? document.origin === 'code'
                ? 'code'
                : 'blocks'
              : 'initial',
      documentRevision: document.identity.documentRevision,
      authority: document.authoritativeDraft.kind,
      codeText: document.codeDraft,
      workspaceJson,
      inputJson,
      state: status,
      restoredFrom: reuse ? previous.record.restoredFrom : restoring,
    };
    const { sequence: ignored, ...record } = state;
    void ignored;
    try {
      assertEditorSnapshot(record, true);
    } catch {
      this.publish({
        status: 'unsaved',
        message: '本次历史超过容量，完整当前草稿仍保留在工作区。',
      });
      return;
    }
    if (
      reuse &&
      this.last?.content === content &&
      previous.record.state === status &&
      previous.record.documentRevision === state.documentRevision
    )
      return;
    const unsaved = [...this.bank.values()].filter(
      (item) => !item.saved && item.record.entryId !== state.entryId,
    );
    const pendingBytes =
      unsaved.reduce((sum, item) => sum + historyBytes(item.record), 0) + historyBytes(state);
    if (unsaved.length >= 100 || pendingBytes > EDIT_HISTORY_LIMITS.bytes) {
      this.publish({
        status: 'unsaved',
        message: '未保存历史已达100条或8 MiB，当前草稿仍在；请恢复存储后重试。',
      });
      return;
    }
    this.restoredFrom = null;
    this.bank.set(state.entryId, { record: state, saved: false });
    this.order.set(state.entryId, ++this.ordinal);
    this.last = { id: state.entryId, editId: document.identity.editId, content };
    if (context) {
      const old = this.pending.get(state.entryId);
      this.pending.set(state.entryId, {
        context,
        record: state,
        updateOnly: old?.updateOnly ?? (reuse ? previous.saved : false),
      });
    }
    // The disk plus the bounded unsaved queue are the only retained copies.
    const keep = [...this.bank.values()]
      .filter((item) => item.saved)
      .sort((a, b) => b.record.sequence - a.record.sequence);
    for (const item of keep.slice(100)) {
      this.bank.delete(item.record.entryId);
      this.order.delete(item.record.entryId);
    }
    this.publish({
      status: context ? (this.blocked ? 'unsaved' : 'saving') : 'unavailable',
      message: context
        ? this.blocked
          ? this.state.message
          : ''
        : '本地存储不可用，历史仅在本次页面中保留，刷新会丢失。',
    });
    void this.pump();
  }
  async reload() {
    const context = this.port?.context(),
      token = ++this.reading,
      lease = this.lease;
    if (!context) {
      this.publish({ status: 'unavailable', message: '本地存储暂不可用，尚未保存编辑历史。' });
      return;
    }
    this.publish({ status: 'loading' });
    try {
      const records = await this.port!.read(context);
      if (token !== this.reading || lease !== this.lease) return;
      for (const [id, item] of this.bank)
        if (item.saved && !this.pending.has(id)) {
          this.bank.delete(id);
          this.order.delete(id);
        }
      for (const record of records)
        if (!this.pending.has(record.entryId))
          this.bank.set(record.entryId, { record, saved: true });
      this.publish({
        status: this.pending.size ? 'unsaved' : 'ready',
        message: this.pending.size ? '还有编辑历史未保存。' : '',
      });
    } catch (error) {
      if (token === this.reading && lease === this.lease) this.failure(error);
    }
  }
  async retry() {
    this.blocked = false;
    await this.pump();
    if (!this.pending.size) await this.reload();
  }
  private failure(error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    this.publish({
      status: 'unsaved',
      message:
        code === 'S_QUOTA'
          ? '浏览器空间不足，编辑历史未保存；当前草稿和原历史仍保留。'
          : code === 'S_RECORD_INVALID'
            ? '编辑历史含损坏记录或档案不可写，原记录未改动，当前草稿仍保留。'
            : code === 'S_GENERATION_STALE'
              ? '本地档案已变化，旧历史保存已失效。'
              : '编辑历史未能保存或读取，可恢复存储后重试；当前草稿仍保留。',
    });
  }
  private async pump() {
    if (this.pumping || this.paused || this.blocked || !this.port || !this.pending.size) return;
    this.pumping = true;
    const lease = this.lease;
    try {
      while (this.pending.size && !this.paused && !this.blocked && lease === this.lease) {
        const pending = this.pending.values().next().value!;
        const sending = structuredClone(pending);
        const { sequence: ignored, ...record } = sending.record;
        void ignored;
        try {
          const result = await this.port.save(sending.context, record, sending.updateOnly);
          if (lease !== this.lease) return;
          const latest = this.pending.get(record.entryId);
          if (result.record && latest && latest.record.captureVersion > record.captureVersion) {
            latest.updateOnly = true;
            latest.record.sequence = result.record.sequence;
          } else {
            this.pending.delete(record.entryId);
            if (result.record)
              this.bank.set(record.entryId, { record: result.record, saved: true });
            else this.bank.delete(record.entryId);
          }
          this.publish({
            status: this.pending.size ? 'saving' : 'ready',
            pruned: this.state.pruned + result.pruned,
            message: '',
          });
        } catch (error) {
          if (lease === this.lease) {
            this.blocked = true;
            this.failure(error);
          }
          break;
        }
      }
    } finally {
      this.pumping = false;
      if (lease !== this.lease) void this.pump();
    }
    if (!this.pending.size && this.scope && !this.paused) await this.reload();
  }
}
