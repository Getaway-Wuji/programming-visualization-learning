import { c6ObjectSlots, c6ValueText } from './presentation';
import { C6SnapshotPanel } from './SnapshotPanel';
import type { C6SnapshotCapture } from './snapshot';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { PageHeading, StatePanel } from '../components/Ui';
import { DiagnosticPanel } from '../diagnostics/DiagnosticPanel';
import type { DisplayDiagnostic } from '../diagnostics/presentation';
import { createSourceIndex } from '../player/source-location';
import { C6ExecutionClient, c6RunRequest, acceptedC6Proof } from '../engine/c6-client';
import { c6BlockProgram } from '../engine/c6-protocol';
import { C6Player } from '../engine/c6-player';
import type { C6JudgeResult, C6Result } from '../engine/c6-types';
import type { C6CourseExercise } from '../content/c6-course-types';
import type { C6TeachingProgram } from '../content/c6-teaching-types';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { generateBlockSource } from '../blocks/generator';
import type { BlockProgram } from '../blocks/model';
import type { C6RunLease } from './authority';
import { C6Boundary, C6LegacyLink, c6NodePath } from './CoursePages';
import './workbench.css';
import { useBlockWorkspacePreference } from '../appearance/BlockWorkspacePreference';
import { PracticeExamples } from '../components/PracticeExamples';
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor';
import { useBlockMapping } from './use-block-mapping';
import { useUnsavedChanges } from '../workbench/use-unsaved-changes';

