import { MemoryWorkspaceController } from '../memory/controller';
import { acceptedBugJudgement, bugRequest, MemoryBugClient } from './protocol';
import { createMemoryBugPassAuthority } from './authority';
import { MemoryBugHistory } from './history';
import type { MemoryBugQuestion } from './content';
import type { MemoryResult } from '../engine/memory-protocol';
import type { LearningCatalog } from '../learning/types';
import type { VerifiedFact } from '../learning/authority';
import type { EditorHistoryPort } from '../practice/history';
interface MemoryBugSummary {
  caseKey: string;
  met: boolean;
  code: string | null;
  checks: readonly { id: string; met: boolean }[];
}

export interface MemoryBugLearningPort {
  context(): { catalog: LearningCatalog | null; epoch: number };
  save(fact: VerifiedFact, epoch: number): Promise<unknown>;
  saveAttempt?(fact: VerifiedFact, epoch: number): Promise<unknown>;
}
export class MemoryBugSession {
  readonly view = new MemoryWorkspaceController();
  readonly history: MemoryBugHistory;
  private listeners = new Set<() => void>();
  private token = 0;
  private revision = 1;
  private results: MemoryResult[] = [];
  private current: {
    source: string;
    caseKey: string;
    phase: 'ready' | 'running' | 'ran' | 'unmet' | 'passed' | 'failed';
    summaries: readonly MemoryBugSummary[];
    save: 'idle' | 'saved' | 'unsaved' | 'unavailable';
    message: string;
    elapsedMs: number | null;
  };
  constructor(
    readonly question: MemoryBugQuestion,
    private readonly learning: MemoryBugLearningPort,
    history: EditorHistoryPort,
    private readonly client = new MemoryBugClient(),
  ) {
    this.current = {
      source: question.brokenSource,
      caseKey: question.tests[0].caseKey,
      phase: 'ready',
      summaries: [],
      save: 'idle',
      message: '',
      elapsedMs: null,
    };
    this.history = new MemoryBugHistory(question, history);
  }
  readonly getSnapshot = () => this.current;
  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private set(patch: Partial<typeof this.current>) {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  invalidate() {
    ++this.token;
    this.client.invalidate();
    this.view.invalidate();
    this.results = [];
    this.set({ phase: 'ready', summaries: [], save: 'idle', message: '', elapsedMs: null });
  }
  edit(source: string) {
    if (source === this.current.source) return;
    if (
      new TextEncoder().encode(source).length > 32768 ||
      new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(source)) !== source
    ) {
      this.set({ message: '源码超过32KiB或含不完整字符，已保留编辑前原文。' });
      return;
    }
    this.invalidate();
    this.revision++;
    this.set({ source });
    this.history.capture(source, this.current.caseKey, 'code', this.revision);
  }
  selectCase(caseKey: string) {
    if (!this.question.tests.some((t) => t.caseKey === caseKey) || caseKey === this.current.caseKey)
      return;
    this.invalidate();
    this.set({ caseKey });
    this.revision++;
    this.history.capture(this.current.source, caseKey, 'code', this.revision);
  }
  async startHistory() {
    await this.history.reload();
    this.history.capture(this.current.source, this.current.caseKey, 'initial', this.revision);
  }
  restore(id: string) {
    const selected = this.history.restoreCandidate(id);
    if (!selected) {
      this.set({ message: '此历史不属于当前关卡或档案，当前原文保留。' });
      return;
    }
    this.invalidate();
    this.revision++;
    this.set({
      source: selected.row.codeText,
      caseKey: selected.caseKey,
      message: '已恢复原文与输入；旧运行已清除，请重新运行检查。',
    });
    this.history.capture(
      this.current.source,
      this.current.caseKey,
      'restore',
      this.revision,
      selected.row.entryId,
    );
  }
  async run(submit = false) {
    this.invalidate();
    const token = this.token,
      source = this.current.source,
      revision = String(this.revision),
      context = this.learning.context(),
      started = performance.now();
    this.set({ phase: 'running' });
    const tests = submit
        ? this.question.tests
        : this.question.tests.filter((t) => t.caseKey === this.current.caseKey),
      summaries: MemoryBugSummary[] = [];
    try {
      for (const test of tests) {
        const result = await this.client.execute(
          bugRequest(this.question, source, test.caseKey, revision),
          started,
        );
        if (token !== this.token) return;
        const verdict = acceptedBugJudgement(result);
        if (!verdict) throw new Error('E_PROTOCOL_INVALID');
        this.results.push(result);
        summaries.push({
          caseKey: test.caseKey,
          met: verdict.status === 'met',
          code: result.terminal.code,
          checks: verdict.checks,
        });
        this.view.showResult(source, result);
        if (performance.now() - started >= 1000) throw new Error('E_DEADLINE');
        this.set({ summaries: [...summaries], elapsedMs: performance.now() - started });
        if (verdict.status !== 'met') {
          this.set({ phase: 'unmet', message: '本组尚未满足；可查看实际诊断，有轨迹时可复盘。' });
          if (submit && context.catalog && this.learning.saveAttempt) {
            const fact = createMemoryAttemptFact(
              context.catalog,
              this.question.exerciseRef.id,
              result,
              () => this.token === token && this.current.phase === 'unmet',
            );
            if (fact) {
              try {
                await this.learning.saveAttempt(fact, context.epoch);
                if (this.token === token) this.set({ save: 'saved' });
              } catch {
                if (this.token === token) this.set({ save: 'unsaved' });
              }
            }
          }
          return;
        }
      }
      if (performance.now() - started >= 1000) throw new Error('E_DEADLINE');
      if (!submit) {
        this.set({ phase: 'ran', message: '本组满足；运行本组不保存通过或积分。' });
        return;
      }
      this.set({ phase: 'passed' });
      if (!context.catalog) {
        this.set({ save: 'unavailable', message: '正式学习授权尚未就绪，本次未保存。' });
        return;
      }
      const authority = createMemoryBugPassAuthority(context.catalog, () => ({
        exerciseId: this.question.exerciseRef.id,
        results: this.results,
        current: token === this.token && this.current.phase === 'passed',
      }));
      try {
        await this.learning.save(authority.issue(), context.epoch);
        if (token === this.token) this.set({ save: 'saved' });
      } catch {
        if (token === this.token)
          this.set({
            save: 'unsaved',
            message: '通过尚未保存；请重试未保存操作，重复运行不会多发奖励。',
          });
      }
    } catch (error) {
      if (token !== this.token) return;
      this.view.invalidate();
      this.results = [];
      this.set({
        phase: 'failed',
        message: error instanceof Error ? error.message : 'E_WORKER_FAILURE',
      });
    }
  }
  cancel() {
    this.invalidate();
    this.set({ message: '已取消，未接收残余运行。' });
  }
}
import { createMemoryAttemptFact } from '../learning/attempt-authority';
