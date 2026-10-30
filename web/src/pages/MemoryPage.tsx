import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useLocation } from 'react-router';
import { Breadcrumbs, PageHeading } from '../components/Ui';
import { Workbench } from '../workbench/Workbench';
import { MemoryWorkspaceController } from '../memory/controller';
import { memoryExamples } from '../memory/examples';
import { MemoryBasicView, MemoryPanel } from '../memory/MemoryPanel';
import { memoryStepLabels } from '../memory/presentation';
import { DiagnosticPanel } from '../diagnostics/DiagnosticPanel';
import { projectMemoryStep } from '../engine/memory-protocol';
import { StackPanel } from '../stack/StackPanel';
import { parseStackInput, stackExamples } from '../stack/examples';
import { DebugSource } from '../debug/DebugSource';
import '../memory/memory.css';
import { useLearning } from '../learning/react';
import { AchievementStatus, useAchievements } from '../achievements/react';

const observations = [...memoryExamples, ...stackExamples];

export default function MemoryPage() {
  const sourcePanel = useRef<HTMLElement>(null);
  const tracePanel = useRef<HTMLElement>(null);
  const traceVisible = useRef(true);
  const { service } = useLearning();
  const achievements = useAchievements();
  const [controller] = useState(() => new MemoryWorkspaceController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const query = new URLSearchParams(useLocation().search);
  const [exampleId, setExampleId] = useState(() =>
    observations.some((item) => item.id === query.get('example'))
      ? query.get('example')!
      : 'pointers',
  );
  const example = observations.find((item) => item.id === exampleId)!;
  const recursive = stackExamples.some((item) => item.id === exampleId);
  const [draft, setDraft] = useState('4 2 9');
  const [diskDraft, setDiskDraft] = useState('3');
  const [sortDraft, setSortDraft] = useState('4 2 9 1 5');
  const [mode, setMode] = useState(() =>
    ['basic', 'memory', 'stack'].includes(query.get('view') ?? '') ? query.get('view')! : 'basic',
  );
  const { view, result, status, rate } = snapshot;
  useEffect(() => {
    controller.setSource(example.source, example.language);
  }, [controller, example.source, example.language]);
  const previous = useMemo(
    () =>
      view.state && result?.trace && view.cursor > 0
        ? projectMemoryStep(view.state, result.trace.steps[view.cursor - 1], result.types, true)
        : null,
    [view, result],
  );
  const inputTokens = draft.trim().split(/[\s,，]+/);
  const stackInput = parseStackInput(exampleId, exampleId === 'hanoi' ? diskDraft : sortDraft);
  const input = recursive
    ? stackInput.input
    : example.id === 'nodes'
      ? inputTokens.map(Number)
      : [];
  const validInput = recursive
    ? stackInput.valid
    : example.id !== 'nodes' ||
      (draft.trim() !== '' &&
        input.length === 3 &&
        inputTokens.every((token) => /^[+-]?\d+$/.test(token)) &&
        input.every((value) => Number.isInteger(value) && value >= -999 && value <= 999));
  const stop = useCallback(
    (visible: boolean) => {
      traceVisible.current = visible;
      if (!visible) {
        controller.interruptObservation();
        controller.pause();
      }
    },
    [controller],
  );
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState !== 'visible') {
        controller.interruptObservation();
        controller.pause();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      controller.invalidate();
    };
  }, [controller]);
  useEffect(
    () => service.subscribeSessionInvalidation(() => controller.invalidate()),
    [service, controller],
  );
  useLayoutEffect(() => {
    let frame = 0,
      cancelled = false;
    const present = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (cancelled || controller.getSnapshot().view !== view) return;
          const panel = tracePanel.current?.querySelector<HTMLElement>(
            '[data-testid="stack-panel"]',
          );
          const r = panel?.getBoundingClientRect();
          const height = r ? Math.min(160, r.height) : 0;
          const visible = Boolean(
            mode === 'stack' &&
            traceVisible.current &&
            document.visibilityState === 'visible' &&
            r &&
            r.width > 0 &&
            height > 0 &&
            Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left)) >=
              Math.min(240, r.width) * 0.75 &&
            Math.max(0, Math.min(innerHeight, r.top + height) - Math.max(0, r.top)) >=
              height * 0.75,
          );
          if (visible) controller.presentObservation(view);
          else controller.interruptObservation();
        });
      });
    };
    if (mode !== 'stack') controller.interruptObservation();
    present();
    window.addEventListener('scroll', present, true);
    window.addEventListener('resize', present);
    document.addEventListener('visibilitychange', present);
    const observer = new ResizeObserver(present);
    if (tracePanel.current) observer.observe(tracePanel.current);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', present, true);
      window.removeEventListener('resize', present);
      document.removeEventListener('visibilitychange', present);
    };
  }, [controller, view, mode]);
  const atEnd = Boolean(result && (!result.trace || view.cursor === view.length));
  const diagnostic = snapshot.error || (atEnd ? result?.terminal.code : null);
  const byteRange =
    diagnostic && result?.terminal.byteRange
      ? result.terminal.byteRange
      : (snapshot.hit?.byteRange ?? view.byteRange);
  const bytes = new TextEncoder().encode(example.source);
  const rangeStart = byteRange
    ? new TextDecoder().decode(bytes.slice(0, byteRange.start)).length
    : 0;
  const available = Boolean(view.state);
  return (
    <div
      className="memory-workspace"
      data-page-id="PAGE-MEMORY"
      data-testid="memory-workspace"
      data-cursor={view.cursor}
      data-run-id={view.identity?.runId ?? ''}
      data-runs={snapshot.runs}
      data-state={status}
    >
      <Breadcrumbs
        items={[
          { label: '算法与演示', to: '/cases' },
          { label: recursive ? '递归与调用栈' : '内存观察' },
        ]}
      />
      <PageHeading
        kicker={recursive ? '程序执行 · 函数与递归' : '程序执行 · 指针与对象'}
        title={recursive ? '递归与调用栈' : '内存观察'}
        description={
          recursive
            ? '查看每次调用保存的参数与局部状态。函数返回后，后退可恢复原帧。'
            : '从同一步查看变量与对象。前进、后退或切换视图，观察引用怎样建立与失效。'
        }
      />
      <div className="memory-example-controls">
        <label>
          观察样例{' '}
          <select
            aria-label="观察样例"
            value={exampleId}
            onChange={(event) => {
              const next = observations.find((item) => item.id === event.target.value)!;
              controller.setSource(next.source, next.language);
              setExampleId(event.target.value);
            }}
          >
            {observations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.language === 'cpp' ? 'C++' : 'C'}
              </option>
            ))}
          </select>
        </label>
        {example.id === 'nodes' && (
          <label>
            三个节点值
            <input
              aria-label="三个节点值"
              value={draft}
              onChange={(event) => {
                controller.invalidate();
                setDraft(event.target.value);
              }}
            />
          </label>
        )}
        {example.id === 'hanoi' && (
          <label>
            汉诺塔盘数（0—5）
            <input
              type="number"
              min={0}
              max={5}
              step={1}
              aria-label="汉诺塔盘数"
              value={diskDraft}
              onChange={(event) => {
                controller.invalidate();
                setDiskDraft(event.target.value);
              }}
            />
          </label>
        )}
        {example.id === 'quicksort' && (
          <label>
            五个排序值
            <input
              aria-label="五个排序值"
              value={sortDraft}
              onChange={(event) => {
                controller.invalidate();
                setSortDraft(event.target.value);
              }}
            />
          </label>
        )}
        <button
          className="button button-primary"
          disabled={!validInput || status === 'running'}
          onClick={() => void controller.execute(example.source, example.language, input)}
        >
          运行样例
        </button>
        {status === 'running' && (
          <button className="button" onClick={() => controller.cancel()}>
            取消运行
          </button>
        )}
      </div>
      <p className="memory-description">{example.description} 这些观察样例不计学习积分。</p>
      {!validInput && (
        <p role="alert">
          {recursive ? stackInput.issue : '请输入三个 -999 至 999 的整数，以空格或逗号分隔。'}
        </p>
      )}
      <Workbench
        kind="visualize"
        firstLabel="示例源码"
        secondLabel="执行观察"
        onSecondVisibility={stop}
        first={
          <section
            ref={sourcePanel}
            className="workbench-panel memory-source"
            aria-label="示例源码"
          >
            <header className="panel-heading">
              <h2>{example.language === 'cpp' ? 'C++' : 'C'} 源码</h2>
              <span>只读</span>
            </header>
            <p data-testid="memory-source-position">
              {byteRange
                ? `第 ${example.source.slice(0, rangeStart).split(/\r\n|\r|\n/).length} 行 · ${diagnostic ? '停止位置' : `第 ${view.cursor} 步`}`
                : '运行后逐步查看源码位置。'}
            </p>
            <p className="debug-summary">点击行号设置断点。自动播放在该行首次步骤完成后暂停。</p>
            <p className="debug-summary" data-testid="debug-breakpoints">
              {snapshot.breakpoints.length
                ? `断点：第 ${snapshot.breakpoints.join('、')} 行`
                : '尚未设置断点。'}
              {available &&
                snapshot.breakpoints.some((line) => !snapshot.visitedLines.includes(line)) &&
                ` 本次轨迹无停靠步骤：第 ${snapshot.breakpoints.filter((line) => !snapshot.visitedLines.includes(line)).join('、')} 行。`}
              {snapshot.breakpoints.length > 0 && (
                <button
                  className="button button-small"
                  onClick={() => controller.clearBreakpoints()}
                >
                  清除全部断点
                </button>
              )}
            </p>
            {snapshot.breakpointNotice && <p role="status">{snapshot.breakpointNotice}</p>}
            <DebugSource
              source={example.source}
              byteRange={byteRange ?? null}
              breakpoints={snapshot.breakpoints}
              visitedLines={snapshot.visitedLines}
              ready={available}
              onToggle={(line) => controller.toggleBreakpoint(line)}
            />
          </section>
        }
        second={
          <section
            ref={tracePanel}
            className="workbench-panel memory-stage"
            aria-label="执行观察"
            tabIndex={0}
            onKeyDown={(event) => {
              if (
                (event.target as HTMLElement).closest('button,input,select,textarea,a') ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
              )
                return;
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                controller.step(-1);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                controller.step(1);
              } else if (event.code === 'Space') {
                event.preventDefault();
                controller.toggle();
              }
            }}
          >
            <header className="panel-heading">
              <h2>执行观察</h2>
              <span data-testid="memory-step-kind">
                {view.stepKind ? (memoryStepLabels[view.stepKind] ?? '执行步骤') : '尚无执行步骤'}
              </span>
            </header>
            <div className="memory-tabs" role="group" aria-label="选择执行视图">
              <button
                className="button button-small"
                aria-pressed={mode === 'basic'}
                onClick={() => setMode('basic')}
              >
                基础视图
              </button>
              <button
                className="button button-small"
                aria-pressed={mode === 'memory'}
                onClick={() => setMode('memory')}
              >
                内存视图
              </button>
              <button
                className="button button-small"
                aria-pressed={mode === 'stack'}
                onClick={() => setMode('stack')}
              >
                调用栈视图
              </button>
            </div>
            {snapshot.hit && (
              <p className="debug-hit" role="status" data-testid="debug-hit">
                已命中第 {snapshot.hit.line} 行断点 · 第 {snapshot.hit.cursor} 步。
                {snapshot.hit.byteRange && ' 此处显示进入函数时的调用位置。'}
                点击“继续”前往下一次命中；前进可逐步查看这一行。
              </p>
            )}
            <div
              className="memory-observation"
              data-testid="memory-observation"
              data-cursor={view.cursor}
            >
              {view.state && result ? (
                mode === 'stack' ? (
                  <StackPanel
                    key={view.identity?.runId}
                    state={view.state}
                    previous={previous}
                    result={result}
                    source={example.source}
                    cursor={view.cursor}
                  />
                ) : mode === 'memory' ? (
                  <MemoryPanel state={view.state} previous={previous} result={result} />
                ) : (
                  <MemoryBasicView state={view.state} result={result} />
                )
              ) : (
                <p role="status">
                  {status === 'running'
                    ? '正在执行并检查真实轨迹……'
                    : '选择样例并运行，再查看每一步的对象与值。'}
                </p>
              )}
              {diagnostic && (
                <div data-testid="memory-diagnostic">
                  <DiagnosticPanel
                    diagnostics={[
                      {
                        code: diagnostic,
                        location:
                          !snapshot.error && result?.terminal.byteRange
                            ? { kind: 'source', byteRange: result.terminal.byteRange }
                            : undefined,
                      },
                    ]}
                    source={{
                      text: example.source,
                      language: example.language,
                      nodes: result?.nodeMap,
                    }}
                    onLocateSource={() => {
                      sourcePanel.current
                        ?.querySelector<HTMLElement>('pre')
                        ?.focus({ preventScroll: true });
                      sourcePanel.current
                        ?.querySelector('mark')
                        ?.scrollIntoView({ block: 'center', inline: 'nearest' });
                    }}
                  />
                  {result?.trace && <p>已保留停止前的状态，后退可恢复。</p>}
                </div>
              )}
              {atEnd && result?.terminal.status === 'completed' && (
                <p role="status">程序正常结束。可以后退查看对象结束前的值。</p>
              )}
              {view.state && (
                <section className="memory-output">
                  <h3>当前输出</h3>
                  <pre data-testid="memory-output">{view.state.output || '（无输出）'}</pre>
                </section>
              )}
            </div>
            <div className="player-controls" aria-label="内存观察播放控制">
              <div className="control-group">
                <button
                  className="button button-small"
                  disabled={!available || view.cursor === 0}
                  onClick={() => controller.step(-1)}
                >
                  后退
                </button>
                <button
                  className="button button-small button-primary"
                  disabled={!available || view.cursor >= view.length}
                  onClick={() => controller.toggle()}
                >
                  {view.playing ? '暂停' : snapshot.hit ? '继续' : '播放'}
                </button>
                <button
                  className="button button-small"
                  disabled={!available || view.cursor >= view.length}
                  onClick={() => controller.step(1)}
                >
                  前进
                </button>
                <button
                  className="button button-small"
                  disabled={!available}
                  onClick={() => controller.replay()}
                >
                  重播
                </button>
              </div>
              <label>
                速度{' '}
                <select
                  aria-label="内存播放速度"
                  value={rate}
                  onChange={(event) => controller.setRate(Number(event.target.value))}
                >
                  {[0.25, 0.5, 1, 1.5, 2, 4].map((value) => (
                    <option key={value} value={value}>
                      {value}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="memory-seek">
                步骤 {view.cursor} / {view.length}
                <input
                  type="range"
                  aria-label="执行步骤"
                  min={0}
                  max={view.length || 1}
                  value={view.cursor}
                  disabled={!available}
                  onChange={(event) => controller.seek(Number(event.target.value))}
                />
              </label>
              <span role="status">
                {view.playing
                  ? '正在播放'
                  : status === 'running'
                    ? '正在运行'
                    : available
                      ? '已暂停'
                      : '等待运行'}
              </span>
              <p className="player-help muted">
                聚焦执行观察区后，空格播放或暂停，左右方向键单步查看。
              </p>
            </div>
          </section>
        }
      />
      {['functions', 'hanoi'].includes(exampleId) && (
        <section
          className="observation-confirm"
          aria-label="递归观察确认"
          data-testid="observation-confirm"
          data-seen={snapshot.observation?.seen ?? 0}
          data-total={snapshot.observation?.total ?? 0}
          data-complete={snapshot.observation?.complete ?? false}
        >
          <h2>留下本次递归观察记录</h2>
          <p>
            在调用栈视图从头逐步看完，再主动确认。汉诺塔需运行2—5盘。此记录只表示观察经历，不计积分，也不代表独立解题或掌握。
          </p>
          <p>
            {snapshot.observation
              ? `已实际呈现 ${snapshot.observation.seen} / ${snapshot.observation.total} 个状态。`
              : '运行符合条件的样例后开始记录；直接拖到末步不会完成条件。'}
          </p>
          <button
            type="button"
            className="button button-secondary"
            disabled={
              !snapshot.observation?.complete ||
              achievements.state.status !== 'ready' ||
              achievements.state.rows.some((r) =>
                r.evidence.some((e) => e.subjectRef.id === snapshot.observation?.subjectRef.id),
              )
            }
            onClick={() => {
              const fact = controller.observationFact();
              if (fact) void achievements.controller.confirm(fact);
            }}
          >
            确认本次递归观察
          </button>
          {achievements.state.rows.some((r) =>
            r.evidence.some((e) => e.subjectRef.id === `observation.stack.${exampleId}`),
          ) && <p>这项观察已保存；再次观看不会重复解锁。</p>}
          <AchievementStatus />
          <Link className="text-link" to="/achievements">
            查看学习成就 →
          </Link>
        </section>
      )}
      <Link className="text-link" to="/cases">
        返回算法与演示
      </Link>
    </div>
  );
}
