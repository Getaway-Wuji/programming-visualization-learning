import { StepDetailControl } from '../components/StepDetailControl';
import { CaseWalkthrough } from '../components/CaseWalkthrough';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage, PageHeading } from '../components/Ui';
import { Workbench } from '../workbench/Workbench';
import { useLearning } from '../learning/react';
import { createSourceIndex } from '../player/source-location';
import {
  parseClassicInput,
  prepareClassic,
  classicCase,
  classicCases,
  classicCatalog,
  type ClassicCase,
} from './content';
import { ClassicController } from './controller';
import { classicExplanation } from './presentation';
import { ClassicState } from './ClassicState';
import { MemoryPanel } from '../memory/MemoryPanel';
import { StackPanel } from '../stack/StackPanel';
import { projectMemoryStep } from '../engine/memory-protocol';
import '../memory/memory.css';
import '../algorithms/algorithms.css';
import './classics.css';

function ClassicWorkspace({ spec }: { spec: ClassicCase }) {
  const { service } = useLearning(),
    [controller] = useState(() => new ClassicController(undefined, 'key')),
    snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot),
    { view, result, request, status } = snapshot;
  const [mode, setMode] = useState<'values' | 'memory' | 'stack'>('values');
  const [draft, setDraft] = useState(spec.defaultInput.join(' ')),
    parsed = parseClassicInput(spec, draft),
    prepared = useMemo(
      () => prepareClassic(spec, parsed.valid ? draft : spec.defaultInput.join(' ')),
      [spec, draft, parsed.valid],
    );
  const source = request?.source ?? (parsed.valid ? prepared.source : ''),
    explanation = result ? classicExplanation(result, view.cursor, prepared) : null,
    terminal = result && view.cursor === view.length ? result.terminal : null;
  const highlight = terminal?.code && terminal.byteRange ? terminal.byteRange : view.byteRange,
    range = useMemo(
      () => (highlight ? createSourceIndex(source).range(highlight) : null),
      [source, highlight],
    );
  const previous = useMemo(
    () =>
      view.state && result?.trace && view.cursor > 0
        ? projectMemoryStep(view.state, result.trace.steps[view.cursor - 1], result.types, true)
        : null,
    [view, result],
  );
  const completeOutput = useMemo(
    () =>
      result?.trace?.steps
        .flatMap((s) => s.changes.flatMap((c) => (c.op === 'output' ? [c.append] : [])))
        .join('') ?? '',
    [result],
  );
  const stop = useCallback(
    (visible: boolean) => {
      if (!visible) controller.pause();
    },
    [controller],
  );
  useEffect(() => {
    const unsubscribe = service.subscribeSessionInvalidation(() => controller.invalidate()),
      hidden = () => {
        if (document.visibilityState !== 'visible') controller.pause();
      };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', hidden);
      controller.invalidate();
    };
  }, [controller, service]);
  const change = (text: string) => {
      controller.invalidate();
      setDraft(text);
    },
    active = Boolean(view.state);
  return (
    <div
      className="classic-workspace"
      data-testid="classic-workspace"
      data-state={status}
      data-run-id={view.identity?.runId ?? ''}
      data-source-revision={view.identity?.sourceRevision ?? ''}
      data-cursor={view.cursor}
      data-length={view.length}
    >
      <Breadcrumbs
        items={[
          { label: '学习首页', to: '/' },
          { label: '算法与演示', to: '/cases' },
          { label: spec.title },
        ]}
      />
      <PageHeading
        kicker="C++ · 经典问题 · 真实回放"
        title={spec.title}
        description={spec.description}
      />
      <section className="classic-input" aria-label="经典问题输入">
        <label htmlFor="classic-commands">输入整数</label>
        <textarea
          id="classic-commands"
          data-testid="classic-input"
          aria-describedby="classic-input-help"
          aria-invalid={!parsed.valid}
          value={draft}
          maxLength={128}
          rows={2}
          spellCheck={false}
          onChange={(e) => change(e.target.value)}
        />
        <p id="classic-input-help">
          {spec.inputHelp} 用空格或逗号分隔，恰{spec.inputArity}
          项。修改输入撤销旧运行，观察不计课程或积分。
        </p>
        {parsed.valid ? (
          <p data-testid="classic-input-count">
            {parsed.values.length} / {spec.inputArity}项输入
          </p>
        ) : (
          <p role="alert">{parsed.issue}</p>
        )}
        <div className="inline-actions">
          <button
            className="button button-primary"
            disabled={!parsed.valid || status === 'running'}
            onClick={() => void controller.execute(spec, draft)}
          >
            运行C++经典案例
          </button>
          <button className="button" onClick={() => change(spec.defaultInput.join(' '))}>
            恢复示例
          </button>
          <label>
            边界样例{' '}
            <select
              aria-label="经典边界样例"
              value=""
              onChange={(e) => {
                const selected = spec.boundarySamples.find((item) => item.id === e.target.value);
                if (selected) change(selected.input.join(' '));
              }}
            >
              <option value="">选择样例</option>
              {spec.boundarySamples.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
          {status === 'running' && (
            <button className="button" onClick={() => controller.cancel()}>
              取消运行
            </button>
          )}
        </div>
        {status === 'running' && <p role="status">正在执行并校验真实C++轨迹……</p>}
        {snapshot.error && (
          <p role="alert" data-testid="classic-error">
            本次未接收轨迹：{snapshot.error}。可显式重新运行。
          </p>
        )}
        {result && !result.trace && (
          <p role="alert">本次未生成轨迹：{result.terminal.code}。没有可播放的旧结果。</p>
        )}
        {result?.trace?.completeness === 'prefix' && (
          <p role="status">
            保留真实执行前缀：{result.terminal.code}。末步显示停止位置，后退恢复。
          </p>
        )}
      </section>
      <Workbench
        kind="visualize"
        firstLabel="实际C++源码"
        secondLabel="数值与过程"
        onSecondVisibility={stop}
        first={
          <section className="sort-source">
            <h2>{request ? '本次实际C++源码' : '待执行C++预览'}</h2>
            <p>
              原文完整执行，固定参数经cin读取。
              {range
                ? `当前第${range.start.line}行，第${range.start.column}列。`
                : '尚无当前源码步骤。'}
            </p>
            <pre tabIndex={0} aria-label="本次实际执行的C++源码" data-testid="classic-source">
              {range ? (
                <>
                  {source.slice(0, range.utf16Range.start)}
                  <mark
                    data-testid="classic-source-highlight"
                    data-byte-start={range.byteRange.start}
                    data-byte-end={range.byteRange.end}
                  >
                    {source.slice(range.utf16Range.start, range.utf16Range.end)}
                  </mark>
                  {source.slice(range.utf16Range.end)}
                </>
              ) : (
                source
              )}
            </pre>
            <details>
              <summary>复制完整源码</summary>
              <textarea
                aria-label="可复制的完整经典C++源码"
                readOnly
                value={source}
                rows={8}
                spellCheck={false}
              />
            </details>
          </section>
        }
        second={
          <section
            className="sort-stage classic-stage"
            tabIndex={0}
            aria-label="经典问题执行观察"
            onKeyDown={(event) => {
              if (
                event.target !== event.currentTarget ||
                event.repeat ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              )
                return;
              if (event.key === ' ') {
                event.preventDefault();
                controller.toggle();
              }
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                controller.step(event.key === 'ArrowRight' ? 1 : -1);
              }
            }}
          >
            <h2>数值与过程</h2>
            <div className="player-controls" aria-label="经典播放控制">
              <div className="control-group">
                <button
                  className="button button-small"
                  disabled={!active || view.cursor === 0}
                  onClick={() => controller.step(-1)}
                >
                  后退
                </button>
                <button
                  className="button button-small"
                  disabled={!active || view.cursor === view.length}
                  onClick={() => controller.toggle()}
                >
                  {view.playing ? '暂停' : '播放'}
                </button>
                <button
                  className="button button-small"
                  disabled={!active || view.cursor === view.length}
                  onClick={() => controller.step(1)}
                >
                  前进
                </button>
                <button
                  className="button button-small"
                  disabled={!active}
                  onClick={() => controller.replay()}
                >
                  回到初态
                </button>
                <button
                  className="button button-small"
                  disabled={!active}
                  onClick={() => controller.seek(view.length)}
                >
                  查看末步
                </button>
              </div>
              <label>
                速度{' '}
                <select
                  aria-label="经典播放速度"
                  disabled={!active}
                  value={snapshot.rate}
                  onChange={(e) => controller.setRate(Number(e.target.value))}
                >
                  {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                </select>
              </label>
              <StepDetailControl
                detail={snapshot.detail}
                onChange={(detail) => controller.setDetail(detail)}
              />
              <label className="sort-seek">
                {snapshot.detail === 'key'
                  ? `关键步骤 ${snapshot.keyPosition} / ${snapshot.keyLength}`
                  : `步骤 ${view.cursor} / ${view.length}`}
                <input
                  type="range"
                  aria-label="经典执行步骤"
                  min={0}
                  max={(snapshot.detail === 'key' ? snapshot.keyLength : view.length) || 1}
                  value={snapshot.detail === 'key' ? snapshot.keyPosition : view.cursor}
                  disabled={!active}
                  onChange={(e) => controller.seekDisplayed(Number(e.target.value))}
                />
              </label>
              <span role="status">
                {view.playing ? '正在播放' : active ? '已暂停' : '等待运行'}
              </span>
            </div>
            {view.state && result ? (
              <>
                <section className="sort-explanation" data-testid="classic-explanation">
                  <h3>{explanation?.title}</h3>
                  <p>{explanation?.explanation}</p>
                  <p className="muted">
                    真实步骤：{view.stepKind ?? '初态'}。聚焦本区后用空格播放/暂停、左右键单步。
                  </p>
                </section>
                <div className="step-counters">
                  {Object.entries(view.state.counters).map(([key, value]) => (
                    <span key={key}>
                      {
                        {
                          comparisons: '比较',
                          scalarWrites: '变量写入',
                          arrayWrites: '数组写入',
                          swaps: '交换',
                        }[key]
                      }{' '}
                      <strong data-testid={`classic-counter-${key}`}>{value}</strong>
                    </span>
                  ))}
                </div>
                <p className="muted">计数含初始化和同值写，不把没有cell差异当作没赋值。</p>
                <label>
                  当前视图{' '}
                  <select
                    aria-label="经典观察视图"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                  >
                    <option value="values">当前数值与盘图</option>
                    <option value="memory">内存对象</option>
                    <option value="stack">调用栈</option>
                  </select>
                </label>
                {mode === 'values' ? (
                  <ClassicState state={view.state} result={result} spec={spec} />
                ) : mode === 'memory' ? (
                  <MemoryPanel state={view.state} previous={previous} result={result} />
                ) : (
                  <StackPanel
                    state={view.state}
                    previous={previous}
                    result={result}
                    source={source}
                    cursor={view.cursor}
                  />
                )}
                <h3>当前实际输出</h3>
                <pre
                  className="classic-output"
                  tabIndex={0}
                  aria-label="当前经典程序输出"
                  data-testid="classic-output"
                >
                  {view.state.output || '（无输出）'}
                </pre>
                {terminal && (
                  <p
                    data-testid="classic-terminal"
                    role={
                      terminal.status === 'completed' && terminal.returnValue === 0
                        ? 'status'
                        : 'alert'
                    }
                  >
                    {terminal.status === 'completed'
                      ? terminal.returnValue === 0
                        ? '程序正常结束；素数/回文的0表示正常判断为否。'
                        : `程序返回${terminal.returnValue}，输入域保护已停止。`
                      : `程序在此停止：${terminal.code}，可回退真实前缀。`}
                  </p>
                )}
              </>
            ) : (
              <p>输入合法整数并运行，再核对真实数值、盘位置和调用栈。</p>
            )}
            {result && (
              <details className="sort-complete-output">
                <summary>完整执行结果（与当前步骤分开）</summary>
                <p>
                  本次终态：{result.terminal.status}；返回值{result.terminal.returnValue ?? '无'}
                  {result.terminal.code ? ` · ${result.terminal.code}` : ''}
                  。程序正常结束与素数/回文的判断结果分别查看。
                </p>
                <pre data-testid="classic-full-output">{completeOutput || '（无输出）'}</pre>
              </details>
            )}
          </section>
        }
      />
      <details className="sort-method">
        <summary>算法、输入编码与观察目标</summary>
        <p>
          案例{spec.id}@{spec.version}；程序{spec.programId}@{spec.programVersion}；目录
          {classicCatalog.id}@{classicCatalog.version}。
        </p>
        <p>{spec.variant}</p>
        <p>{spec.complexity}</p>
        <p>{spec.extraSpace}</p>
        <ul>
          {spec.objectives.map((goal) => (
            <li key={goal}>{goal}</li>
          ))}
        </ul>
        <p>
          受支持C++教学子集的真实Rust执行；本例没有挑战、双算法对比或快照导出，不记录输入、源码或轨迹到学习档案。
        </p>
      </details>
      <nav className="inline-actions" aria-label="切换四个经典案例">
        {classicCases.map((item) => (
          <Link
            className="text-link"
            key={item.id}
            aria-current={item.id === spec.id ? 'page' : undefined}
            to={`/classics/${item.id}`}
          >
            {item.title}
          </Link>
        ))}
        <Link className="text-link" to="/cases">
          返回算法与演示 →
        </Link>
      </nav>
      <CaseWalkthrough caseId={spec.id} />
    </div>
  );
}
export default function ClassicPage() {
  const { classicId = '' } = useParams(),
    spec = classicCase(classicId);
  return spec ? (
    <ClassicWorkspace key={spec.id} spec={spec} />
  ) : (
    <MissingPage title="找不到这个经典案例" backTo="/cases" backLabel="返回算法与演示" />
  );
}
