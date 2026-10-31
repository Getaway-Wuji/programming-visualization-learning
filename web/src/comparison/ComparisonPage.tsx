import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation } from 'react-router';
import RecursiveComparisonPage from '../algorithms/RecursiveComparisonPage';
import { Breadcrumbs, PageHeading } from '../components/Ui';
import { InputPanel } from '../components/InputPanel';
import { SourcePanel } from '../components/SourcePanel';
import { BasicTraceView } from '../components/BasicTraceView';
import { DiagnosticPanel } from '../diagnostics/DiagnosticPanel';
import { useLearning } from '../learning/react';
import {
  defaultDraft,
  generateInput,
  InputDataError,
  parseInputDraft,
  type InputIssue,
} from '../engine/input-data';
import type { CaseInput } from '../engine/execution-client';
import { comparisonAlgorithms, comparisonCatalogs, comparisonExample } from './content';
import { ComparisonController } from './controller';
import './comparison.css';

const phases = {
  idle: '请应用输入',
  preparing: '准备两份源码',
  ready: '两份源码已就绪',
  running: '正在收集真实轨迹',
  settled: '执行已结束，可统一回放',
  failed: '准备未完成，请检查后重试',
  cancelled: '已取消，可查看已接收的轨迹',
};
const terminals = {
  completed: '程序正常结束',
  'program-error': '程序错误',
  rejected: '请求未通过检查',
  'resource-limit': '运行超过限制',
  cancelled: '运行已取消',
  'infrastructure-failure': '执行未能完成',
};
const metrics = [
  ['comparisons', '比较'],
  ['swaps', '交换'],
  ['scalarWrites', '标量写入'],
  ['arrayWrites', '数组写入'],
] as const;