const BlockWorkspace = lazy(() =>
  import('../blocks/BlockWorkspace').then((m) => ({ default: m.BlockWorkspace })),
);
interface Document {
  id: string;
  nodeId: string;
  title: string;
  source: string;
  input: string;
  exercise: C6CourseExercise | null;
  program: C6TeachingProgram | null;
}
function Resource({
  exerciseId,
  programId,
  nodeId,
}: {
  exerciseId?: string;
  programId?: string;
  nodeId?: string;
}) {
  const { state, service } = useLearning();
  const key = `${exerciseId ?? ''}:${programId ?? ''}:${nodeId ?? ''}`;
  const [resource, setResource] = useState<{ key: string; document: Document } | null>(null);
  const [failure, setFailure] = useState('');
  const [retry, setRetry] = useState(0);
  const exerciseIndex = state.c6!.index!.exercises.find((e) => e[0] === exerciseId);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      if (exerciseId) {
        if (!exerciseIndex) return;
        const exercise = await service
          .courseRepository()
          .loadEntity({ id: exerciseId, version: '2.0.0' }, 'exercises', abort.signal);
        if (!('starterSource' in exercise)) throw Error('exercise required');
        if (!abort.signal.aborted)
          setResource({
            key,
            document: {
              id: exerciseId,
              nodeId: exerciseIndex[1].slice(5),
              title: exercise.title,
              source: exercise.starterSource,
              input: exercise.tests[0].stdin,
              exercise,
              program: null,
            },
          });
      } else {
        if (!programId || !nodeId) throw Error('program location required');
        const node = await service.courseRepository().loadNode(nodeId, abort.signal);
        if (!node.programRefs.some((r) => r.id === programId)) throw Error('unrelated program');
        const program = await service
          .courseRepository()
          .loadEntity({ id: programId, version: '2.0.0' }, 'programs', abort.signal);
        if (!('files' in program)) throw Error('program required');
        if (!abort.signal.aborted)
          setResource({
            key,
            document: {
              id: programId,
              nodeId,
              title: program.title,
              source: program.files[0].source,
              input: program.mode === 'reading' ? '' : program.input,
              exercise: null,
              program,
            },
          });
      }
    })().catch(() => {
      if (!abort.signal.aborted) setFailure(key);
    });
    return () => abort.abort();
  }, [exerciseId, exerciseIndex, programId, nodeId, service, key, retry]);
  if (!state.snapshot || !state.c6?.rows)
    return (
      <>
        <StatePanel
          kind={state.status === 'loading' ? 'loading' : 'error'}
          title={state.status === 'loading' ? '正在准备本地学习档案' : '本地学习档案尚未就绪'}
          description="本地档案准备完成后显示编辑器，确保加载与重置过程中不会覆盖输入。"
        >
          {state.status !== 'loading' && (
            <button className="button button-secondary" onClick={() => void service.refresh()}>
              重新读取档案
            </button>
          )}
        </StatePanel>
        <LearningSaveStatus />
      </>
    );
  if (exerciseId && !exerciseIndex) return <C6LegacyLink id={exerciseId} />;
  if (resource?.key !== key)
    return (
      <StatePanel
        kind={failure === key ? 'error' : 'loading'}
        title={failure === key ? '程序读取失败' : '正在读取完整程序'}
        description="代码和练习要求来自当前章节。"
      >
        {failure === key && (
          <button className="button button-secondary" onClick={() => setRetry((n) => n + 1)}>
            重试读取
          </button>
        )}
      </StatePanel>
    );
  return <Workbench key={key} document={resource.document} />;
}
export function C6PracticePage() {
  const { exerciseId = '' } = useParams();
  return (
    <C6Boundary>
      <Resource exerciseId={exerciseId} />
    </C6Boundary>
  );
}
export function C6ProgramPage() {
  const { programId = '' } = useParams();
  const [params] = useSearchParams();
  return (
    <C6Boundary>
      <Resource programId={programId} nodeId={params.get('node') ?? ''} />
    </C6Boundary>
  );
}
function TraceView({
  result,
  source,
  locate,
  capture,
  disabled,
}: {
  result: C6Result;
  source: string;
  locate(start: number, end: number): void;
  capture: Omit<C6SnapshotCapture, 'cursor'>;
  disabled: boolean;
}) {
  const player = useMemo(() => (result.trace ? new C6Player(result) : null), [result]);
  const [cursor, setCursor] = useState(0);
  const [objectPage, setObjectPage] = useState(0);
  const snapshot = useMemo(() => player?.seek(cursor) ?? null, [player, cursor]);
  const step = result.trace?.steps[cursor - 1];
  const range = result.nodeMap.find((n) => n.nodeId === step?.nodeId)?.byteRange;
  const location = range ? createSourceIndex(source).range(range) : null;
  const diagnostic: DisplayDiagnostic[] = result.terminal.code
    ? [
        {
          code: result.terminal.code,
          ...(result.terminal.byteRange
            ? {
                location: {
                  kind: 'source' as const,
                  nodeId:
                    result.nodeMap.find(
                      (n) =>
                        n.byteRange.start <= result.terminal.byteRange!.start &&
                        n.byteRange.end >= result.terminal.byteRange!.end,
                    )?.nodeId ?? 'unmapped',
                  byteRange: result.terminal.byteRange,
                  edge: 'whole' as const,
                },
              }
            : {}),
        },
      ]
    : [];
  return (
    <section className="c6-trace" aria-label="真实执行轨迹" data-cursor={cursor}>
      <DiagnosticPanel
        diagnostics={diagnostic}
        source={{ text: source, language: 'c', nodes: result.nodeMap }}
        onLocateSource={(r) => locate(r.start, r.end)}
      />
      {!snapshot ? (
        <p className="notice">本次在形成执行轨迹前停止，修正代码后可以重新运行。</p>
      ) : (
        <>
          <div className="c6-trace-controls" aria-label="逐步回放控制">
            <button
              className="button button-secondary"
              disabled={!cursor}
              onClick={() => setCursor(0)}
            >
              回到开始
            </button>
            <button
              className="button button-secondary"
              disabled={!cursor}
              onClick={() => setCursor((c) => c - 1)}
            >
              上一步
            </button>
            <button
              className="button button-primary"
              disabled={cursor >= result.trace!.steps.length}
              onClick={() => setCursor((c) => c + 1)}
            >
              下一步
            </button>
            <button
              className="button button-secondary"
              disabled={cursor >= result.trace!.steps.length}
              onClick={() => setCursor(result.trace!.steps.length)}
            >
              到本次末尾
            </button>
          </div>
          <label className="c6-cursor-label">
            执行步骤 {cursor} / {result.trace!.steps.length}
            <input
              type="range"
              min={0}
              max={result.trace!.steps.length}
              value={cursor}
              onChange={(e) => setCursor(Number(e.target.value))}
            />
          </label>
          <p className="muted">
            {cursor
              ? `${step?.kind} · ${location ? `第 ${location.start.line} 行` : '无源码位置'}`
              : '初始状态，尚未执行'}
            {result.trace!.completeness === 'prefix' ? ' · 当前仅包含停止前的轨迹' : ''}
            {range && (
              <button className="text-link" onClick={() => locate(range.start, range.end)}>
                定位当前步
              </button>
            )}
          </p>
          <C6SnapshotPanel key={cursor} capture={{ ...capture, cursor }} disabled={disabled} />
          <section>
            <h3>标准输出</h3>
            <pre className="c6-output" aria-label="当前游标标准输出">
              {snapshot.output || '（暂无输出）'}
            </pre>
          </section>
          <section>
            <h3>调用栈 · {snapshot.frames.length} 帧</h3>
            {snapshot.frames.length ? (
              <ol className="c6-stack-list">
                {snapshot.frames.map((f) => (
                  <li key={f.id}>
                    <code>{f.functionName}</code> · {f.id}
                    {snapshot.control.activeFrameId === f.id ? ' · 当前帧' : ''}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">当前没有调用帧。</p>
            )}
          </section>
          <section>
            <h3>虚拟内存 · {snapshot.objects.length} 个对象</h3>
            <p className="muted">地址属于教学虚拟内存。后退会恢复对象、生命周期、栈和输出。</p>
            <div className="c6-table-scroll" tabIndex={0} aria-label="虚拟内存对象表，可横向滚动">
              <table>
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>类型与地址</th>
                    <th>状态</th>
                    <th>值（字节偏移）</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.objects.slice(objectPage * 32, (objectPage + 1) * 32).map((o) => (
                    <tr key={o.id}>
                      <th scope="row">
                        {o.name}
                        <small>
                          {o.id} · {o.frameId ?? '全局'}
                        </small>
                      </th>
                      <td>
                        {o.typeName}
                        <small>
                          0x{o.baseAddress.toString(16)} · {o.byteLength} 字节
                        </small>
                      </td>
                      <td>
                        {o.alive ? '存活' : '已结束'} ·{' '}
                        {o.storage === 'static'
                          ? '静态'
                          : o.storage === 'literal'
                            ? '字面量'
                            : '自动'}
                        {o.writable ? '' : ' · 只读'}
                      </td>
                      <td>
                        {c6ObjectSlots(o, player!.types).map((cell) => (
                          <div key={cell.byteOffset}>
                            <code>+{cell.byteOffset}</code>：
                            {c6ValueText(cell.value, snapshot.objects)}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {snapshot.objects.length > 32 && (
              <div className="c6-trace-controls">
                <button
                  className="button button-secondary"
                  disabled={objectPage === 0}
                  onClick={() => setObjectPage((p) => p - 1)}
                >
                  上一页对象
                </button>
                <span>第 {objectPage + 1} 页</span>
                <button
                  className="button button-secondary"
                  disabled={(objectPage + 1) * 32 >= snapshot.objects.length}
                  onClick={() => setObjectPage((p) => p + 1)}
                >
                  下一页对象
                </button>
              </div>
            )}
          </section>
          <p className="muted">
            {result.terminal.status === 'completed'
              ? `本次程序返回：${c6ValueText(result.terminal.returnValue, snapshot.objects)}`
              : `本次停止：${result.terminal.code ?? result.terminal.status}`}
          </p>
        </>
      )}
    </section>
  );
}
function Workbench({ document }: { document: Document }) {
  const { state, service } = useLearning();
  const initialDraft = state.c6!.rows?.drafts.find((d) => d.documentId === document.id);
  const [source, setSource] = useState(initialDraft?.source ?? document.source);
  const [input, setInput] = useState(initialDraft?.input ?? document.input);
  const [sourceRevision, setSourceRevision] = useState(
    initialDraft?.sourceRevision ?? crypto.randomUUID(),
  );
  const [savedDocumentRevision, setSavedDocumentRevision] = useState(initialDraft?.revision ?? 0);
  const [dirty, setDirty] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [engine] = useState(() => new C6ExecutionClient());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<C6Result | C6JudgeResult | null>(null);
  const [caseIndex, setCaseIndex] = useState(0);
  const [blockCandidate, setBlockCandidate] = useState('');
  const [undoBlockSource, setUndoBlockSource] = useState<string | null>(null);
  const [blocksRequested, setBlocksRequested] = useState(false);
  const [practicePane, setPracticePane] = useState<'question' | 'code' | 'blocks'>('code');
  const blockPreference = useBlockWorkspacePreference();
  const showBlocks =
    blockPreference.value === 'show' ||
    (blockPreference.value === 'auto' &&
      (blocksRequested || /^c6\.s[123](\.|$)/.test(document.nodeId)));
  const active = useRef({ token: 0, lease: null as C6RunLease | null });
  const area = useRef<CodeEditorHandle>(null);
  const reading = document.program?.mode === 'reading';
  const sourceBytes = new TextEncoder().encode(source).length;
  const tooLarge = sourceBytes > 32768;
  const blockMapping = useBlockMapping({
    enabled: showBlocks && !reading && !tooLarge,
    suspended: busy,
    documentId: document.id,
    source,
    sourceRevision,
  });
  const { edit, presentedBlocks, mapping, error: mappingError } = blockMapping;
  useUnsavedChanges(dirty);
  const validInput = input.length <= 256 && [...input].every((c) => c.charCodeAt(0) <= 127);
  const packet = result && 'cases' in result ? result.cases[caseIndex]?.packet : result;
  const mapped = useMemo(() => (edit?.status === 'mapped' ? c6BlockProgram(edit) : null), [edit]);
  const currentMapping = edit?.sourceRevision === sourceRevision;
  const emptyBlocks = useMemo<BlockProgram>(
    () => ({
      id: 'main.practice',
      kind: 'main',
      body: [
        {
          id: 'return.practice',
          kind: 'return',
          value: { id: 'zero.practice', kind: 'integer', value: '0' },
        },
      ],
    }),
    [],
  );
  useEffect(() => {
    const current = active.current;
    return () => {
      current.token++;
      engine.invalidate();
      if (current.lease) service.invalidateC6Practice(current.lease);
    };
  }, [engine, service]);
  const invalidate = (sourceChanged = false) => {
    active.current.token++;
    engine.invalidate();
    if (active.current.lease) service.invalidateC6Practice(active.current.lease);
    active.current.lease = null;
    setResult(null);
    if (sourceChanged) blockMapping.clearError();
    setBlockCandidate('');
    setBusy(false);
    setError('');
  };
  const changeSource = (text: string) => {
    invalidate(true);
    setSource(text);
    setSourceRevision(crypto.randomUUID());
    setDirty(true);
  };
  const locate = (start: number, end: number) => {
    const range = createSourceIndex(source).range({ start, end });
    if (!range || !area.current) return;
    area.current.select(range.utf16Range.start, range.utf16Range.end);
  };
  const run = async (judge: boolean) => {
    blockMapping.pause();
    invalidate();
    const token = active.current.token,
      started = performance.now();
    setBusy(true);
    try {
      let response;
      if (judge) {
        const startedRun = await service.beginC6Practice(
          document.id,
          source,
          sourceRevision,
          state.sessionEpoch,
        );
        if (token !== active.current.token) {
          service.invalidateC6Practice(startedRun.lease);
          return;
        }
        active.current.lease = startedRun.lease;
        response = await engine.execute(startedRun.request, { started });
      } else
        response = await engine.execute(await c6RunRequest(source, input, sourceRevision), {
          started,
        });
      if (token !== active.current.token) return;
      if ('editVersion' in response) throw Error('E_PROTOCOL_INVALID');
      setResult(response);
      setCaseIndex(
        'cases' in response
          ? Math.max(
              0,
              response.cases.findIndex(
                (c) => !c.stdoutMatches || !c.returnMatches || !c.observationMatches,
              ),
            )
          : 0,
      );
      if (judge && active.current.lease) {
        const saving = service.recordC6Judge(active.current.lease, response, state.sessionEpoch);
        active.current.lease = null;
        await saving;
      }
    } catch (failure) {
      if (token === active.current.token)
        setError(
          failure && typeof failure === 'object' && 'code' in failure
            ? String(failure.code)
            : failure instanceof Error
              ? failure.message
              : '本次操作未完成',
        );
    } finally {
      if (token === active.current.token) setBusy(false);
    }
  };
  const analyze = () => {
    setBlocksRequested(true);
    blockMapping.retry();
  };
  const save = async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    setError('');
    const capturedSource = source,
      capturedInput = input;
    const token = active.current.token;
    try {
      await service.saveC6Draft(
        {
          documentId: document.id,
          nodeRef: { id: `node.${document.nodeId}`, version: '2.0.0' },
          exerciseRef: document.exercise ? { id: document.id, version: '2.0.0' } : null,
          sourceRevision,
          source,
          input,
        },
        savedDocumentRevision,
        state.sessionEpoch,
      );
      const current = service.getState().c6?.rows?.drafts.find((d) => d.documentId === document.id);
      setSavedDocumentRevision(current?.revision ?? savedDocumentRevision);
      if (active.current.token === token && source === capturedSource && input === capturedInput)
        setDirty(false);
    } catch (failure) {
      setError(
        failure && typeof failure === 'object' && 'code' in failure
          ? String(failure.code)
          : '草稿未保存',
      );
    } finally {
      setSavingDraft(false);
    }
  };
  const blocksChanged = (program: BlockProgram | null) => {
    if (!currentMapping || mapping || busy || mappingError || tooLarge) return;
    if (!program) {
      setBlockCandidate('');
      return;
    }
    try {
      setBlockCandidate(
        generateBlockSource(program, { text: source, bindingMap: [], blockMap: [] }, []).text,
      );
    } catch {
      setError('积木连接或字段不完整，请继续修复；原稿已保留。');
      setBlockCandidate('');
    }
  };
  const title =
    state.c6!.manifest!.nodes.find((n) => n.id === document.nodeId)?.titleDisplay ?? '所属章节';
  const exerciseOnly = Boolean(document.exercise);
  const verdict =
    result && 'cases' in result ? (acceptedC6Proof(result)?.judge?.status ?? result.status) : null;
  return (
    <div
      className="c6-workbench"
      data-document-id={document.id}
      data-practice-pane={exerciseOnly ? practicePane : undefined}
    >
      <Link className="text-link" to={c6NodePath(state.c6!.index!, document.nodeId)}>
        返回 {title}
      </Link>
      <PageHeading
        kicker={document.exercise ? 'C 配套执行练习' : reading ? 'C 程序阅读' : 'C 程序运行'}
        title={document.title}
      />
      {exerciseOnly && (
        <div className="c6-practice-switch" role="group" aria-label="练习视图">
          {(['question', 'code', ...(showBlocks ? (['blocks'] as const) : [])] as const).map(
            (pane) => (
              <button
                key={pane}
                type="button"
                className="button button-secondary"
                aria-pressed={practicePane === pane}
                onClick={() => {
                  setPracticePane(pane);
                  if (pane === 'code') requestAnimationFrame(() => area.current?.focus());
                }}
              >
                {pane === 'question' ? '题目' : pane === 'code' ? '代码' : '积木'}
              </button>
            ),
          )}
        </div>
      )}
      <div className={exerciseOnly ? 'c6-exercise-shell' : undefined}>
        {document.exercise && (
          <section className="c6-exercise-description" aria-label="题目和样例" tabIndex={0}>
            <h2>题目描述</h2>
            <p>{document.exercise.prompt}</p>
            <p>{document.exercise.nodeSpecificRequirement}</p>
            <PracticeExamples
              key={document.id}
              inputFormat={document.exercise.inputContract}
              outputFormat={document.exercise.outputContract}
              samples={document.exercise.tests.map((test) => ({
                input: test.stdin,
                output: test.expectedStdout,
              }))}
            />
            <details>
              <summary>提示与边界</summary>
              <ul>
                {document.exercise.hints.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <p>{document.exercise.boundaryExplanation}</p>
            </details>
          </section>
        )}
        <div
          className={`c6-practice-body${exerciseOnly && showBlocks ? ' c6-practice-layout' : ''}`}
        >
          {exerciseOnly && (
            <section className="card oj-answer" aria-label="提交代码">
              <h2>提交代码</h2>
              <p>C 代码</p>
              <CodeEditor
                ref={area}
                label="完整 C 源码 · main.c"
                value={source}
                onChange={changeSource}
              />
              <div className="c6-action-row">
                <button
                  className="button button-primary"
                  disabled={
                    busy || tooLarge || !state.capabilities.learning || state.status === 'readonly'
                  }
                  onClick={() => void run(true)}
                >
                  {busy ? '提交中…' : '提交'}
                </button>
                <button
                  className="button button-secondary"
                  disabled={
                    busy ||
                    savingDraft ||
                    tooLarge ||
                    !state.snapshot ||
                    state.status === 'readonly'
                  }
                  onClick={() => void save()}
                >
                  保存草稿
                </button>
                <span className="muted" role="status" data-testid="c6-draft-save-status">
                  {savingDraft
                    ? '正在保存…'
                    : savedDocumentRevision > 0 && !dirty
                      ? '草稿已保存'
                      : ''}
                </span>
                {blockPreference.value !== 'hide' && (
                  <button
                    className="button button-secondary"
                    disabled={busy || tooLarge}
                    onClick={() => void analyze()}
                  >
                    同步到积木
                  </button>
                )}
                {busy && (
                  <button className="button button-secondary" onClick={() => invalidate()}>
                    取消
                  </button>
                )}
              </div>
              {tooLarge && <p role="alert">代码超过32 KiB，请缩短后提交。</p>}
              {verdict && (
                <p
                  className="oj-verdict"
                  role="status"
                  data-testid="oj-verdict"
                  data-verdict={verdict}
                >
                  {verdict === 'passed'
                    ? '通过'
                    : verdict === 'failed'
                      ? '未通过'
                      : '提交未完成，请重试'}
                </p>
              )}
              {error && <p role="alert">{error}。代码已保留，请重试。</p>}
              <LearningSaveStatus dirty={dirty} />
            </section>
          )}
          {reading && (
            <section>
              <p className="notice">
                {document.program!.mode === 'reading' && document.program!.boundary}
              </p>
              <p>{document.program!.mode === 'reading' && document.program!.prediction}</p>
              {document.program!.files.map((f) => (
                <section key={f.name}>
                  <h2>{f.name}</h2>
                  <pre className="c6-source-read" tabIndex={0}>
                    <code>{f.source}</code>
                  </pre>
                </section>
              ))}
            </section>
          )}
          {!reading && !exerciseOnly && (
            <>
              <div className="c6-workbench-grid">
                <section className="c6-source-pane">
                  <div className="c6-action-row">
                    <button
                      className="button button-primary"
                      disabled={busy || tooLarge || !validInput}
                      onClick={() => void run(false)}
                    >
                      运行当前代码
                    </button>
                    {document.exercise && (
                      <button
                        className="button button-primary"
                        disabled={
                          busy ||
                          tooLarge ||
                          !state.capabilities.learning ||
                          state.status === 'readonly'
                        }
                        onClick={() => void run(true)}
                      >
                        判定全部四组
                      </button>
                    )}
                    <button
                      className="button button-secondary"
                      disabled={
                        busy ||
                        savingDraft ||
                        tooLarge ||
                        !validInput ||
                        !state.snapshot ||
                        state.status === 'readonly'
                      }
                      onClick={() => void save()}
                    >
                      保存草稿
                    </button>
                    <span className="muted" role="status" data-testid="c6-draft-save-status">
                      {savingDraft
                        ? '正在保存…'
                        : savedDocumentRevision > 0 && !dirty
                          ? '草稿已保存'
                          : ''}
                    </span>
                    {blockPreference.value !== 'hide' && (
                      <button
                        className="button button-secondary"
                        disabled={busy || tooLarge}
                        onClick={() => void analyze()}
                      >
                        同步到积木
                      </button>
                    )}
                    {busy && (
                      <button className="button button-secondary" onClick={() => invalidate()}>
                        取消本次操作
                      </button>
                    )}
                  </div>
                  <p>完整 C 源码 · main.c</p>
                  <CodeEditor
                    ref={area}
                    label="完整 C 源码 · main.c"
                    value={source}
                    onChange={changeSource}
                  />
                  <p className="muted">
                    {sourceBytes} / 32768 字节{dirty ? ' · 有未保存修改' : ''}
                  </p>
                  <label htmlFor="c6-stdin">本次试运行输入（ASCII，最多 256 字节）</label>
                  <textarea
                    id="c6-stdin"
                    className="c6-input-editor"
                    value={input}
                    onChange={(e) => {
                      invalidate();
                      setInput(e.target.value);
                      setDirty(true);
                    }}
                  />
                  {(!validInput || tooLarge) && (
                    <p role="alert">
                      {tooLarge
                        ? '源码超过当前 32KiB 上限，原稿仍保留在编辑区。'
                        : '输入须为 ASCII，且不超过 256 字节。'}
                    </p>
                  )}
                  {busy && <p role="status">正在检查当前代码……</p>}
                  {error && <p role="alert">{error} · 原稿已保留。</p>}
                  <details className="c6-saved-drafts">
                    <summary>管理已保存草稿 · {state.c6!.rows?.drafts.length ?? 0} / 64</summary>
                    <p className="muted">
                      达到上限后，可先删除不再需要的草稿，再保存当前代码。删除草稿不改变已获得的学习记录。
                    </p>
                    {(state.c6!.rows?.drafts ?? []).map((draft) => {
                      const title =
                        state.c6!.manifest!.nodes.find((n) => `node.${n.id}` === draft.nodeRef.id)
                          ?.titleDisplay ?? '课程草稿';
                      return (
                        <details key={draft.documentId}>
                          <summary>
                            {title} · {new Date(draft.updatedAt).toLocaleString('zh-CN')}
                          </summary>
                          <p>
                            <code>{draft.documentId}</code>
                          </p>
                          <pre className="c6-source-read">
                            <code>{draft.source}</code>
                          </pre>
                          <button
                            className="button button-secondary"
                            disabled={state.status === 'saving' || state.status === 'readonly'}
                            onClick={() => {
                              void service
                                .deleteC6Draft(draft.documentId, draft.revision, state.sessionEpoch)
                                .then(() => {
                                  if (draft.documentId === document.id) setSavedDocumentRevision(0);
                                })
                                .catch(() => setError('草稿未能删除，请重新读取档案后再试。'));
                            }}
                          >
                            删除此草稿
                          </button>
                        </details>
                      );
                    })}
                  </details>
                </section>
                <section className="c6-result-pane" aria-label="当前运行结果">
                  {!result && (
                    <StatePanel
                      kind="empty"
                      title="等待运行"
                      description="运行后可逐步查看当前代码的输出、调用栈与虚拟内存。"
                    />
                  )}
                  {result && 'cases' in result && (
                    <section>
                      <h2>
                        {result.status === 'passed'
                          ? '四组全部通过'
                          : result.status === 'failed'
                            ? '本次尚未通过'
                            : '本次判题未完成'}
                      </h2>
                      <div className="c6-case-tabs" role="group" aria-label="选择判题组">
                        {result.cases.map((c, i) => (
                          <button
                            className={i === caseIndex ? 'c6-case-selected' : ''}
                            key={c.caseKey}
                            aria-pressed={i === caseIndex}
                            onClick={() => setCaseIndex(i)}
                          >
                            第 {i + 1} 组 ·{' '}
                            {c.stdoutMatches && c.returnMatches && c.observationMatches
                              ? '通过'
                              : '待修正'}
                          </button>
                        ))}
                      </div>
                      {result.cases[caseIndex] && (
                        <p className="muted">
                          输出：{result.cases[caseIndex].stdoutMatches ? '符合' : '不符'} · 返回值：
                          {result.cases[caseIndex].returnMatches ? '符合' : '不符'} · 本节教学目标：
                          {result.cases[caseIndex].observationMatches ? '符合' : '尚未满足'}
                        </p>
                      )}
                    </section>
                  )}
                  {packet && (
                    <TraceView
                      key={`${packet.identity.runId}:${caseIndex}`}
                      result={packet}
                      source={source}
                      locate={locate}
                      disabled={busy}
                      capture={{
                        result: result!,
                        caseIndex,
                        title: document.title,
                        documentId: document.id,
                        nodeRef: { id: `node.${document.nodeId}`, version: '2.0.0' },
                        exerciseId: document.exercise ? document.id : null,
                      }}
                    />
                  )}
                </section>
              </div>
            </>
          )}
          {!reading && showBlocks && (
            <section
              className={`c6-block-pane${exerciseOnly ? ' card' : ''}`}
              aria-busy={mapping || !currentMapping}
            >
              <div className="c6-block-title">
                <h2>积木视图</h2>
                <div className="c6-block-status">
                  {mappingError ? (
                    <p role="alert">
                      {mappingError}{' '}
                      <button className="text-link" onClick={analyze}>
                        重试同步
                      </button>
                    </p>
                  ) : (
                    currentMapping && !mapped && <p className="muted">仅支持部分语法，原稿保留。</p>
                  )}
                </div>
              </div>
              <Suspense fallback={<div className="c6-block-placeholder" />}>
                <BlockWorkspace
                  value={presentedBlocks ?? emptyBlocks}
                  onChange={blocksChanged}
                  disabled={busy || mapping || !currentMapping || !!mappingError || tooLarge}
                />
              </Suspense>
              {blockCandidate && blockCandidate !== source && (
                <details open>
                  <summary>积木生成的完整程序预览</summary>
                  <p>生成程序会重新排版，当前原稿中的注释不会复制；应用后可撤销这次替换。</p>
                  <pre className="c6-source-read">
                    <code>{blockCandidate}</code>
                  </pre>
                  <button
                    className="button button-primary"
                    onClick={() => {
                      setUndoBlockSource(source);
                      changeSource(blockCandidate);
                    }}
                  >
                    应用生成代码
                  </button>
                </details>
              )}
              <details className="c6-block-diagnostics">
                <summary>代码提示</summary>
                <div>
                  {currentMapping && !mapped && (
                    <p>当前代码暂不能完整转为积木。可另行搭建积木，预览后应用；原稿会保留。</p>
                  )}
                  {currentMapping && edit.diagnostics.length > 0 && (
                    <DiagnosticPanel
                      diagnostics={edit.diagnostics.map((d) => ({
                        code: d.code,
                        location: {
                          kind: 'source',
                          nodeId: 'unmapped',
                          byteRange: d.byteRange,
                          edge: 'whole',
                        },
                      }))}
                      source={{ text: source, language: 'c', nodes: edit.nodeMap }}
                      onLocateSource={(r) => locate(r.start, r.end)}
                    />
                  )}
                </div>
              </details>
            </section>
          )}
        </div>
      </div>
      {undoBlockSource !== null && (
        <button
          className="text-link"
          onClick={() => {
            changeSource(undoBlockSource);
            setUndoBlockSource(null);
          }}
        >
          撤销上次积木代码替换
        </button>
      )}
      {!exerciseOnly && <LearningSaveStatus dirty={dirty} />}
    </div>
  );
}
