import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage, PageHeading } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { currentCourseBundle } from '../content/course-bundle';
import { Workbench, type WorkbenchHandle } from '../workbench/Workbench';
import { MemoryBasicView, MemoryPanel } from '../memory/MemoryPanel';
import { projectMemoryStep } from '../engine/memory-protocol';
import { DiagnosticPanel } from '../diagnostics/DiagnosticPanel';
import { DebugSource } from '../debug/DebugSource';
import {
  hasMemoryBugLearningSupplement,
  memoryBugQuestion,
  memoryBugQuestions,
  type MemoryBugQuestion,
} from './content';
import { MemoryBugSession } from './session';
import '../memory/memory.css';
import './memory-bugs.css';
import { c6IndependentSupplement } from '../c6-learning/supplements';
const checkLabels: Record<string, string> = {
  'exit-zero': '正常结束并返回0',
  'stdout-exact': '输出逐字正确',
  'input-consumed': '实际读取全部输入',
  'teaching-target': '实际指针访问或循环目标',
};

export function MemoryBugCatalog() {
  const { state } = useLearning();
  const available = !!c6IndependentSupplement() || !!currentCourseBundle()?.memoryBugSupplement;
  return (
    <>
      {(['pointer', 'loop'] as const).map((category) => (
        <section className="bug-category" key={category}>
          <h2>{category === 'pointer' ? '野指针与生命期' : '死循环与终止'}</h2>
          <p>受限C++代码关卡 · 真实内存解释执行 · 不提供积木映射。</p>
          <div className="bug-list">
            {memoryBugQuestions
              .filter((q) => q.category === category)
              .map((q) => (
                <article key={q.exerciseRef.id}>
                  <h3>{q.title}</h3>
                  <p>{q.prompt}</p>
                  <p>
                    {state.projection?.exercises.some(
                      (e) => e.ref.id === q.exerciseRef.id && e.passed,
                    )
                      ? '已保存通过'
                      : '尚未保存通过'}{' '}
                    · 4组真实测试 · 首次10分
                  </p>
                  {available ? (
                    <Link className="button" to={`/bugs/memory/${q.exerciseRef.id}`}>
                      修复：{q.title}
                    </Link>
                  ) : (
                    <p>内存关卡资源尚未就绪。</p>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
function MemoryBugWorkspace({ question }: { question: MemoryBugQuestion }) {
  const { state: learning, service } = useLearning();
  const owner = useMemo(
    () =>
      new MemoryBugSession(
        question,
        {
          context: () => {
            const state = service.getState(),
              catalog = state.practiceCatalog;
            return {
              catalog:
                catalog && hasMemoryBugLearningSupplement(catalog.exercises) ? catalog : null,
              epoch: state.sessionEpoch,
            };
          },
          save: (fact, epoch) => service.recordPracticePass(fact, epoch),
          saveAttempt: (fact, epoch) => service.recordPracticeAttempt(fact, epoch),
        },
        {
          context: () => service.editorHistoryContext(),
          read: (ctx) => service.readEditorHistory(ctx),
          save: (ctx, record, update) => service.saveEditorHistory(ctx, record, update),
        },
      ),
    [question, service],
  );
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const trace = useSyncExternalStore(owner.view.subscribe, owner.view.getSnapshot);
  const history = useSyncExternalStore(owner.history.subscribe, owner.history.getSnapshot);
  const [selected, setSelected] = useState(''),
    [hints, setHints] = useState(0),
    [mode, setMode] = useState<'basic' | 'memory'>('memory');
  const bench = useRef<WorkbenchHandle>(null),
    sourcePanel = useRef<HTMLDivElement>(null);
  const generation = learning.snapshot?.meta.generation;
  const traceVisibility = useCallback(
    (visible: boolean) => {
      if (!visible) owner.view.pause();
    },
    [owner],
  );
  useEffect(() => {
    if (generation) void owner.startHistory();
    return () => owner.invalidate();
  }, [owner, generation, learning.sessionEpoch]);
  useEffect(() => {
    const stop = () => {
      if (document.visibilityState !== 'visible') owner.view.pause();
    };
    document.addEventListener('visibilitychange', stop);
    return () => document.removeEventListener('visibilitychange', stop);
  }, [owner]);
  const { view, result } = trace;
  const previous = useMemo(
    () =>
      view.state && result?.trace && view.cursor > 0
        ? projectMemoryStep(view.state, result.trace.steps[view.cursor - 1], result.types, true)
        : null,
    [view, result],
  );
  const busy = state.phase === 'running',
    available = !!c6IndependentSupplement() || !!currentCourseBundle()?.memoryBugSupplement;
  const atEnd = !!result && view.cursor === view.length;
  const code = result?.terminal.code;
  const chosen = history.items.find((r) => r.entryId === selected) ?? history.items[0];
  const passed = learning.projection?.exercises.some(
    (e) => e.ref.id === question.exerciseRef.id && e.passed,
  );
  const saveState =
    state.save === 'unsaved' && passed && learning.status === 'ready' && learning.pendingCount === 0
      ? 'saved'
      : state.save;
  const range =
    atEnd && code ? result?.terminal.byteRange : (trace.hit?.byteRange ?? view.byteRange);
  return (
    <div
      data-page-id="PAGE-14-4"
      data-testid="memory-bug-session"
      data-state={state.phase}
      data-save-state={saveState}
      data-elapsed-ms={state.elapsedMs ?? ''}
      data-cursor={view.cursor}
      data-length={view.length}
      data-run-id={view.identity?.runId ?? ''}
    >
      <Breadcrumbs
        items={[
          { label: 'C 语言课程', to: '/courses' },
          { label: 'Bug 闯关', to: '/bugs' },
          { label: question.title },
        ]}
      />
      <PageHeading
        kicker="受限 C++ · 真实内存关卡"
        title={question.title}
        description={question.prompt}
      />
      <p>{passed ? '已保存通过' : '尚未保存通过'} · 4组真实测试 · 首次10分，重复0分。</p>
      <p>
        本关使用已支持的C++指针与循环子集，代码超出20类积木映射；运行才检查。地址是教学虚拟地址。修改源码或输入会清除旧运行。
      </p>
      <LearningSaveStatus />
      {!available && <p role="status">受审关卡资源不可用，不能运行或保存本关；原档案保留。</p>}
      <section className="memory-bug-help" aria-label="内存关卡提示与解析">
        <button className="button" disabled={hints === 3} onClick={() => setHints(hints + 1)}>
          {hints === 3 ? '三层提示已展开' : `查看第 ${hints + 1} 层提示`}
        </button>
        {hints > 0 && (
          <ol>
            {question.hints.slice(0, hints).map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ol>
        )}
        <details>
          <summary>查看修复解析与一种参考写法</summary>
          <p>{question.explanation}</p>
          <pre tabIndex={0}>
            <code>{question.solutionSource}</code>
          </pre>
          <p>不同的正确写法也可通过；判定实际执行，不比较源码文本。</p>
        </details>
      </section>
      <div className="memory-bug-actions">
        <label>
          测试输入{' '}
          <select
            aria-label="关卡测试输入"
            value={state.caseKey}
            onChange={(e) => owner.selectCase(e.target.value)}
          >
            {question.tests.map((t) => (
              <option key={t.caseKey} value={t.caseKey}>
                {t.caseKey} · {JSON.stringify(t.input)}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={busy || !available} onClick={() => void owner.run()}>
          运行本组
        </button>
        <button
          className="button button-primary"
          disabled={busy || !available}
          onClick={() => void owner.run(true)}
        >
          提交全部4组
        </button>
        <button className="button" disabled={!busy} onClick={() => owner.cancel()}>
          取消提交
        </button>
      </div>
      <p>
        运行本组不保存通过或积分；提交全部测试且实际教学目标满足后才保存。整次提交共用原1000ms截止，每组保留原百万fuel及20,000步等上限。
      </p>
      <details
        className="editor-history"
        data-testid="memory-bug-history"
        data-save-state={history.status}
      >
        <summary>
          编辑历史 ·{' '}
          {history.status === 'ready'
            ? `${history.items.length}条已保存`
            : history.status === 'saving'
              ? '正在保存'
              : '尚未保存'}
        </summary>
        <p>
          全站最近100条、合计8MiB；保存原文与该组输入。这里没有积木映射，恢复不代表代码已正确，必须重新运行。
        </p>
        <label>
          历史版本{' '}
          <select
            aria-label="内存关卡历史版本"
            value={chosen?.entryId ?? ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            {!chosen && <option value="">暂无已保存历史</option>}
            {history.items.map((r) => (
              <option key={r.entryId} value={r.entryId}>
                {r.createdAt} · 版本{r.documentRevision} · {r.reason}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={!chosen}
          onClick={() => {
            if (chosen) owner.restore(chosen.entryId);
          }}
        >
          恢复所选版本
        </button>
        {history.status === 'unsaved' && (
          <button className="button" onClick={() => void owner.history.retry()}>
            重试保存编辑历史
          </button>
        )}
        {history.message && <p role="status">{history.message}</p>}
      </details>
      <Workbench
        ref={bench}
        kind="practice"
        firstLabel="编辑 C++"
        secondLabel="真实执行复盘"
        onSecondVisibility={traceVisibility}
        first={
          <section className="workbench-panel memory-bug-editor">
            <h2>编辑本关 C++ 代码</h2>
            <textarea
              aria-label="编辑关卡 C++ 代码"
              spellCheck={false}
              value={state.source}
              onChange={(e) => owner.edit(e.target.value)}
            />
            <p>完整当前原文；保留std::cin的真实输入。尚未运行时，没有新诊断或通过判定。</p>
          </section>
        }
        second={
          <section className="workbench-panel memory-bug-replay" aria-label="内存关卡真实复盘">
            <h2>本次执行与复盘</h2>
            {!result ? (
              <p>尚无当前有效轨迹。运行后可前进、后退或查看终止前缀。</p>
            ) : (
              <>
                <p>
                  显示实际组：{state.summaries.at(-1)?.caseKey} ·{' '}
                  {result.terminal.status === 'completed'
                    ? '程序正常结束'
                    : result.terminal.status === 'limited'
                      ? '程序因资源上限停止'
                      : '程序发生错误'}{' '}
                  · {view.cursor}/{view.length}步
                </p>
                <div className="memory-bug-actions">
                  <button
                    className="button"
                    disabled={!view.state || view.cursor === 0}
                    onClick={() => owner.view.seek(0)}
                  >
                    回到开始
                  </button>
                  <button
                    className="button"
                    disabled={!view.state || view.cursor === 0}
                    onClick={() => owner.view.step(-1)}
                  >
                    后退
                  </button>
                  <button
                    className="button"
                    disabled={!view.state || view.cursor === view.length}
                    onClick={() => owner.view.toggle()}
                  >
                    {view.playing ? '暂停' : '播放'}
                  </button>
                  <button
                    className="button"
                    disabled={!view.state || view.cursor === view.length}
                    onClick={() => owner.view.step(1)}
                  >
                    前进
                  </button>
                  <button
                    className="button"
                    disabled={!view.state}
                    onClick={() => owner.view.seek(view.length)}
                  >
                    查看终止位置
                  </button>
                </div>
                {view.state && (
                  <>
                    <label>
                      执行游标{' '}
                      <input
                        aria-label="内存关卡执行游标"
                        type="range"
                        min={0}
                        max={view.length}
                        value={view.cursor}
                        onChange={(e) => owner.view.seek(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      视图{' '}
                      <select
                        aria-label="内存关卡视图"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as typeof mode)}
                      >
                        <option value="memory">内存</option>
                        <option value="basic">变量</option>
                      </select>
                    </label>
                    {mode === 'memory' ? (
                      <MemoryPanel state={view.state} previous={previous} result={result} />
                    ) : (
                      <MemoryBasicView state={view.state} result={result} />
                    )}
                    <p>
                      当前输出：
                      <output data-testid="memory-bug-output">
                        {view.state.output || '（空）'}
                      </output>
                    </p>
                  </>
                )}
                <div ref={sourcePanel}>
                  <DebugSource
                    source={state.source}
                    byteRange={range ?? null}
                    breakpoints={trace.breakpoints}
                    visitedLines={trace.visitedLines}
                    ready={!!view.state}
                    onToggle={(line) => owner.view.toggleBreakpoint(line)}
                  />
                </div>
                {code && (
                  <>
                    <DiagnosticPanel
                      diagnostics={[
                        {
                          code,
                          location: result.terminal.byteRange
                            ? { kind: 'source', byteRange: result.terminal.byteRange }
                            : undefined,
                        },
                      ]}
                      source={{ text: state.source, language: 'cpp', nodes: result.nodeMap }}
                      onLocateSource={() => {
                        owner.view.seek(view.length);
                        sourcePanel.current?.querySelector('pre')?.focus();
                        sourcePanel.current
                          ?.querySelector('mark')
                          ?.scrollIntoView({ block: 'center' });
                      }}
                    />
                    {result.trace && <p>已保留真实停止前缀；后退可恢复完整状态。</p>}
                  </>
                )}
              </>
            )}
          </section>
        }
      />
      {state.summaries.length > 0 && (
        <section aria-label="本次真实测试反馈">
          <h2>本次测试反馈</h2>
          <ul>
            {state.summaries.map((s) => (
              <li key={s.caseKey}>
                <details>
                  <summary>
                    {s.caseKey}：{s.met ? '满足' : '未满足'}
                    {s.code ? ` · ${s.code}` : ''}
                  </summary>
                  <ul>
                    {s.checks.map((check) => (
                      <li key={check.id}>
                        {checkLabels[check.id] ?? check.id}：{check.met ? '满足' : '未满足'}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </section>
      )}
      {state.message && <p role="status">{state.message}</p>}
      {state.phase === 'failed' && /^E_[A-Z_]+$/.test(state.message) && (
        <DiagnosticPanel
          diagnostics={[{ code: state.message }]}
          source={{ text: state.source, language: 'cpp' }}
        />
      )}
      {state.phase === 'passed' && (
        <p>
          全部4组真实判定满足。
          {saveState === 'saved'
            ? '通过已保存；首次奖励按学习事件去重。'
            : saveState === 'unsaved'
              ? '尚未保存，请使用上方重试未保存操作。'
              : '本次未保存学习结果。'}
        </p>
      )}
      {state.phase === 'unmet' && state.save !== 'idle' && (
        <p data-testid="memory-attempt-save">
          {saveState === 'saved'
            ? '本次有效错误摘要已保存。'
            : '错误摘要尚未保存，请重试未保存操作。'}{' '}
          <Link className="text-link" to="/notebook">
            查看错题与陌生点
          </Link>
        </p>
      )}
      <Link className="text-link" to="/bugs">
        返回Bug关卡目录
      </Link>
    </div>
  );
}
export default function MemoryBugPage() {
  const { exerciseId } = useParams();
  const question = exerciseId && memoryBugQuestion(exerciseId);
  return question ? (
    <MemoryBugWorkspace key={question.exerciseRef.id} question={question} />
  ) : (
    <MissingPage title="找不到这个内存关卡" backTo="/bugs" backLabel="返回关卡目录" />
  );
}