function LegacyComparisonPage() {
  const { service, state: learning } = useLearning();
  const [controller] = useState(
    () => new ComparisonController({ present: (action) => flushSync(action) }),
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [swapped, setSwapped] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({
    values: comparisonExample.values.join(', '),
  });
  const [seed, setSeed] = useState<string>(() => crypto.randomUUID());
  const [length, setLength] = useState('7');
  const [random, setRandom] = useState<CaseInput['random']>(null);
  const [issues, setIssues] = useState<readonly InputIssue[]>([]);
  const catalogs = useMemo(
    () => (learning.readingStatus === 'loading' ? null : comparisonCatalogs(swapped)),
    [swapped, learning.readingStatus],
  );
  useEffect(() => {
    if (catalogs) controller.configure(catalogs);
    return controller.invalidate;
  }, [controller, catalogs]);
  useEffect(
    () => service.subscribeSessionInvalidation(controller.invalidate),
    [service, controller],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== 'visible') controller.pause();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [controller]);
  const savedRate = learning.snapshot?.settings.playbackRate ?? 1;
  useEffect(() => controller.setRate(savedRate), [controller, savedRate]);
  const spec = snapshot.lanes[0]?.catalog?.inputSpec;
  const parsed = spec ? parseInputDraft(spec, draft) : null;
  const inputIssues = [...(parsed && !parsed.ok ? parsed.issues : []), ...issues];
  const busy = snapshot.phase === 'preparing' || snapshot.phase === 'running';
  const playable = !busy && snapshot.length > 0;
  function changed() {
    controller.invalidate();
    setIssues([]);
  }
  function generate(newSeed: boolean) {
    changed();
    setRandom(null);
    if (!spec) return;
    const selected = newSeed ? crypto.randomUUID() : seed;
    if (newSeed) setSeed(selected);
    try {
      if (!/^\d+$/.test(length) || length.length > 32)
        throw new InputDataError([
          {
            field: 'length',
            code: 'INPUT_RANDOM_LENGTH',
            message: '随机数组长度必须是0～30的整数。',
          },
        ]);
      const generated = generateInput(spec, selected, Number(length));
      setDraft(defaultDraft(spec, generated.values));
      setRandom(generated.random);
    } catch (error) {
      setIssues(
        error instanceof InputDataError
          ? error.issues
          : [{ field: 'input', code: 'INPUT_TYPE', message: '输入生成未完成。' }],
      );
    }
  }
  return (
    <div className="comparison-page" data-testid="comparison-page" data-phase={snapshot.phase}>
      <Breadcrumbs
        items={[
          { label: '学习首页', to: '/' },
          { label: '算法与演示', to: '/cases' },
          { label: '同数据对比' },
        ]}
      />
      <PageHeading
        kicker="两种算法 · 同一份输入"
        title="同样的数据，怎样走完排序？"
        description="分别运行原 C 冒泡与选择排序，用同一游标查看两条真实轨迹。每拍各走一个原子步骤，不代表相同算法阶段。"
      />
      <section className="comparison-summary" aria-label="对比设置与当前计数">
        <div className="comparison-title-row">
          <div>
            <h2>当前步骤的真实计数</h2>
            <p className="muted">输入仅供本页使用；对比不记录学习事实或积分。</p>
          </div>
          <button
            className="button"
            onClick={() => {
              changed();
              setSwapped(!swapped);
            }}
          >
            互换左右算法
          </button>
        </div>
        <p className="comparison-input" data-testid="comparison-input">
          共同输入：
          {snapshot.lanes[0]?.input
            ? JSON.stringify(snapshot.lanes[0].input.values.values)
            : '尚未应用'}
        </p>
        <div className="comparison-metrics-scroll">
          <table className="comparison-metrics" aria-label="当前步骤的真实计数">
            <thead>
              <tr>
                <th scope="col">算法</th>
                {metrics.map(([key, label]) => (
                  <th scope="col" key={key}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.lanes.map((lane, index) => (
                <tr key={index}>
                  <th scope="row">{lane.catalog?.subject.title ?? '准备案例'}</th>
                  {metrics.map(([key]) => (
                    <td key={key} data-testid={`metric-${index}-${key}`}>
                      {lane.view.state?.counters[key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="comparison-explanation">
          <summary>这些计数包含什么？</summary>
          <p>
            计数来自 Rust
            当前轨迹状态。比较包含循环、下标与控制条件的关系和相等运算；标量写入含初始化、循环变量与临时变量；数组写入含初始化及同值写入。交换是
            Rust 验证的交换观察，其写入已计入数组写入，不应再次相加。
          </p>
          <p>
            空逻辑数组仍有容量 1
            的模板占位初始化。辅助空间不含输入数组及教学轨迹。调速只影响回放间隔，动画时长不表示算法效率。
          </p>
        </details>
      </section>
      <details
        className="comparison-input-settings"
        open={snapshot.phase === 'idle' || snapshot.phase === 'failed'}
      >
        <summary>共同输入设置</summary>
        {spec && (
          <InputPanel
            spec={spec}
            draft={draft}
            seed={seed}
            length={length}
            issues={inputIssues}
            onField={(key, value) => {
              changed();
              setRandom(null);
              setDraft({ ...draft, [key]: value });
            }}
            onSeed={(value) => {
              changed();
              setRandom(null);
              setSeed(value);
            }}
            onLength={(value) => {
              changed();
              setRandom(null);
              setLength(value);
            }}
            onGenerate={generate}
            onReset={() => {
              changed();
              setRandom(null);
              setSeed(crypto.randomUUID());
              setLength('7');
              setDraft({ values: comparisonExample.values.join(', ') });
            }}
            onPrepare={() => {
              if (parsed?.ok) void controller.prepare({ values: parsed.values, random });
            }}
            preparing={busy}
          />
        )}
      </details>
      <section className="comparison-controls" aria-label="统一运行与回放">
        <div className="inline-actions">
          <button
            className="button button-primary"
            disabled={busy || !snapshot.lanes.every((lane) => lane.source)}
            onClick={() => void controller.execute()}
          >
            运行两种算法
          </button>
          <button className="button" disabled={!busy} onClick={() => controller.cancel()}>
            取消运行
          </button>
          <span role="status" data-testid="comparison-status">
            {phases[snapshot.phase]}
          </span>
        </div>
        <div className="inline-actions comparison-playback">
          <button
            className="button"
            disabled={!playable || snapshot.cursor === 0}
            onClick={() => controller.seek(0)}
          >
            回到起点
          </button>
          <button
            className="button"
            disabled={!playable || snapshot.cursor === 0}
            onClick={() => controller.step(-1)}
          >
            后退一拍
          </button>
          <button
            className="button"
            disabled={!playable || snapshot.cursor >= snapshot.length}
            onClick={snapshot.playing ? controller.pause : controller.play}
          >
            {snapshot.playing ? '暂停对比' : '播放对比'}
          </button>
          <button
            className="button"
            disabled={!playable || snapshot.cursor >= snapshot.length}
            onClick={() => controller.step(1)}
          >
            前进一拍
          </button>
          <button
            className="button"
            disabled={!playable}
            onClick={() => controller.seek(snapshot.length)}
          >
            到末尾
          </button>
          <label>
            回放速度{' '}
            <select
              aria-label="对比回放速度"
              value={snapshot.rate}
              onChange={(event) => controller.setRate(Number(event.target.value))}
            >
              {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="comparison-seek">
          统一游标{' '}
          <output data-testid="comparison-cursor">
            {snapshot.cursor} / {snapshot.length}
          </output>
          <input
            type="range"
            aria-label="对比步骤"
            min={0}
            max={snapshot.length}
            value={snapshot.cursor}
            disabled={!playable}
            onChange={(event) => controller.seek(Number(event.target.value))}
          />
        </label>
        <p className="muted">
          短轨迹到末尾后保持末态，另一侧继续；后退时按同一游标恢复。两次执行顺序收集，共用本次运行的
          1 秒截止，不自动重试。
        </p>
        {snapshot.error && (
          <p role="alert">本次准备失败：{snapshot.error}。请检查输入或连接，重新应用输入。</p>
        )}
      </section>
      <div className="comparison-lanes">
        {snapshot.lanes.map((lane, index) => {
          const algorithm = comparisonAlgorithms.find(
            (entry) => entry.id === lane.catalog?.subject.id,
          );
          const atEnd = lane.view.cursor !== null && lane.view.cursor === lane.view.length;
          return (
            <section
              className="comparison-lane"
              key={index}
              data-testid={`comparison-lane-${index}`}
              data-phase={lane.phase}
              data-cursor={lane.view.cursor ?? ''}
              data-length={lane.view.length}
            >
              <header>
                <p className="muted">{index === 0 ? '左侧' : '右侧'} · C 原案例</p>
                <h2>{algorithm?.title ?? '准备案例'}</h2>
                <p>{algorithm?.detail}</p>
                <p className="comparison-complexity">{algorithm?.complexity}</p>
                <p data-testid="lane-status">
                  {lane.phase === 'accepted'
                    ? `${terminals[lane.result!.terminal.status]} · ${atEnd ? '已到末尾，保持末态' : '轨迹可回放'}`
                    : lane.phase === 'cancelled'
                      ? '本侧已取消，未保留暂呈结果'
                      : lane.phase === 'running'
                        ? '正在真实执行，暂不可回放'
                        : lane.source
                          ? '源码已就绪'
                          : '请先应用共同输入'}
                </p>
                {lane.input && (
                  <p className="muted" data-testid="lane-input">
                    输入副本：{JSON.stringify(lane.input.values.values)}
                  </p>
                )}
              </header>
              {lane.error && <p role="alert">{lane.error}</p>}
              {lane.result && (
                <DiagnosticPanel
                  diagnostics={lane.result.terminal.diagnostics}
                  source={{ text: lane.source?.text ?? '', nodes: lane.result.nodeMap }}
                />
              )}
              <BasicTraceView
                view={lane.view}
                result={lane.result}
                input={lane.input?.values ?? { values: [] }}
                bindings={lane.catalog?.program.bindings ?? []}
              />
              <details className="comparison-source">
                <summary>本侧实际执行源码与当前位置</summary>
                {lane.source ? (
                  <SourcePanel
                    source={lane.source.text}
                    nodes={lane.result?.nodeMap ?? []}
                    view={lane.view}
                  />
                ) : (
                  <p className="muted">应用输入后生成本侧源码。</p>
                )}
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function ComparisonPage() {
  const recursive = new URLSearchParams(useLocation().search).get('pair') === 'cpp-recursive';
  return (
    <>
      <nav className="inline-actions comparison-family" aria-label="切换对比案例组">
        <Link className="text-link" aria-current={!recursive ? 'page' : undefined} to="/compare">
          C · 冒泡与选择
        </Link>
        <Link
          className="text-link"
          aria-current={recursive ? 'page' : undefined}
          to="/compare?pair=cpp-recursive"
        >
          C++ · 归并与快速
        </Link>
      </nav>
      {recursive ? <RecursiveComparisonPage /> : <LegacyComparisonPage />}
    </>
  );
}
