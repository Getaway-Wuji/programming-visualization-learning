import {
  executionClient,
  type ExecutionClient,
  type PreparedSource,
} from '../engine/execution-client';
import type { ExecuteResult } from '../engine/protocol';
import { loadCoursePractice, exerciseCatalog, type ExerciseCatalog } from '../content/practice';
import { PlayerController } from '../player/controller';
import type { BlockProgram } from '../blocks/model';
import type { BlockWorkspaceDraft, WorkspaceIssue } from '../blocks/workspace';
import { generateBlockSource, BlockGenerationError } from '../blocks/generator';
import { starterProgram, correctionProgram } from '../blocks/starters';
import { createPracticePassAuthority } from '../learning/practice-authority';
import type { VerifiedFact } from '../learning/authority';
import type { LearningCatalog } from '../learning/types';
import { exerciseRequest, caseSummary, submissionMet, type CaseSummary } from './submission';

export type PracticeMode = 'independent' | 'correction';
export interface PracticeSnapshot {
  mode: PracticeMode;
  modeRevision: number;
  action: 'run' | 'submit' | null;
  exerciseId?: string;
  catalog?: ExerciseCatalog;
  initialProgram?: BlockProgram;
  workspaceProgram?: BlockProgram;
  program?: BlockProgram;
  draft?: BlockWorkspaceDraft;
  issues: readonly WorkspaceIssue[];
  saveStatus: 'idle' | 'saving' | 'saved' | 'unsaved' | 'unavailable';
  phase:
    | 'empty'
    | 'loading'
    | 'ready'
    | 'preparing'
    | 'running'
    | 'ran'
    | 'met'
    | 'unmet'
    | 'failed'
    | 'cancelled';
  source?: PreparedSource;
  result?: ExecuteResult;
  caseKey?: string;
  summaries: readonly CaseSummary[];
  message: string;
}
type PracticeDraft = Pick<
  PracticeSnapshot,
  'initialProgram' | 'workspaceProgram' | 'program' | 'draft' | 'issues' | 'source'
