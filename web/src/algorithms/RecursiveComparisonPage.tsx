import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { Breadcrumbs, PageHeading } from '../components/Ui';
import { useLearning } from '../learning/react';
import { parseSortInput, recursiveSortCases } from './content';
import { RecursivePairController } from './pair-controller';
import { sortExplanation } from './presentation';
import { SortState } from './SortState';
import { SortSource } from './SortSource';
import '../components/array-trace.css';
import './algorithms.css';

export default function RecursiveComparisonPage() {
  const { service } = useLearning();
  const [controller] = useState(() => new RecursivePairController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [draft, setDraft] = useState(recursiveSortCases[0].defaultInput.join(' '));
  const [swapped, setSwapped] = useState(false);
  const parsed = useMemo(() => parseSortInput(recursiveSortCases[0], draft), [draft]);
  useEffect(() => {
    const unsubscribe = service.subscribeSessionInvalidation(controller.invalidate);
    const hidden = () => {
      if (document.visibilityState !== 'visible') controller.pause();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', hidden);
      controller.invalidate();
    };
  }, [controller, service]);
  const busy = snapshot.phase === 'running',
    playable = !busy && snapshot.length > 0;
  const phases = {
    idle: '请应用共同输入',
    ready: '两份源码已就绪',
    running: '正在顺序执行真实C++',
    settled: '执行已结束，可统一回放',
    cancelled: '已取消，可查看已接收侧',
    failed: '输入准备失败',
  };
  return (
    <div
      className="comparison-page recursive-comparison"
      data-testid="recursive-comparison"
      data-phase={snapshot.phase}
      data-group-id={snapshot.groupId}
      data-cursor={snapshot.cursor}
      data-length={snapshot.length}
    >
      <Breadcrumbs
        items={[
          { label: '学习首页', to: '/' },
          { label: '算法与演示', to: '/cases' },
          { label: 'C++递归排序对比' },
        ]}
      />
      <PageHeading
        kicker="C++ · 同数据 · 真实轨迹"
        title="归并与快速，同步观察"
        description="同一整数序列，生成两份独立输入。沿统一原子步骤游标观察数组、递归帧和实际计数。"
      />
      <section className="sort-input" aria-label="C++对比共同输入">
        <label htmlFor="pair-values">共同整数序列</label>
        <input
          id="pair-values"
          data-testid="pair-input"
          value={draft}
          maxLength={1024}
          aria-invalid={!parsed.valid}
          aria-describedby="pair-help"
          onChange={(e) => {
            controller.invalidate();
            setDraft(e.target.value);
          }}
        />
        <p id="pair-help">
          0～30项，−999～999。空数组写[]。修改输入、交换左右、清除数据或离开页面撤销本组旧运行；观察不计学习进度或积分。
        </p>
        {!parsed.valid && <p role="alert">{parsed.issue}</p>}
        <div className="inline-actions">
          <button
            className="button button-primary"
            disabled={!parsed.valid || busy}
            onClick={() => controller.prepare(parsed.values, swapped)}
          >
            应用共同输入
          </button>
          <button
            className="button"
            onClick={() => {
              controller.invalidate();
              setSwapped(!swapped);
            }}
          >
            交换左右
          </button>
        </div>
      </section>
      <section className="comparison-controls" aria-label="C++统一回放控制">
        <p role="status" data-testid="pair-status">
          {phases[snapshot.phase]}
        </p>
        <div className="inline-actions">
          <button
            className="button button-primary"
            disabled={busy || !['ready', 'settled', 'cancelled'].includes(snapshot.phase)}
            onClick={() => void controller.execute()}
          >
            运行两份C++
          </button>
          {busy && (
            <button className="button" onClick={() => controller.cancel()}>
              取消本组运行
            </button>
          )}
          <button className="button" disabled={!playable} onClick={() => controller.seek(0)}>
            回到初态
          </button>
          <button
            className="button"
            disabled={!playable || snapshot.cursor === 0}
            onClick={() => controller.step(-1)}
          >
            统一后退
          </button>
          <button
            className="button"
            disabled={!playable || snapshot.cursor === snapshot.length}
            onClick={() => (snapshot.playing ? controller.pause() : controller.play())}
          >
            {snapshot.playing ? '暂停对比' : '播放对比'}
          </button>
          <button
            className="button"
            disabled={!playable || snapshot.cursor === snapshot.length}
            onClick={() => controller.step(1)}
          >
            统一前进
          </button>
          <button
            className="button"
            disabled={!playable}
            onClick={() => controller.seek(snapshot.length)}
          >
            到末尾
          </button>
          <label>
            速度{' '}
            <select
              aria-label="C++对比回放速度"
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
        </div>
        <label className="sort-seek">
          统一步骤 {snapshot.cursor} / {snapshot.length}
          <input
            type="range"
            aria-label="C++对比统一步骤"
            min={0}
            max={snapshot.length || 1}
            value={snapshot.cursor}
            disabled={!playable}
            onChange={(e) => controller.seek(Number(e.target.value))}
          />
        </label>
        <p className="muted">
          两次执行共用本组1秒截止，顺序占用单执行槽，不自动重试。短侧到末尾保持末态，后退恢复完整状态。相同步号不代表相同算法阶段；计数是实际步骤累计，包含循环、输入和初始化。
        </p>
        {snapshot.error && <p role="alert">{snapshot.error}</p>}
      </section>
      <div className="comparison-lanes">
        {snapshot.lanes.map((lane, index) => {
          const { view, result } = lane,
            explanation =
              result && lane.prepared ? sortExplanation(result, view.cursor, lane.prepared) : null;
          const terminal = result && view.cursor === view.length ? result.terminal : null;
          return (
            <section
              className="comparison-lane sort-stage basic-trace-view"
              key={`${index}/${lane.spec.id}`}
              data-testid={`pair-lane-${index}`}
              data-phase={lane.phase}
              data-run-id={view.identity?.runId ?? ''}
              data-cursor={view.cursor}
              data-length={view.length}
            >
              <header>
                <p className="muted">{index === 0 ? '左侧' : '右侧'} · 独立C++运行</p>
                <h2>{lane.spec.title}</h2>
                <p>{lane.spec.description}</p>
                <p>{lane.spec.complexity}</p>
                <p data-testid="pair-lane-status">
                  {lane.phase === 'accepted'
                    ? result?.trace
                      ? `${result.terminal.status} · ${view.cursor === view.length ? '已到末尾，保持末态' : '轨迹可回放'}`
                      : `未生成轨迹 · ${result?.terminal.code}`
                    : lane.phase === 'running'
                      ? '正在真实执行'
                      : lane.phase === 'failed'
                        ? '本侧执行未接收'
                        : lane.phase === 'cancelled'
                          ? '本侧已取消'
                          : lane.prepared
                            ? '源码与输入已就绪'
                            : '请先应用输入'}
                </p>
                <p data-testid="pair-lane-input">
                  输入副本：{lane.prepared ? JSON.stringify(lane.prepared.input) : '尚未准备'}
                </p>
              </header>
              {lane.error && <p role="alert">{lane.error}</p>}
              {result && view.state && (
                <>
                  <section className="sort-explanation">
                    <h3>{explanation?.title}</h3>
                    <p>{explanation?.explanation}</p>
                    <p className="muted">
                      本侧步骤{view.cursor}/{view.length} · {view.stepKind ?? '初态'}
                    </p>
                  </section>
                  <SortState
                    key={view.identity?.runId}
                    view={view}
                    result={result}
                    inputLength={lane.prepared?.input.length ?? 0}
                    recursive
                  />
                </>
              )}
              {terminal && (
                <p
                  data-testid="pair-terminal"
                  role={terminal.status === 'completed' ? 'status' : 'alert'}
                >
                  {terminal.status === 'completed'
                    ? '程序正常结束，局部对象已离开作用域。'
                    : `停止：${terminal.code}`}
                </p>
              )}
              <details className="sort-method">
                <summary>本侧算法、存储与实际源码</summary>
                <p>{lane.spec.variant}</p>
                <p>{lane.spec.extraSpace}</p>
                {lane.prepared ? (
                  <SortSource
                    source={lane.request?.source ?? lane.prepared.source}
                    range={terminal?.byteRange ?? view.byteRange}
                  />
                ) : (
                  <p>应用共同输入后生成本侧实际源码。</p>
                )}
                <Link className="text-link" to={`/algorithms/${lane.spec.id}`}>
                  打开独立{lane.spec.title}工作区 →
                </Link>
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}
