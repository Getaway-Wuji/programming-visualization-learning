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
import {
  EditDocumentController,
  type AnalysisPort,
  type EditDocumentSnapshot,
} from './edit-document';
import type { ByteRange } from '../engine/protocol';
import { lockedProgramKinds, type BlockAccess } from '../blocks/permissions';
import { EditorHistoryController, editorHistoryInput, type EditorHistoryPort } from './history';
import { sameEditorScope, type EditorScope } from '../storage/editor-history';
import { reconstructionQuestion, reconstructionReference } from './reconstruction';

export type PracticeMode = 'independent' | 'correction' | 'reconstruction';
export interface PracticeSnapshot {
  reconstructionSource?: string;
  editDocument?: EditDocumentSnapshot;
  codeEditing?: boolean;
  selectedBlockId?: string;
  selectedCodeRange?: ByteRange;
  selectionRevision?: number;
  commentsMoved?: boolean;
  editRejection?: string;
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
  'initialProgram' | 'workspaceProgram' | 'program' | 'draft' | 'issues' | 'source' | 'codeEditing'
>;
export interface PracticeLearningPort {
  context(): { catalog: LearningCatalog | null; epoch: number };
  save(fact: VerifiedFact, epoch: number): Promise<unknown>;
  access?(catalog: ExerciseCatalog): BlockAccess;
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
  readonly history: EditorHistoryController;
  private historyMove = false;
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
  private executionPending = 0;
  private base?: PreparedSource;
  private loading?: AbortController;
  private drafts: Partial<Record<PracticeMode, PracticeDraft>> = {};
  private documents: Partial<Record<PracticeMode, EditDocumentController>> = {};
  constructor(
    private readonly client: Pick<
      ExecutionClient,
      'prepare' | 'execute' | 'invalidate' | 'cancel' | 'checkDeadline'
    > = executionClient,
    private readonly load = loadCoursePractice,
    private readonly present: (action: () => void) => void = (action) => action(),
    private readonly learning?: PracticeLearningPort,
    private readonly analyzer?: AnalysisPort,
    private readonly historyPort?: EditorHistoryPort,
  ) {
    this.history = new EditorHistoryController(historyPort);
  }
  readonly getSnapshot = () => this.current;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(patch: Partial<PracticeSnapshot>) {
    this.current = { ...this.current, ...patch };
    this.pauseHistory();
    for (const listener of this.listeners) listener();
  }
  private pauseHistory() {
    this.history.pause(
      this.executionPending > 0 || ['running', 'preparing'].includes(this.current.phase),
    );
  }
  private permitted(program: BlockProgram): boolean {
    const catalog = this.current.catalog;
    if (
      this.current.mode === 'reconstruction' &&
      (!catalog ||
        !reconstructionQuestion(catalog) ||
        this.current.editDocument?.authoritativeDraft.kind !== 'blocks')
    ) {
      this.set({ message: '拆积木练习需要用当前积木解答，请检查工作区后重新提交。' });
      return false;
    }
    const access = catalog && this.learning?.access?.(catalog);
    if (!access) return true; // Headless adapters without a learning store remain independent.
    if (access.available && lockedProgramKinds(program, access, this.current.draft).length === 0)
      return true;
    this.set({ message: '当前程序含未解锁积木或课程权限尚未就绪；草稿已保留，请查看积木权限。' });
    return false;
  }
  close(message = '') {
    if (!this.current.exerciseId) return;
    this.history.leave(Boolean(message));
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
    for (const document of Object.values(this.documents)) document.dispose();
    this.documents = {};
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
  enter(id: string | undefined, review = false, mode?: PracticeMode) {
    if (!id) {
      this.close();
      return;
    }
    if (this.current.exerciseId === id && this.current.phase !== 'empty') {
      if (mode && !review) this.switchMode(mode);
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
        const question = reconstructionQuestion(catalog);
        this.set({
          mode: mode === 'reconstruction' && question ? mode : 'independent',
          reconstructionSource: question ? reconstructionReference(catalog, base).text : undefined,
        });
        this.history.activate(this.editorScope(catalog, this.current.mode));
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
    const mode = this.current.mode;
    this.close();
    this.enter(id, false, mode);
  }
  switchMode(mode: PracticeMode) {
    const { catalog, exerciseId } = this.current;
    if (
      !catalog ||
      !exerciseId ||
      mode === this.current.mode ||
      !['independent', 'correction', 'reconstruction'].includes(mode) ||
      (mode === 'reconstruction' && !reconstructionQuestion(catalog))
    )
      return;
    const { initialProgram, workspaceProgram, program, draft, issues, source, codeEditing } =
      this.current;
    this.drafts[this.current.mode] = structuredClone({
      initialProgram,
      workspaceProgram,
      program,
      draft,
      issues,
      source,
      codeEditing,
    });
    ++this.token;
    ++this.revision;
    this.documents[this.current.mode]?.cancel();
    this.client.invalidate();
    this.player.invalidate();
    this.history.activate(this.editorScope(catalog, mode));
    let next = this.drafts[mode];
    if (!next) {
      const initial =
        mode !== 'correction'
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
      editDocument: undefined,
      codeEditing: next.codeEditing ?? false,
      editRejection: undefined,
      selectedBlockId: undefined,
      selectedCodeRange: undefined,
    });
    if (this.documents[mode]) {
      this.documents[mode].resume();
    }
  }
  private documentChanged = (document: EditDocumentController) => {
    if (this.documents[this.current.mode] !== document) return;
    const editDocument = document.getSnapshot();
    const projection = document.getProjection();
    const ready = document.ready();
    this.set({
      editDocument,
      draft: document.getDraft(),
      ...(!this.current.result
        ? {
            source: ready ? projection?.source : undefined,
            caseKey: ready ? this.current.catalog?.subject.tests[0].caseKey : undefined,
          }
        : {}),
      program: ready ? projection?.program : undefined,
      ...(ready
        ? { workspaceProgram: projection?.program, draft: document.getDraft(), issues: [] }
        : {}),
      commentsMoved: document.commentsMoved,
    });
    this.history.capture(editDocument, document.getDraft(), this.historyMove);
    this.historyMove = false;
  };
  private editorScope(catalog: ExerciseCatalog, mode: PracticeMode): EditorScope {
    return {
      packageRef: catalog.packageRef,
      exerciseRef: { id: catalog.subject.id, version: catalog.subject.version },
      programRef: { id: catalog.program.id, version: catalog.program.version },
      mode,
    };
  }
  recordWorkspaceDraft(draft: BlockWorkspaceDraft, logicalMove = false) {
    if (!this.current.catalog) return;
    const document = this.documents[this.current.mode];
    if (!document) {
      if (!this.current.draft) this.set({ draft });
      return;
    }
    if (JSON.stringify(draft) === JSON.stringify(document.getDraft())) return;
    this.historyMove = logicalMove;
    document.updateWorkspacePresentation(draft);
  }
  async restoreHistory(entryId: string) {
    const { catalog, mode } = this.current,
      document = this.documents[mode];
    const record = this.history.find(entryId);
    if (
      !catalog ||
      !record ||
      !document ||
      !sameEditorScope(record.scope, this.editorScope(catalog, mode))
    )
      return;
    const context = this.historyPort?.context();
    if (
      (context && record.generation !== context.generation) ||
      (mode === 'reconstruction' && record.authority !== 'blocks') ||
      record.inputJson !== editorHistoryInput(document.getSnapshot().input)
    ) {
      this.set({ message: '此历史版本不属于当前档案或输入，当前草稿已保留。' });
      return;
    }
    const token = ++this.token;
    ++this.revision;
    this.client.invalidate();
    this.player.invalidate();
    document.cancel();
    this.set({
      phase: 'preparing',
      action: null,
      result: undefined,
      source: undefined,
      program: undefined,
      summaries: [],
      saveStatus: 'idle',
      message: '正在恢复历史并重新检查……',
      selectedBlockId: undefined,
      selectedCodeRange: undefined,
    });
    try {
      const { parseHistoryWorkspace, inspectHistoryWorkspace } =
        await import('../blocks/history-workspace');
      const draft = parseHistoryWorkspace(record.workspaceJson);
      const read = inspectHistoryWorkspace(draft, catalog.program.bindings);
      const base = await this.client.prepare(catalog, catalog.subject.tests[0].input);
      if (this.token !== token || this.current.mode !== mode) return;
      let canonical: PreparedSource | undefined;
      if (read.program && read.issues.length === 0) {
        try {
          canonical = generateBlockSource(read.program, base, catalog.program.bindings);
        } catch {
          /* Keep invalid native draft; never authorize historical code. */
        }
      }
      this.base = base;
      this.set({
        phase: 'ready',
        draft,
        workspaceProgram: read.program ?? read.fallback,
        modeRevision: this.current.modeRevision + 1,
        issues: read.issues,
        message: '已恢复历史；旧运行已清除，请检查后重新运行。',
      });
      this.history.markRestore(record.entryId);
      document.restore(
        record.codeText,
        record.authority,
        draft,
        canonical ? read.program : null,
        canonical,
      );
      await document.wait();
    } catch {
      if (this.token !== token) return;
      this.set({ phase: 'ready', message: '此版本未能恢复，当前草稿已保留，旧运行已清除。' });
      await document.retry();
    }
  }
  async enableCodeEditing(visible = true) {
    const { catalog, program, source, mode } = this.current;
    if (mode === 'reconstruction') visible = false;
    if (this.documents[mode]) {
      if (visible) this.set({ codeEditing: true });
      return;
    }
    if (!catalog || !program || !source || this.current.issues.length) return;
    // A code-first lesson has no mounted SVG canvas. Serialize its checked IR
    // through the same Blockly adapter, then reject a late import after editing/leaving.
    let draft = this.current.draft;
    if (!draft) {
      const token = this.token;
      const { draftFromBlockProgram } = await import('../blocks/workspace');
      if (this.token !== token || this.current.mode !== mode || this.current.program !== program)
        return;
      if (this.documents[mode]) {
        if (visible) this.set({ codeEditing: true });
        return;
      }
      draft = draftFromBlockProgram(program);
      this.set({ draft });
    }
    this.documents[mode] = new EditDocumentController(
      catalog,
      () => ({ contextId: this.contextId, contextRevision: this.revision }),
      program,
      generateBlockSource(program, this.base!, catalog.program.bindings),
      draft,
      this.documentChanged,
      this.analyzer,
    );
    this.set({ codeEditing: visible || this.current.codeEditing === true });
    this.documentChanged(this.documents[mode]);
    await this.documents[mode].wait();
  }
  setCodeEditing(visible: boolean) {
    if (this.current.mode === 'reconstruction' && visible) return;
    this.set({ codeEditing: visible });
  }
  editCode(text: string, changedRange?: ByteRange) {
    if (this.current.mode === 'reconstruction') return;
    const document = this.documents[this.current.mode];
    if (!document || text === document.getSnapshot().codeDraft) return;
    const bytes = new TextEncoder().encode(text);
    if (
      bytes.byteLength > 32768 ||
      new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== text
    ) {
      this.set({
        editRejection:
          bytes.byteLength > 32768
            ? '本次输入超过 32 KiB，未接受这次修改；修改前的完整草稿已保留。'
            : '本次输入含不完整的 Unicode 字符，未接受这次修改；修改前的完整草稿已保留。',
      });
      return;
    }
    ++this.token;
    ++this.revision;
    this.client.invalidate();
    this.player.invalidate();
    this.set({
      action: null,
      phase: 'ready',
      result: undefined,
      summaries: [],
      saveStatus: 'idle',
      selectedBlockId: undefined,
      selectedCodeRange: undefined,
      message: '',
      editRejection: undefined,
    });
    document.editCode(text, changedRange);
  }
  retryAnalysis() {
    return this.documents[this.current.mode]?.retry();
  }
  selectBlock(blockId: string | null) {
    const document = this.documents[this.current.mode];
    if (!document?.ready()) return;
    const selected = document
      .getProjection()
      ?.source.blockMap.find((entry) => entry.blockId === blockId);
    this.set({
      selectedBlockId: selected?.blockId,
      selectedCodeRange: selected?.byteRange,
      selectionRevision: (this.current.selectionRevision ?? 0) + 1,
    });
  }
  selectCode(range: ByteRange) {
    const document = this.documents[this.current.mode];
    if (!document?.ready()) return;
    const projection = document.getProjection()!;
    // Whitespace/comment-only selections do not select their enclosing control.
    let covered = range.start;
    const triviaOnly = projection.analysis.trivia.some(({ byteRange }) => {
      if (range.start === range.end)
        return byteRange.start <= range.start && range.start < byteRange.end;
      if (byteRange.start <= covered && byteRange.end > covered) covered = byteRange.end;
      return covered >= range.end;
    });
    const matches = triviaOnly
      ? []
      : projection.source.blockMap.filter(
          (entry) =>
            entry.byteRange.start <= range.start &&
            entry.byteRange.end >= range.end &&
            (range.start !== range.end || range.start < entry.byteRange.end),
        );
    matches.sort(
      (a, b) => a.byteRange.end - a.byteRange.start - (b.byteRange.end - b.byteRange.start),
    );
    this.set({ selectedBlockId: matches[0]?.blockId, selectedCodeRange: undefined });
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
    this.documents[this.current.mode]?.editBlocks(program, source, draft);
  }
  async preview() {
    const document = this.documents[this.current.mode];
    if (document) {
      const token = this.token;
      await document.retry();
      if (this.token === token && document.ready() && this.current.phase !== 'met')
        this.set({ phase: 'ready' });
      return;
    }
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
    const document = this.documents[this.current.mode];
    if (
      !['running', 'preparing'].includes(this.current.phase) &&
      !document?.getSnapshot().analysisPending
    )
      return;
    ++this.token;
    ++this.revision;
    this.client.cancel();
    document?.cancel(true);
    this.player.invalidate();
    let source: PreparedSource | undefined = document?.ready()
      ? document.getProjection()?.source
      : undefined;
    if (!document && this.base && this.current.program && this.current.catalog) {
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
      ['running', 'preparing'].includes(this.current.phase) ||
      (this.documents[this.current.mode] && !this.documents[this.current.mode]?.ready())
    )
      return;
    if (!this.permitted(program)) return;
    const selected = structuredClone(program);
    const token = ++this.token;
    ++this.executionPending;
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
      const source = this.documents[this.current.mode]
        ? await this.documents[this.current.mode]!.prepareForTest(base, test.input, started)
        : generateBlockSource(selected, base, catalog.program.bindings);
      if (this.token !== token) return;
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
    } finally {
      --this.executionPending;
      this.pauseHistory();
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
      ['running', 'preparing'].includes(this.current.phase) ||
      (this.documents[this.current.mode] && !this.documents[this.current.mode]?.ready())
    )
      return;
    if (!this.permitted(program)) return;
    const selected = structuredClone(program);
    const token = ++this.token;
    ++this.executionPending;
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
        if (index > 0) this.player.invalidate(); // Already invalidated before the first group.
        this.set({ source: undefined, result: undefined, caseKey: test.caseKey });
        const base =
          index === 0 ? this.base : await this.client.prepare(catalog, test.input, started);
        if (this.token !== token) return;
        const source = this.documents[this.current.mode]
          ? await this.documents[this.current.mode]!.prepareForTest(base, test.input, started)
          : generateBlockSource(selected, base, catalog.program.bindings);
        if (this.token !== token) return;
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
    } finally {
      --this.executionPending;
      this.pauseHistory();
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