>;
export interface PracticeLearningPort {
  context(): { catalog: LearningCatalog | null; epoch: number };
  save(fact: VerifiedFact, epoch: number): Promise<unknown>;
}
const blockMessages: Record<string, string> = {
  BLOCK_SHAPE: '积木结构或插槽不完整，请检查标记的积木。',
  BLOCK_LIMIT: '积木结构超过工作区容量，请减少嵌套或积木数量。',
  BLOCK_ID: '积木标识重复或无效，请重新搭建该积木。',
  BLOCK_NAME: '变量名应使用合法的 C 名称，不能使用关键字。',
  BLOCK_REFERENCE: '这个变量或数组在当前位置尚未声明，或类型不匹配。',
  BLOCK_DUPLICATE: '同一作用域中已有这个变量名，请修改声明。',
  BLOCK_INTEGER: '整数、数组长度或初始化列表不符合当前积木要求。',
  BLOCK_FORMAT: '输出格式只支持 %d、%% 和约定的转义，参数数量必须对应。',
  BLOCK_LOOP: 'break 和 continue 必须放在循环内部。',
  BLOCK_INPUT: '本题输入源已缺失、重复或被改动，请保留题目对应的输入声明。',
  BLOCK_PREPARATION: '本组输入声明尚未准备成功，请重新准备代码。',
  BLOCK_SOURCE_LIMIT: '生成代码超过 32 KiB，请减少积木内容。',
};
function blockIssue(error: unknown): WorkspaceIssue {
  return error instanceof BlockGenerationError
    ? { code: error.code, blockId: error.blockId, message: blockMessages[error.code] }
    : { code: 'BLOCK_SHAPE', blockId: null, message: blockMessages.BLOCK_SHAPE };
}
/** One ephemeral submission, shared only across the same exercise/review route pair. */
export class PracticeSession {
  readonly player = new PlayerController();
  private current: PracticeSnapshot = {
    mode: 'independent',
    modeRevision: 0,
    action: null,
    issues: [],
    saveStatus: 'idle',
    phase: 'empty',
    summaries: [],
    message: '',
  };
  private listeners = new Set<() => void>();
  private token = 0;
  private contextId = crypto.randomUUID();
  private revision = 1;
  private sourceRevision = 0;
  private base?: PreparedSource;
  private loading?: AbortController;
  private drafts: Partial<Record<PracticeMode, PracticeDraft>> = {};
  constructor(
    private readonly client: Pick<
      ExecutionClient,
      'prepare' | 'execute' | 'invalidate' | 'cancel' | 'checkDeadline'
    > = executionClient,
    private readonly load = loadCoursePractice,
    private readonly present: (action: () => void) => void = (action) => action(),
    private readonly learning?: PracticeLearningPort,
  ) {}
  readonly getSnapshot = () => this.current;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(patch: Partial<PracticeSnapshot>) {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) listener();
  }
  close(message = '') {
    if (!this.current.exerciseId) return;
    ++this.token;
    ++this.revision;
    this.loading?.abort();
    this.loading = undefined;
    this.client.invalidate();
    this.player.invalidate();
    this.base = undefined;
    this.contextId = crypto.randomUUID();
    this.sourceRevision = 0;
    this.drafts = {};
    this.current = {
      mode: 'independent',
      modeRevision: this.current.modeRevision + 1,
      action: null,
      issues: [],
      saveStatus: 'idle',
      phase: 'empty',
      summaries: [],
      message,
    };
    for (const listener of this.listeners) listener();
  }
  enter(id: string | undefined, review = false) {
    if (!id) {
      this.close();
      return;
    }
    if (this.current.exerciseId === id && this.current.phase !== 'empty') {
      if (review && ['running', 'preparing'].includes(this.current.phase)) this.cancel();
      this.player.pause();
      return;
    }
    this.close();
    if (review) {
      this.set({ exerciseId: id, phase: 'empty' });
      return;
    }
    const token = ++this.token;
    this.loading = new AbortController();
    this.set({ exerciseId: id, phase: 'loading', message: '' });
    void this.load(this.loading.signal)
      .then(async (content) => {
        if (this.token !== token) return;
        const catalog = exerciseCatalog(content, id);
        const program = starterProgram(id, catalog.program.bindings);
        const base = await this.client.prepare(catalog, catalog.subject.tests[0].input);
        if (this.token !== token) return;
        const source = generateBlockSource(program, base, catalog.program.bindings);
        this.base = base;
        this.set({
          catalog,
          initialProgram: program,
          workspaceProgram: program,
          program,
          source,
          caseKey: catalog.subject.tests[0].caseKey,
          issues: [],
          phase: 'ready',
        });
      })
      .catch(() => {
        if (this.token === token)
          this.set({ phase: 'failed', message: '练习内容暂时不可用，请重试读取。' });
      });
  }
  reload() {
    const id = this.current.exerciseId;
    this.close();
    this.enter(id);
  }
  switchMode(mode: PracticeMode) {
    const { catalog, exerciseId } = this.current;
    if (
      !catalog ||
      !exerciseId ||
      mode === this.current.mode ||
      !['independent', 'correction'].includes(mode)
    )
      return;
    const { initialProgram, workspaceProgram, program, draft, issues, source } = this.current;
    this.drafts[this.current.mode] = structuredClone({
      initialProgram,
      workspaceProgram,
      program,
      draft,
      issues,
      source,
    });
    ++this.token;
    ++this.revision;
    this.client.invalidate();
    this.player.invalidate();
    let next = this.drafts[mode];
    if (!next) {
      const initial =
        mode === 'independent'
          ? starterProgram(exerciseId, catalog.program.bindings)
          : correctionProgram(exerciseId, catalog.program.bindings);
      next = {
        initialProgram: initial,
        workspaceProgram: initial,
        program: initial,
        draft: undefined,
        issues: [],
        source: undefined,
      };
    }
    // A retained display may belong to the last submitted test, or be empty
    // while preparing. Rebuild the valid draft against the first input rather
    // than assigning the first caseKey to a different test's source.
    const restoredSource =
      this.base && next.program && next.issues.length === 0
        ? generateBlockSource(next.program, this.base, catalog.program.bindings)
        : undefined;
    this.set({
      ...next,
      source: restoredSource,
      mode,
      modeRevision: this.current.modeRevision + 1,
      action: null,
      result: undefined,
      summaries: [],
      caseKey: restoredSource ? catalog.subject.tests[0].caseKey : undefined,
      phase: 'ready',
      saveStatus: 'idle',
      message: '',
    });
  }
  editBlocks(
    program: BlockProgram | null,
    issues: readonly WorkspaceIssue[],
    draft: BlockWorkspaceDraft,
  ) {
    const { catalog, exerciseId } = this.current;
    if (!catalog || !exerciseId) return;
    ++this.token;
    ++this.revision;
    this.client.invalidate();
    this.player.invalidate();
    const currentIssues = [...issues];
    let source: PreparedSource | undefined;
    let message = '';
    if (this.base && program && currentIssues.length === 0) {
      try {
        source = generateBlockSource(program, this.base, catalog.program.bindings);
      } catch (error) {
        const issue = blockIssue(error);
        currentIssues.push(issue);
        message = issue.message;
      }
    }
    this.set({
      program: program ?? undefined,
      workspaceProgram: program ?? this.current.workspaceProgram,
      draft,
      issues: currentIssues,
      action: null,
      saveStatus: 'idle',
      source,
      result: undefined,
      caseKey: source ? catalog.subject.tests[0].caseKey : undefined,
      summaries: [],
      phase: 'ready',
      message,
    });
  }
  async preview() {
    const { catalog, exerciseId, program } = this.current;
    if (!catalog || !exerciseId || !program) return;
    const token = ++this.token;
    this.client.invalidate();
    this.player.invalidate();
    this.set({
      phase: 'preparing',
      action: null,
      source: undefined,
      result: undefined,
      summaries: [],
      saveStatus: 'idle',
      message: '',
    });
    try {
      const prepared = await this.client.prepare(catalog, catalog.subject.tests[0].input);
      if (this.token !== token) return;
      this.base = prepared;
      const source = generateBlockSource(program, prepared, catalog.program.bindings);
      this.set({ source, issues: [], caseKey: catalog.subject.tests[0].caseKey, phase: 'ready' });
    } catch (error) {
      if (this.token === token)
        this.set({
          phase: 'failed',
          ...(error instanceof BlockGenerationError ? { issues: [blockIssue(error)] } : {}),
          message:
            error instanceof BlockGenerationError
              ? blockIssue(error).message
              : '代码准备未能完成，请检查积木后重试。',
        });
    }
  }
  cancel() {
    if (!['running', 'preparing'].includes(this.current.phase)) return;
    ++this.token;
    ++this.revision;
    this.client.cancel();
    this.player.invalidate();
    let source: PreparedSource | undefined;
    if (this.base && this.current.program && this.current.catalog) {
      try {
        source = generateBlockSource(
          this.current.program,
          this.base,
          this.current.catalog.program.bindings,
        );
      } catch {
        /* Keep invalid draft visible. */
      }
    }
    this.set({
      source,
      result: undefined,
      summaries: [],
      saveStatus: 'idle',
      caseKey: source ? this.current.catalog?.subject.tests[0].caseKey : undefined,
      phase: 'cancelled',
      message:
        this.current.action === 'run'
          ? '已取消本次运行；没有产生学习记录。'
          : '已取消本次提交；没有有效判定或学习记录。',
    });
  }
  async run() {
    const started = performance.now();
    const { catalog, exerciseId, program } = this.current;
    if (
      !catalog ||
      !exerciseId ||
      !this.base ||
      !this.current.source ||
      !program ||
      this.current.issues.length > 0 ||
      ['running', 'preparing'].includes(this.current.phase)
    )
      return;
    const selected = structuredClone(program);
    const token = ++this.token;
    const revision = this.revision;
    const test = catalog.subject.tests[0];
    this.player.invalidate();
    this.set({
      action: 'run',
      phase: 'preparing',
      source: undefined,
      result: undefined,
      summaries: [],
      saveStatus: 'idle',
      caseKey: test.caseKey,
      message: '',
    });
    try {
      const base = await this.client.prepare(catalog, test.input, started);
      if (this.token !== token) return;
      this.base = base;
      const source = generateBlockSource(selected, base, catalog.program.bindings);
      // The existing protocol accepts exercise inputs only as published test
      // cases. Running one group never authorizes a submission or learning fact.
      const request = exerciseRequest(
        catalog,
        source,
        {
          contextId: this.contextId,
          contextRevision: revision,
          sourceRevision: ++this.sourceRevision,
        },
        crypto.randomUUID(),
        test,
      );
      this.present(() => this.set({ source, phase: 'running' }));
      let playerToken = this.player.begin(request.identity);
      let displayed: ExecuteResult | undefined;
      const display = (result: ExecuteResult) => {
        if (this.token !== token || displayed === result) return;
        this.present(() => {
          if (displayed) playerToken = this.player.begin(request.identity);
          this.player.acceptValidated(playerToken, result);
          displayed = result;
          this.set({ source, result });
        });
      };
      const result = await this.client.execute(request, catalog, display, started);
      if (this.token !== token) return;
      display(result);
      const completed = result.producer === 'rust' && result.terminal.status === 'completed';
      this.set({
        phase: completed ? 'ran' : 'failed',
        message: completed
          ? '当前输入已运行结束；这不代表全部测试通过，也没有保存通过记录。'
          : '本次运行未正常完成，请查看诊断后重试；没有保存通过记录。',
      });
    } catch {
      if (this.token === token) {
        this.player.invalidate();
        this.set({
          source: undefined,
          result: undefined,
          phase: 'failed',
          message: '本次运行准备失败或超过时限，可以重试；没有保存通过记录。',
        });
      }
    }
  }
  async submit() {
    const started = performance.now();
    const { catalog, exerciseId, program } = this.current;
    if (
      !catalog ||
      !exerciseId ||
      !this.base ||
      !this.current.source ||
      !program ||
      this.current.issues.length > 0 ||
      ['running', 'preparing'].includes(this.current.phase)
    )
      return;
    const selected = structuredClone(program);
    const token = ++this.token;
    const submissionId = crypto.randomUUID();
    const revision = this.revision;
    let summaries: CaseSummary[] = [];
    this.player.invalidate();
    this.set({
      action: 'submit',
      phase: 'running',
      summaries: [],
      result: undefined,
      saveStatus: 'idle',
      message: '',
    });
    try {
      for (let index = 0; index < catalog.subject.tests.length; index++) {
        const test = catalog.subject.tests[index];
        this.player.invalidate();
        this.set({ source: undefined, result: undefined, caseKey: test.caseKey });
        const base =
          index === 0 ? this.base : await this.client.prepare(catalog, test.input, started);
        if (this.token !== token) return;
        const source = generateBlockSource(selected, base, catalog.program.bindings);
        const request = exerciseRequest(
          catalog,
          source,
          {
            contextId: this.contextId,
            contextRevision: revision,
            sourceRevision: ++this.sourceRevision,
          },
          submissionId,
          test,
        );
        this.present(() => this.set({ source }));
        let playerToken = this.player.begin(request.identity);
        let displayed: ExecuteResult | undefined;
        let summary: CaseSummary | undefined;
        const display = (result: ExecuteResult) => {
          if (this.token !== token || displayed === result) return;
          this.present(() => {
            if (displayed) playerToken = this.player.begin(request.identity);
            this.player.acceptValidated(playerToken, result);
            displayed = result;
            summary = caseSummary(request, result);
            const current = [...summaries, summary];
            const last = index === catalog.subject.tests.length - 1;
            const phase = !summary.met
              ? 'unmet'
              : last
                ? submissionMet(catalog, current)
                  ? 'met'
                  : 'unmet'
                : 'running';
            this.set({
              source,
              result,
              summaries: current,
              phase,
              message:
                result.terminal.status === 'completed'
                  ? ''
                  : '本组未正常完成，请查看诊断；本次提交没有通过。',
            });
          });
        };
        const result = await this.client.execute(request, catalog, display, started);
        display(result);
        if (this.token !== token) return;
        if (!summary?.met) return;
        if (index === catalog.subject.tests.length - 1) {
          // display runs before ExecutionClient's final render/deadline guard.
          // Only its final returned result may authorize a durable learning fact.
          if (this.current.phase === 'met' && submissionMet(catalog, this.current.summaries))
            await this.saveAccepted(token, revision, catalog);
          return;
        }
        summaries = this.current.summaries.slice();
      }
    } catch {
      if (this.token === token) {
        this.player.invalidate();
        this.set({
          source: undefined,
          result: undefined,
          phase: 'failed',
          message: '本次提交准备失败或超过时限，未作通过判定。可以重新提交。',
        });
      }
    }
  }
  private async saveAccepted(token: number, revision: number, catalog: ExerciseCatalog) {
    const context = this.learning?.context();
    if (!this.learning || !context?.catalog) {
      this.set({ saveStatus: 'unavailable' });
      return;
    }
    try {
      const authority = createPracticePassAuthority(context.catalog, () => ({
        catalog,
        summaries: this.current.summaries,
        current: this.token === token && this.revision === revision && this.current.phase === 'met',
      }));
      const fact = authority.issue();
      this.set({ saveStatus: 'saving' });
      // The learning service synchronously captures the accepted identity before
      // its first await. Later edits do not erase this genuine historical fact.
      await this.learning.save(fact, context.epoch);
      if (this.token === token) this.set({ saveStatus: 'saved' });
    } catch {
      if (this.token === token) this.set({ saveStatus: 'unsaved' });
    }
  }
  checkDeadline() {
    if (['running', 'preparing'].includes(this.current.phase)) this.client.checkDeadline();
  }
}
