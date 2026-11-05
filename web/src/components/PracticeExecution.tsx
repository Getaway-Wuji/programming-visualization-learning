import { Link } from 'react-router';
import { lazy, Suspense, useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { usePractice } from '../practice/react';
import { blocksAtLocation } from '../practice/block-location';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { paths } from '../navigation';
import { SourcePanel } from './SourcePanel';
import { BasicTraceView } from './BasicTraceView';
import { PlayerControls } from './PlayerControls';
import { Workbench, WorkspaceContext, type WorkbenchHandle } from '../workbench/Workbench';
import { PracticeGuidance } from './PracticeGuidance';
import { PracticeExamples } from './PracticeExamples';
import { LessonCompletion } from './LessonCompletion';
import { reviewedDurableSnapshot } from '../learning/reviewed-release';
import { resolveBlockAccess, lockedProgramKinds } from '../blocks/permissions';
import { BLOCK_LABELS } from '../blocks/block-kinds';
import { EditorHistory } from '../practice/EditorHistory';
import { reconstructionQuestion } from '../practice/reconstruction';
import { ReconstructionReference } from '../practice/ReconstructionPanel';
import { DiagnosticPanel } from '../diagnostics/DiagnosticPanel';
import { bugQuestion } from '../bugs/content';
import { BugGuidance } from '../bugs/BugPanel';
import type { ByteRange } from '../engine/protocol';
import { useBlockWorkspacePreference } from '../appearance/BlockWorkspacePreference';
import {
  loadTeachingPresentation,
  resolvePreferredEditor,
  type TeachingPresentationLoad,
} from '../content/teaching-presentation';
const BlockWorkspace = lazy(() =>
  import('../blocks/BlockWorkspace').then((module) => ({ default: module.BlockWorkspace })),
);
const DraftCodeEditor = lazy(() =>
  import('./DraftCodeEditor').then((module) => ({ default: module.DraftCodeEditor })),
);
const checkLabels: Record<string, string> = {
  'input-bindings': '输入声明与实际输入一致',
  'stdout-exact': '逐字输出符合预期',
  'exit-zero': '正常返回 0',
  'teaching-target': '符合本题教学目标',
  'while-accumulation': 'while 循环有效累加',
  'for-accumulation': 'for 循环有效累加',
};
const terminalLabels: Record<string, string> = {
  completed: '程序正常结束',
  'program-error': '程序发生错误',
  rejected: '输入或程序未通过检查',
  'resource-limit': '本次提交超过运行限制',
  cancelled: '本次提交已取消',
  'infrastructure-failure': '执行模块未能完成运行',
};
const teachingHelp: Record<string, string> = {
  'input-read-output': '输出必须来自本组输入 x 的实际读取，固定数值不能代替输入。',
  'multiply-add-output': '输入 x 必须有效参与乘法和加法；后续覆盖、相消或乘以 0 会消除已有贡献。',
  'if-else-paths': '条件应与输入 x 有关，全部测试需要实际覆盖同一 if/else 的两条输出路径。',
  'while-for-accumulations':
    '两个循环都要从 0 开始有效累加 1 到 n；n 为 0 时应迭代 0 次并输出两行 0。无关循环与公式替代不满足目标。',
  'single-index-increment':
    '需要实际读取并写回 values[k]，输出修改后的值；其他逻辑元素必须保持不变。',
  'logical-array-accumulation': '每个逻辑元素都要通过循环有效参与累加；空数组不能读取占位元素。',
};
export function PracticeExecution({ id, review = false }: { id: string; review?: boolean }) {
  const { session, state, player } = usePractice();
  useEffect(() => session.player.setDetail('key'), [session, id]);
  const traceVisible = useRef(true);
  const traceVisibility = useCallback(
    (visible: boolean) => {
      traceVisible.current = visible;
      if (!visible) session.player.pause();
    },
    [session],
  );
  const { state: learning, service } = useLearning();
  const preference = useBlockWorkspacePreference();
  const [presentation, setPresentation] = useState<TeachingPresentationLoad | null>(null);
  const active = state.exerciseId === id;
  const catalog = active ? state.catalog : undefined;
  const question = catalog ? reconstructionQuestion(catalog) : undefined;
  const bug = catalog ? bugQuestion(catalog) : undefined;
  const reconstructing = state.mode === 'reconstruction';
  const result = active ? state.result : undefined;
  const source = active ? state.source : undefined;
  const [diagnosticFocus, setDiagnosticFocus] = useState<{
    runId: string;
    range: ByteRange;
    request: number;
  }>();
  const [blockFocus, setBlockFocus] = useState<{ blockId: string; request: number }>();
  const [draftFocus, setDraftFocus] = useState<{
    text: string;
    range: ByteRange;
    request: number;
  }>();
  const executedDetails = useRef<HTMLDetailsElement>(null);
  const editorWorkbench = useRef<WorkbenchHandle>(null);
  const reviewWorkbench = useRef<WorkbenchHandle>(null);
  const focus = diagnosticFocus?.runId === result?.identity.runId ? diagnosticFocus : undefined;
  const locateExecutedSource = (range: ByteRange) => {
    if (!result) return;
    if (executedDetails.current) executedDetails.current.open = true;
    if (review) reviewWorkbench.current?.reveal('first');
    else if (!state.codeEditing) editorWorkbench.current?.reveal('second');
    setDiagnosticFocus({
      runId: result.identity.runId,
      range,
      request: (diagnosticFocus?.request ?? 0) + 1,
    });
  };
  const phase = active ? state.phase : 'empty';
  const busy = ['running', 'preparing'].includes(phase);
  const edit = active ? state.editDocument : undefined;
  const access = useMemo(
    () =>
      catalog
        ? resolveBlockAccess(catalog.packageRef, catalog.subject.lessonRef, learning.snapshot)
        : null,
    [catalog, learning.snapshot],
  );
  const lockedKinds = useMemo(
    () => (state.program && access ? lockedProgramKinds(state.program, access, state.draft) : []),
    [state.program, access, state.draft],
  );
  const permissionBlocked = !!access && (!access.available || lockedKinds.length > 0);
  const recommendation = resolvePreferredEditor(
    presentation?.configuration ?? null,
    catalog?.packageRef,
    catalog?.subject.lessonRef,
  );
  const blocksVisible =
    !bug &&
    (reconstructing ||
      preference.value === 'show' ||
      (preference.value === 'auto' && recommendation === 'blocks'));
  // Once mounted, retain the native canvas and undo history while hidden.
  const [canvasOwner, setCanvasOwner] = useState('');
  const canvasKey = `${id}:${state.modeRevision}`;
  const mountCanvas = blocksVisible || canvasOwner === canvasKey;
  if (blocksVisible && canvasOwner !== canvasKey) setCanvasOwner(canvasKey);
  useEffect(() => {
    let current = true;
    void loadTeachingPresentation().then((value) => {
      if (current) setPresentation(value);
    });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (
      presentation &&
      learning.status !== 'loading' &&
      active &&
      !review &&
      (!edit || (!blocksVisible && !state.codeEditing)) &&
      (edit || state.source) &&
      !busy
    )
      void session.enableCodeEditing(!blocksVisible || state.codeEditing === true);
  }, [
    presentation,
    learning.status,
    active,
    review,
    blocksVisible,
    state.codeEditing,
    state.source,
    edit,
    busy,
    session,
  ]);
  const syncBlocked =
    (!review && !!catalog && !edit) ||
    (!!edit &&
      (edit.analysisPending ||
        !!edit.analysisError ||
        edit.syncStatus !== 'synced' ||
        edit.validatedDocumentRevision !== edit.identity.documentRevision));
  const retrySavedHistory =
    state.saveStatus === 'unsaved' &&
    learning.lastSaved &&
    learning.pendingCount === 0 &&
    (learning.snapshot && (learning.practiceCatalog ?? learning.reading?.catalog)
      ? reviewedDurableSnapshot(
          learning.snapshot,
          (learning.practiceCatalog ?? learning.reading?.catalog)!,
        )
      : learning.snapshot
    )?.progress.some(
      (row) =>
        row.eventType === 'exercise.passed' &&
        row.subjectRef.id === id &&
        row.subjectRef.version === catalog?.subject.version &&
        row.learningRevision === catalog?.subject.learningRevision,
    );
  const blockLocation = blocksAtLocation(
    source,
    result?.nodeMap ?? [],
    player.view.terminal?.diagnostics[0]?.location ?? player.view.location,
  );
  const activeBlocks = [
    ...new Set([
      ...blockLocation,
      ...state.issues.flatMap((issue) => (issue.blockId ? [issue.blockId] : [])),
      ...(state.selectedBlockId ? [state.selectedBlockId] : []),
    ]),
  ];
  const retainedTest = catalog?.subject.tests.find((test) => test.caseKey === state.caseKey);
  const output =
    result?.trace?.steps
      .flatMap((step) =>
        step.changes.flatMap((change) => (change.op === 'output' ? [change.append] : [])),
      )
      .join('') ?? '';
  if (bug && catalog)
    return (
      <section
        className="card section-card"
        data-testid="practice-execution"
        data-state={phase === 'met' ? 'passed' : phase}
        data-save-state={retrySavedHistory ? 'saved-history' : state.saveStatus}
      >
        <h2>题目描述</h2>
        <p>{catalog.subject.prompt}</p>
        <PracticeExamples
          key={id}
          inputFormat={`本题使用给定数据：${catalog.inputSpec.fields.map((field) => field.key).join('、')}。`}
          outputFormat="按题目要求输出结果。"
          samples={catalog.subject.tests.map((test) => ({
            input: catalog.inputSpec.fields
              .map(
                (field) =>
                  `${field.key} = ${Array.isArray(test.input[field.key]) ? (test.input[field.key] as readonly number[]).join(' ') || '[]' : test.input[field.key]}`,
              )
              .join('\n'),
            output: test.expectedStdout,
          }))}
        />
        {edit ? (
          <Suspense fallback={<p role="status">正在准备代码编辑区…</p>}>
            <DraftCodeEditor
              document={edit}
              selection={state.selectedCodeRange}
              selectionRevision={state.selectionRevision}
              commentsMoved={state.commentsMoved}
              editRejection={state.editRejection}
              onChange={(text, range) => session.editCode(text, range)}
              onSelect={(range) => session.selectCode(range)}
              onRetry={() => void session.retryAnalysis()}
            />
          </Suspense>
        ) : (
          <p role="status">正在准备代码…</p>
        )}
        <div className="inline-actions practice-actions">
          <button
            className="button button-primary"
            onClick={() => void session.submit()}
            disabled={
              busy || syncBlocked || permissionBlocked || !source || state.issues.length > 0
            }
          >
            {busy ? '提交中…' : '提交'}
          </button>
          {busy && (
            <button className="button button-secondary" onClick={() => session.cancel()}>
              取消
            </button>
          )}
        </div>
        {['met', 'unmet', 'failed'].includes(phase) && (
          <p
            role="status"
            className="oj-verdict"
            data-testid="practice-feedback"
            data-verdict={phase === 'met' ? 'passed' : phase === 'unmet' ? 'failed' : 'incomplete'}
          >
            {phase === 'met' ? '通过' : phase === 'unmet' ? '未通过' : '提交未完成，请重试'}
          </p>
        )}
        <EditorHistory session={session} busy={busy || !edit} />
        <BugGuidance key={id} question={bug} />
        <LearningSaveStatus />
      </section>
    );
  return (
    <section
      className="card section-card"
      data-testid="practice-execution"
      data-state={phase === 'met' ? 'passed' : phase}
    >
      {catalog && (
        <>
          <WorkspaceContext label="题意与教学目标">
            <h2>{review ? '本次提交复盘' : '题目与答题区'}</h2>
            <p>{catalog.subject.prompt}</p>
            <p className="notice">教学目标：{catalog.judgeProfile.targetDescription}</p>
            <PracticeExamples
              key={id}
              inputFormat={`本题使用给定数据：${catalog.inputSpec.fields.map((field) => field.key).join('、')}。`}
              outputFormat="按题目要求输出结果，空格与换行须与示例一致。"
              samples={catalog.subject.tests.map((test) => ({
                input: catalog.inputSpec.fields
                  .map((field) => {
                    const value = test.input[field.key];
                    return `${field.key} = ${Array.isArray(value) ? value.join(' ') || '[]' : value}`;
                  })
                  .join('\n'),
                output: test.expectedStdout,
              }))}
            />
            <details className="practice-storage-note muted">
              <summary>练习与保存说明</summary>
              <p>
                代码在当前浏览器中执行；网页资源需要网络。编辑历史保存在当前浏览器，运行轨迹仅在本题临时保留。
                全部测试与教学目标通过后，保存最少通过记录。首次通过和小节完成奖励统一入账，未保存的操作不计入积分。
              </p>
            </details>
          </WorkspaceContext>
        </>
      )}
      {!review && catalog && (
        <>
          {!bug && (
            <PracticeGuidance
              key={id}
              id={id}
              lessonId={catalog.subject.lessonRef.id}
              mode={state.mode}
              reconstruction={!!question}
              onMode={(mode) => session.switchMode(mode)}
            />
          )}
          {reconstructing && question && state.reconstructionSource && (
            <ReconstructionReference question={question} source={state.reconstructionSource} />
          )}
          {permissionBlocked && (
            <p role="alert" data-testid="block-permission-blocked">
              {access?.available
                ? `请先学习对应知识，解锁${lockedKinds.map((kind) => BLOCK_LABELS[kind] ?? kind).join('、')}。`
                : '正在准备本题编辑权限。'}{' '}
              <Link to="/courses">查看课程</Link>
            </p>
          )}
          {!edit && <p role="status">正在准备本题代码与积木，请稍候……</p>}
          <div
            id="practice-answer"
            tabIndex={-1}
            data-testid="practice-editor-layout"
            data-blocks-visible={blocksVisible ? 'yes' : 'no'}
          >
            <Workbench
              ref={editorWorkbench}
              kind="practice"
              firstAvailable={blocksVisible}
              firstLabel="积木"
              secondLabel={state.codeEditing ? '编辑代码' : '生成代码'}
              first={
                <div>
                  {state.initialProgram && mountCanvas && (
                    <Suspense fallback={<p role="status">正在准备积木工作区……</p>}>
                      <BlockWorkspace
                        allowedKinds={access?.allowed ?? []}
                        key={`${id}:${state.modeRevision}`}
                        value={state.workspaceProgram ?? state.initialProgram}
                        draft={state.draft}
                        activeBlockIds={activeBlocks}
                        selectedBlockId={state.selectedBlockId}
                        diagnosticFocus={blockFocus}
                        onSelect={(blockId) => session.selectBlock(blockId)}
                        onSnapshot={(draft, logicalMove) =>
                          session.recordWorkspaceDraft(draft, logicalMove)
                        }
                        disabled={!edit || (edit.authoritativeDraft.kind === 'code' && syncBlocked)}
                        onChange={(program, issues, draft) =>
                          session.editBlocks(program, issues, draft)
                        }
                      />
                    </Suspense>
                  )}
                  {edit && syncBlocked && (
                    <p className="notice" data-testid="historical-blocks-notice">
                      {edit.authoritativeDraft.kind === 'code'
                        ? '积木区保留上次有效结构，仅供对照。当前草稿完成同步后才能继续使用这些积木。'
                        : '积木尚未同步，当前不能运行或提交，请继续修复连接。'}
                    </p>
                  )}
                  {state.issues.length > 0 && (
                    <ul role="alert" className="block-issues" data-testid="block-issues">
                      {state.issues.map((issue, index) => (
                        <li key={`${issue.code}:${issue.blockId}:${index}`}>
                          {issue.message}
                          {issue.blockId ? `（积木 ${issue.blockId}）` : ''}
                          {issue.blockId && (
                            <button
                              type="button"
                              className="button button-small"
                              onClick={() =>
                                setBlockFocus({
                                  blockId: issue.blockId!,
                                  request: (blockFocus?.request ?? 0) + 1,
                                })
                              }
                            >
                              定位积木 {issue.blockId}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              }
              second={
                <aside className="practice-generated-code" aria-label="代码与积木联动">
                  {state.codeEditing && edit ? (
                    <Suspense fallback={<p role="status">正在准备代码编辑区…</p>}>
                      <DraftCodeEditor
                        document={edit}
                        selection={state.selectedCodeRange}
                        selectionRevision={state.selectionRevision}
                        commentsMoved={state.commentsMoved}
                        editRejection={state.editRejection}
                        onChange={(text, range) => session.editCode(text, range)}
                        onSelect={(range) => session.selectCode(range)}
                        onRetry={() => void session.retryAnalysis()}
                      />
                    </Suspense>
                  ) : source ? (
                    <SourcePanel
                      source={source.text}
                      nodes={result?.nodeMap ?? []}
                      view={player.view}
                      diagnosticFocus={focus}
                    />
                  ) : edit &&
                    !edit.analysisPending &&
                    !edit.analysisError &&
                    edit.diagnostics.length > 0 ? (
                    <SourcePanel
                      draft
                      source={edit.codeDraft}
                      nodes={[]}
                      view={player.view}
                      diagnosticFocus={draftFocus?.text === edit.codeDraft ? draftFocus : undefined}
                    />
                  ) : (
                    <section className="workbench-panel practice-code-empty">
                      <h3>生成的 C 代码</h3>
                      <p>
                        {state.issues.length
                          ? '当前积木存在问题，旧源码已失效。修复标记的积木后再查看。'
                          : '正在准备本题输入声明，准备后积木修改会实时更新这里的只读代码。'}
                      </p>
                    </section>
                  )}
                  {!state.codeEditing && edit && !edit.analysisPending && !edit.analysisError && (
                    <DiagnosticPanel
                      diagnostics={edit.diagnostics}
                      source={{ text: edit.codeDraft }}
                      onLocateSource={(range) =>
                        setDraftFocus({
                          text: edit.codeDraft,
                          range,
                          request: (draftFocus?.request ?? 0) + 1,
                        })
                      }
                    />
                  )}
                </aside>
              }
            />
          </div>
          <div className="inline-actions practice-actions">
            <button
              className="button button-secondary"
              onClick={() => void session.run()}
              disabled={
                busy || syncBlocked || permissionBlocked || !source || state.issues.length > 0
              }
            >
              运行本组
            </button>

            <button
              className="button button-primary"
              onClick={() => void session.submit()}
              disabled={
                busy || syncBlocked || permissionBlocked || !source || state.issues.length > 0
              }
            >
              提交练习
            </button>
            <button
              className="button button-secondary"
              onClick={() => session.cancel()}
              disabled={!busy && !edit?.analysisPending}
            >
              {state.action === 'run' ? '取消运行' : '取消提交'}
            </button>
            <Link className="text-link" to={paths.review(id)}>
              查看本次复盘
            </Link>
            {!reconstructing &&
              (!state.codeEditing ? (
                <button
                  className="button button-secondary"
                  disabled={
                    busy || (!edit && (!source || !state.program || state.issues.length > 0))
                  }
                  onClick={() => void session.enableCodeEditing()}
                >
                  编辑 C 并同步积木
                </button>
              ) : blocksVisible ? (
                <button
                  className="button button-secondary"
                  onClick={() => session.setCodeEditing(false)}
                >
                  收起代码编辑
                </button>
              ) : null)}
            {edit && !state.codeEditing && (
              <span role="status">
                {syncBlocked ? '当前草稿尚未同步，无法运行。' : '当前代码与积木已同步。'}
              </span>
            )}
          </div>
          {bug && <BugGuidance key={id} question={bug} />}
          <EditorHistory session={session} busy={busy || !edit} />
        </>
      )}
      {!catalog && (
        <p role={phase === 'failed' ? 'alert' : 'status'}>
          {phase === 'loading'
            ? '正在读取练习……'
            : review
              ? '还没有可复盘的运行。返回练习工作区完成真实提交后再查看。'
              : state.message || '正在准备练习。'}
        </p>
      )}
      {!review && phase === 'failed' && !catalog && (
        <button className="button button-secondary" onClick={() => session.reload()}>
          重试读取练习
        </button>
      )}
      <section
        aria-live="polite"
        data-testid="practice-feedback"
        hidden={!result && !busy && !state.message && !review}
      >
        {review && catalog && !result && (
          <p>还没有可复盘的运行。返回练习工作区完成真实提交后再查看。</p>
        )}
        <h3>
          {state.action === 'run'
            ? busy
              ? '正在运行本组'
              : '本组运行结果'
            : phase === 'met'
              ? '本次提交通过全部测试与教学目标'
              : phase === 'unmet'
                ? '本次提交未通过'
                : phase === 'running'
                  ? '正在逐组检查'
                  : '本次提交与反馈'}
        </h3>
        {state.action === 'run' && result && (
          <p className="practice-operation-note" data-testid="practice-run-only">
            这是第一组输入的运行与局部检查，不代表全部测试通过。确认程序后，提交练习检查全部测试。
          </p>
        )}
        {state.message && active && (
          <p role={phase === 'failed' ? 'alert' : 'status'}>{state.message}</p>
        )}
        {active && phase === 'met' && (
          <p
            data-testid="practice-pass-save"
            data-save-state={retrySavedHistory ? 'saved-history' : state.saveStatus}
          >
            {retrySavedHistory
              ? '待保存操作已处理，兼容的历史通过记录可在课程中查看。'
              : state.saveStatus === 'saved'
                ? '本次真实通过记录已保存到当前浏览器。'
                : state.saveStatus === 'saving'
                  ? '本次真实通过正在保存……'
                  : state.saveStatus === 'unsaved'
                    ? '本次真实通过尚未保存，请在下方重试未保存操作。'
                    : state.saveStatus === 'unavailable'
                      ? '本次通过仅临时有效，学习记录授权暂不可用，尚未保存。'
                      : '正在完成本次提交的最终接收检查。'}
          </p>
        )}
        {active && phase === 'unmet' && state.action === 'submit' && (
          <p data-testid="practice-attempt-save" data-save-state={state.saveStatus}>
            {state.saveStatus === 'saved'
              ? '本次有效错误已保存到错题记录。'
              : state.saveStatus === 'saving'
                ? '正在保存本次错误摘要……'
                : state.saveStatus === 'unsaved'
                  ? '错误摘要尚未保存，请重试未保存操作。'
                  : '本次尚无已保存的错误记录。'}{' '}
            <Link className="text-link" to="/notebook">
              查看错题与陌生点
            </Link>
          </p>
        )}
        {state.summaries.length > 0 && active && (
          <>
            {result?.judgeResult?.checks.some(
              (check) => check.key === 'teaching-target' && check.status !== 'met',
            ) &&
              catalog && (
                <p>
                  {teachingHelp[catalog.judgeProfile.rule]}
                  当前有限教学检查无法证明的复杂等价解也不会默认通过。
                </p>
              )}
            <p>
              已检查 {state.summaries.length}/{catalog?.subject.tests.length} 组；首个未通过即停止。
            </p>
            <ul>
              {state.summaries.map((summary) => (
                <li key={summary.caseKey}>
                  {summary.caseKey}：{summary.met ? '本组通过' : '本组未通过'}
                  {summary.checks
                    .filter((check) => check.status !== 'met')
                    .map((check) => (
                      <span key={check.key}> · {checkLabels[check.key] ?? check.key}未满足</span>
                    ))}
                </li>
              ))}
            </ul>
          </>
        )}
        {result && (
          <>
            <p>
              {terminalLabels[result.terminal.status]}
              {result.terminal.exitCode !== null ? `，返回值 ${result.terminal.exitCode}` : ''}。
              {result.terminal.status === 'completed' && result.judgeResult?.status !== 'met'
                ? '程序能够结束，但本题要求尚未全部满足。'
                : ''}
            </p>
            {source && (
              <DiagnosticPanel
                diagnostics={result.terminal.diagnostics}
                source={{ text: source.text, nodes: result.nodeMap, blockMap: source.blockMap }}
                onLocateSource={locateExecutedSource}
                onLocateBlock={
                  !review && blocksVisible
                    ? (blockId) => {
                        editorWorkbench.current?.reveal('first');
                        setBlockFocus({ blockId, request: (blockFocus?.request ?? 0) + 1 });
                      }
                    : undefined
                }
              />
            )}
            <ul>
              {result.judgeResult?.checks.map((check) => (
                <li key={check.key}>
                  {checkLabels[check.key] ?? check.key}：
                  {check.status === 'met'
                    ? '满足'
                    : check.status === 'unmet'
                      ? '未满足'
                      : '未能判定'}
                  {check.diagnosticCodes.map((code) => (
                    <span key={code}> · {code}</span>
                  ))}
                </li>
              ))}
            </ul>
            <p>
              输出按原样比较，空格与换行也计入；教学目标需要真实的输入贡献或控制路径，只有输出相同仍可能未通过。
            </p>
            <div className="trace-panels">
              <div>
                <h4>本组实际输出</h4>
                <pre className="sample-source" data-testid="practice-stdout">
                  {output || '（无输出）'}
                </pre>
              </div>
              <div>
                <h4>本组预期输出</h4>
                <pre className="sample-source">{retainedTest?.expectedStdout ?? '（无预期）'}</pre>
              </div>
            </div>
          </>
        )}
        {phase === 'unmet' && result?.judgeResult?.status === 'met' && (
          <p>各组局部检查满足，但同一分支结构未形成完整的 then/else 覆盖，本次提交仍未通过。</p>
        )}
      </section>
      {catalog && (
        <>
          <LearningSaveStatus />
          {!bug && (
            <LessonCompletion lessonId={catalog.subject.lessonRef.id} currentExerciseId={id} />
          )}
          {learning.practiceStatus === 'failed' && (
            <p className="notice" data-testid="practice-learning-unavailable">
              本地通过记录暂不可用，可以继续临时练习。
              <button className="button button-small" onClick={() => void service.reloadReading()}>
                重试读取学习授权
              </button>
            </p>
          )}
        </>
      )}
      {source && result && (
        <>
          <p data-testid="practice-retained-case">
            当前源码{result ? '与复盘' : ''}对应测试组：{state.caseKey}。
            {result ? '只保留本组轨迹；复盘不重新运行。' : '此处为将实际执行的完整代码。'}
          </p>
          {blockLocation.length > 0 && (
            <p data-testid="practice-block-location">
              当前源码定位对应积木：{blockLocation.join('、')}
            </p>
          )}
          {retainedTest && (
            <p data-testid="practice-input">
              本组输入：<code>{JSON.stringify(retainedTest.input)}</code>
            </p>
          )}
          {!review && state.codeEditing && result && (
            <details
              ref={executedDetails}
              className="practice-executed-source"
              data-testid="executed-source-details"
            >
              <summary>查看本组实际执行的 C 代码</summary>
              <SourcePanel
                source={source.text}
                nodes={result.nodeMap}
                view={player.view}
                diagnosticFocus={focus}
              />
            </details>
          )}
          <div
            className={review ? 'player-workspace' : 'player-workspace practice-inline-player'}
            data-testid="player-workspace"
            tabIndex={0}
            aria-label="执行播放工作区"
            onKeyDown={(event) => {
              if (!review || traceVisible.current) session.player.handleKey(event.nativeEvent);
            }}
          >
            {review ? (
              <Workbench
                ref={reviewWorkbench}
                kind="review"
                firstLabel="代码"
                secondLabel="运行画面"
                first={
                  <SourcePanel
                    source={source.text}
                    nodes={result?.nodeMap ?? []}
                    view={player.view}
                    diagnosticFocus={focus}
                  />
                }
                onSecondVisibility={traceVisibility}
                second={
                  <section
                    className="workbench-panel"
                    data-testid="animation-panel"
                    aria-label="运行结果"
                  >
                    <header className="panel-heading">
                      <h3>当前步骤画面</h3>
                    </header>
                    <PlayerControls controller={session.player} snapshot={player} />
                    <BasicTraceView
                      view={player.view}
                      result={result}
                      input={retainedTest?.input ?? {}}
                      bindings={catalog?.program.bindings ?? []}
                    />
                  </section>
                }
              />
            ) : (
              <section
                className="workbench-panel"
                data-testid="animation-panel"
                aria-label="运行结果"
              >
                <header className="panel-heading">
                  <h3>当前步骤画面</h3>
                </header>
                <PlayerControls controller={session.player} snapshot={player} />
                <BasicTraceView
                  view={player.view}
                  result={result}
                  input={retainedTest?.input ?? {}}
                  bindings={catalog?.program.bindings ?? []}
                />
              </section>
            )}
          </div>
        </>
      )}
      {review && (
        <Link className="button button-primary" to={paths.practice(id)}>
          返回练习工作区
        </Link>
      )}
    </section>
  );
}
