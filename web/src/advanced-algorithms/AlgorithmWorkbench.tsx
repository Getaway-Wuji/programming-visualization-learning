import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { CustomCodeController } from '../custom-code/controller';
import { CustomViews } from '../custom-code/Views';
import { Workbench } from '../workbench/Workbench';
import { DebugSource } from '../debug/DebugSource';
import { memoryDiagnostics, memoryStepLabels } from '../memory/presentation';
import type { AdvancedState } from '../engine/advanced-protocol';
export function AlgorithmWorkbench({
  controller,
  snap,
  source,
  renderArrays,
}: {
  controller: CustomCodeController;
  snap: ReturnType<CustomCodeController['getSnapshot']>;
  source: string | null;
  renderArrays: (state: AdvancedState) => ReactNode;
}) {
  const { view, result, status } = snap;
  useEffect(() => {
    controller.setTeachingPlayback(true);
    return () => controller.setTeachingPlayback(false);
  }, [controller]);
  const [mode, setMode] = useState('basic');
  const visibility = useCallback(
    (visible: boolean) => {
      if (!visible) controller.pause();
    },
    [controller],
  );
  const range =
    result?.terminal.status !== 'completed' && view.cursor === view.length
      ? (result?.terminal.byteRange ?? view.byteRange)
      : view.byteRange;
  return (
    <Workbench
      kind="visualize"
      firstLabel="同源C++代码"
      secondLabel="真实算法状态"
      onSecondVisibility={visibility}
      first={
        <section className="example-code memory-source">
          <h2>本次执行的C++源码</h2>
          {source ? (
            <DebugSource
              source={source}
              byteRange={range ?? null}
              breakpoints={snap.breakpoints}
              visitedLines={snap.visitedLines}
              ready={!!result}
              onToggle={(line) => controller.toggleBreakpoint(line)}
            />
          ) : (
            <p>输入无效，请修正后运行；旧轨迹已经失效。</p>
          )}
        </section>
      }
      second={
        <section
          className="custom-stage example-stage sieve-stage"
          aria-label="算法执行观察"
          tabIndex={0}
          onKeyDown={(e) => {
            if (
              (e.target as HTMLElement).closest('button,input,select,textarea,a') ||
              e.ctrlKey ||
              e.altKey ||
              e.metaKey
            )
              return;
            if (e.code === 'Space') {
              e.preventDefault();
              controller.toggle();
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              controller.step(e.key === 'ArrowLeft' ? -1 : 1);
            }
          }}
        >
          <h2>执行观察</h2>
          <p role="status" data-testid="algorithm-run-status">
            {status === 'running'
              ? '正在执行并检查真实轨迹……'
              : status === 'failed'
                ? `本次运行未接收：${snap.error}。可重新运行。`
                : result
                  ? result.terminal.status === 'completed'
                    ? '程序已正常结束；从初态逐步观察。'
                    : `程序停止：${result.terminal.code ?? result.terminal.status}`
                  : '运行后查看当前游标的真实状态。'}
          </p>
          {result?.terminal.code && (
            <p role="alert">
              {result.terminal.code} · {memoryDiagnostics[result.terminal.code] ?? '程序未能继续。'}
            </p>
          )}
          <div className="custom-playback">
            <button
              className="button button-small"
              disabled={!view.state || !view.cursor}
              onClick={() => controller.step(-1)}
            >
              后退
            </button>
            <button
              className="button button-small"
              disabled={!view.state || view.cursor === view.length}
              onClick={() => controller.step(1)}
            >
              前进
            </button>
            <button
              className="button button-small"
              disabled={!view.state || (!view.playing && view.cursor === view.length)}
              onClick={() => controller.toggle()}
            >
              {view.playing ? '暂停' : '播放'}
            </button>
            <button
              className="button button-small"
              disabled={!view.state}
              onClick={() => controller.seek(0)}
            >
              回到初态
            </button>
            <button
              className="button button-small"
              disabled={!view.state}
              onClick={() => controller.seek(view.length)}
            >
              查看末步
            </button>
            <label>
              速度{' '}
              <select
                aria-label="算法播放速度"
                value={snap.rate}
                onChange={(e) => controller.setRate(Number(e.target.value))}
              >
                {[0.25, 0.5, 1, 1.5, 2, 4].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="custom-cursor">
            步骤 {view.cursor} / {view.length}
            <input
              type="range"
              aria-label="算法执行步骤"
              min={0}
              max={Math.max(1, view.length)}
              value={view.cursor}
              disabled={!view.state}
              onChange={(e) => controller.seek(Number(e.target.value))}
            />
          </label>
          <p>
            {view.stepKind ? (memoryStepLabels[view.stepKind] ?? view.stepKind) : '初始状态'}
            {snap.hit ? ` · 命中第${snap.hit.line}行断点` : ''}
          </p>
          <label>
            观察视图{' '}
            <select
              aria-label="算法观察视图"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="basic">变量与数组</option>
              <option value="memory">内存</option>
              <option value="stack">调用栈</option>
            </select>
          </label>
          {view.state && result ? (
            <>
              {renderArrays(view.state)}
              <dl className="algorithm-counters" data-testid="algorithm-counters">
                {Object.entries(view.state.counters).map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      {
                        {
                          comparisons: '比较',
                          scalarWrites: '变量写入',
                          arrayWrites: '数组写入',
                          swaps: '交换标注',
                        }[k]
                      }
                    </dt>
                    <dd data-counter={k}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted">
                计数来自实际步骤；读入和初始化也可能产生写入，同值赋值仍记一次写入。计数不等于渐进复杂度或动画耗时。
              </p>
              <CustomViews
                key={view.identity?.runId}
                state={view.state}
                result={result}
                mode={mode}
              />
            </>
          ) : (
            <p>数组尚未生成；运行后可查看实际标记或递推状态。</p>
          )}
          {result && view.cursor === view.length && (
            <p data-testid="algorithm-terminal">
              终态：{result.terminal.status} · 返回值{result.terminal.returnValue ?? '无'}
            </p>
          )}
        </section>
      }
    />
  );
}
