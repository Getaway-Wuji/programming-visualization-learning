import type { EditorHistoryPort } from '../practice/history';
import {
  sameEditorScope,
  type EditorSnapshot,
  type EditorSnapshotDraft,
  type EditorScope,
} from '../storage/editor-history';
import { memoryBugRegistry, type MemoryBugQuestion } from './content';

export const emptyMemoryWorkspace = '{"blocks":{"languageVersion":0,"blocks":[]}}';
export class MemoryBugHistory {
  private listeners = new Set<() => void>();
  private bank: EditorSnapshot[] = [];
  private pending: EditorSnapshotDraft[] = [];
  private writing = false;
  private generation = '';
  private sequence = 0;
  private writer = crypto.randomUUID();
  private state: {
    status: 'loading' | 'ready' | 'saving' | 'unsaved' | 'unavailable';
    items: readonly EditorSnapshot[];
    message: string;
  } = { status: 'loading', items: [], message: '' };
  readonly scope: EditorScope;
  constructor(
    readonly question: MemoryBugQuestion,
    private readonly port: EditorHistoryPort,
  ) {
    this.scope = {
      packageRef: memoryBugRegistry.packageRef,
      exerciseRef: question.exerciseRef,
      programRef: question.programRef,
      mode: 'correction',
    };
  }
  readonly getSnapshot = () => this.state;
  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(status = this.state.status, message = '') {
    this.state = { status, items: [...this.bank].sort((a, b) => b.sequence - a.sequence), message };
    this.listeners.forEach((fn) => fn());
  }
  private context() {
    const ctx = this.port.context();
    if (ctx && ctx.generation !== this.generation) {
      this.generation = ctx.generation;
      this.pending = [];
      this.bank = [];
    }
    return ctx;
  }
  async reload() {
    const ctx = this.context();
    if (!ctx) {
      this.publish('unavailable', '编辑历史尚未保存。');
      return;
    }
    try {
      const rows = await this.port.read(ctx);
      if (this.context()?.generation !== ctx.generation) return;
      this.bank = rows.filter((r) => sameEditorScope(r.scope, this.scope));
      this.publish(this.pending.length ? 'unsaved' : 'ready');
    } catch {
      this.publish('unsaved', '编辑历史读取失败，当前原文保留。');
    }
  }
  capture(
    codeText: string,
    caseKey: string,
    reason: 'initial' | 'code' | 'restore',
    revision: number,
    restoredFrom: string | null = null,
  ) {
    const ctx = this.context(),
      test = this.question.tests.find((t) => t.caseKey === caseKey);
    if (!ctx || !test) {
      this.publish('unavailable', '当前原文尚未保存，刷新可能丢失。');
      return;
    }
    const record: EditorSnapshotDraft = {
      historyVersion: '1.0.0',
      entryId: crypto.randomUUID(),
      writerId: this.writer,
      generation: ctx.generation,
      captureVersion: ++this.sequence,
      createdAt: new Date().toISOString(),
      scope: this.scope,
      reason,
      documentRevision: revision,
      authority: 'code',
      codeText,
      workspaceJson: emptyMemoryWorkspace,
      inputJson: JSON.stringify({ caseKey, input: test.input }),
      state: 'unmapped',
      restoredFrom,
    };
    this.pending.push(record);
    void this.retry();
  }
  async retry() {
    if (this.writing) return;
    const ctx = this.context();
    if (!ctx) {
      this.publish('unavailable');
      return;
    }
    this.writing = true;
    this.publish('saving');
    try {
      while (this.pending.length) {
        const draft = this.pending[0];
        if (draft.generation !== ctx.generation) break;
        const saved = await this.port.save(ctx, draft, false);
        if (this.context()?.generation !== ctx.generation) return;
        this.pending.shift();
        if (saved.record)
          this.bank = [
            saved.record,
            ...this.bank.filter((r) => r.entryId !== saved.record!.entryId),
          ]
            .sort((a, b) => b.sequence - a.sequence)
            .slice(0, 100);
      }
      await this.reload();
    } catch {
      this.publish('unsaved', '编辑历史尚未保存；可重试，当前原文保留。');
    } finally {
      this.writing = false;
    }
  }
  restoreCandidate(id: string) {
    const row = this.bank.find((r) => r.entryId === id),
      ctx = this.context();
    if (
      !row ||
      row.generation !== ctx?.generation ||
      !sameEditorScope(row.scope, this.scope) ||
      row.authority !== 'code' ||
      row.workspaceJson !== emptyMemoryWorkspace
    )
      return null;
    try {
      const input = JSON.parse(row.inputJson) as { caseKey: string; input: unknown };
      const test = this.question.tests.find((t) => t.caseKey === input.caseKey);
      return test && JSON.stringify(input.input) === JSON.stringify(test.input)
        ? { row, caseKey: test.caseKey }
        : null;
    } catch {
      return null;
    }
  }
}
