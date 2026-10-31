import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Breadcrumbs, MissingPage } from '../components/Ui';
import { useLearning } from '../learning/react';
import { examples, findExample, parseExampleInput, type ExampleSpec } from '../examples/content';
import { CustomViews } from '../custom-code/Views';
import { SortSource } from '../algorithms/SortSource';
import { ExamplePairController } from './controller';
import { solutionsFor, samplesFor } from './content';
import type { AdvancedState } from '../engine/advanced-protocol';
import '../advanced-course/advanced-course.css';
import '../custom-code/custom-code.css';
import '../examples/examples.css';
import './comparison.css';

function TraceArrays({ state, n }: { state: AdvancedState; n: number }) {
  return (
    <div className="solution-arrays">
      {state.objects
        .filter(
          (o) => o.alive && ['values', 'order', 'scratch'].includes(o.name) && o.typeName === 'int',
        )
        .map((o) => (
          <section
            key={o.id}
            data-testid="solution-array"
            data-name={o.name}
            aria-label={o.name + '数组'}
          >
            <h3>
              {o.name} · 前{n}项
            </h3>
            <ol>
              {Array.from({ length: n }, (_, i) => (
                <li key={i}>
                  <small>[{i}]</small>
                  <strong>
                    {String(
                      o.cells.find((c) => c.byteOffset === i * 4)?.value ??
                        (o.zeroInitialized ? 0 : '未初始化'),
                    )}
                  </strong>
                </li>
              ))}
            </ol>
          </section>
        ))}
    </div>
  );
}
function Workspace({ spec }: { spec: ExampleSpec }) {
  const { service } = useLearning(),
    navigate = useNavigate();
  const [controller] = useState(() => new ExamplePairController(spec));
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [draft, setDraft] = useState(spec.defaults.values.join(' ')),
    [target, setTarget] = useState(
      spec.defaults.target === undefined ? '' : String(spec.defaults.target),
    );
  const [swapped, setSwapped] = useState(false),
    [sample, setSample] = useState(''),
    [modes, setModes] = useState(['basic', 'basic']);
  const parsed = useMemo(() => parseExampleInput(spec, draft, target), [spec, draft, target]);
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
  const busy = snap.phase === 'running',
    playable = !busy && snap.length > 0;
  const change = (d: string, t: string, key = '') => {
    controller.invalidate();
    setDraft(d);
    setTarget(t);
    setSample(key);
  };
  const choices = solutionsFor(spec);
  const outcome = {
    equal: '两份程序的最终答案一致。',
    rejected: '两份程序均拒绝了不满足唯一解承诺的输入。',
    different: '两份程序的终态结果不一致，请检查实际输出。',
    unavailable: '尚无两份完整结果，暂不能判断答案是否一致。',
  }[snap.outcome];
  return (
    <div
      className="advanced-course example-page solution-page"
      data-testid="example-comparison"
      data-example={spec.id}
      data-phase={snap.phase}
      data-group-id={snap.groupId}
      data-cursor={snap.cursor}
      data-length={snap.length}
    >
      <Breadcrumbs
        items={[
          { label: '进阶课程', to: '/advanced' },
          { label: '经典例题', to: '/advanced/examples' },
          { label: spec.topic + ' · 同题两解' },
        ]}
      />
      <header className="advanced-heading">
        <h1 tabIndex={-1}>{spec.title.split('：')[0]}：同题两解</h1>
        <p>同一原始输入，两份独立C++程序。比较答案、真实写入与不同边界处理。</p>
      </header>
      <form
        className="example-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.valid && !busy) {
            controller.prepare(parsed.input, swapped);
            void controller.execute();
          }
        }}
      >
        <label>
          共同整数数组
          <input
            data-testid="solutions-values"
            value={draft}
            maxLength={1024}
            aria-invalid={!parsed.valid}
            aria-describedby="solutions-help"
            onChange={(e) => change(e.target.value, target)}
          />
        </label>
        {spec.hasTarget && (
          <label>
            共同目标
            <input
              data-testid="solutions-target"
              value={target}
              maxLength={16}
              inputMode="numeric"
              aria-invalid={!parsed.valid}
              onChange={(e) => change(draft, e.target.value)}
            />
          </label>
        )}
        <div className="inline-actions">
          <button className="button button-primary" type="submit" disabled={!parsed.valid || busy}>
            运行两份C++方案
          </button>
          <button
            className="button"
            type="button"
            onClick={() => {
              controller.invalidate();
              setSwapped(!swapped);
            }}
          >
            交换左右方案
          </button>
          {busy && (
            <button className="button" type="button" onClick={() => controller.cancel()}>
              取消本组运行
            </button>
          )}
        </div>
        <label>
          例题
          <select
            aria-label="对比例题"
            value={spec.id}
            onChange={(e) => {
              controller.invalidate();
              navigate('/advanced/examples/' + e.target.value + '/compare');
            }}
          >
            {examples.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title.split('：')[0]}
              </option>
            ))}
          </select>
        </label>
        <label>
          共同边界样例
          <select
            aria-label="同题边界样例"
            value={sample}
            onChange={(e) => {
              const s = samplesFor(spec).find((s) => s.key === e.target.value);
              if (s)
                change(s.values.join(' '), s.target === undefined ? '' : String(s.target), s.key);
            }}
          >
            <option value="">选择一组输入</option>
            {samplesFor(spec).map((s) => (
              <option key={s.key} value={s.key}>
                {s.key} · {s.values.join(', ')}
                {s.target === undefined ? '' : ` → ${s.target}`}
                {s.expectedReturn ? '（输入承诺反例）' : ''}
              </option>
            ))}
          </select>
        </label>
        <p id="solutions-help" role={!parsed.valid ? 'alert' : undefined}>
          {parsed.valid ? spec.platformConstraints : parsed.issue}
        </p>
      </form>
      <section
        className="solution-controls"
        aria-label="同题统一回放"
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
            if (snap.playing) controller.pause();
            else controller.play();
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            controller.step(e.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        <h2>统一回放</h2>
        <p role="status" data-testid="solutions-status">
          {busy
            ? '正在顺序执行并检查两份真实轨迹……'
            : snap.phase === 'cancelled'
              ? '本组已取消；可回放此前已接收侧。'
              : snap.phase === 'failed'
                ? '输入准备失败。'
                : snap.phase === 'settled'
                  ? '本组运行已结束，可从初态观察。'
                  : '输入就绪后运行两份方案。'}
        </p>
        <p data-testid="solutions-outcome" data-outcome={snap.outcome}>
          终态核验：{outcome}
        </p>
        {snap.error && <p role="alert">{snap.error}</p>}
        <div className="inline-actions">
          <button
            className="button button-small"
            disabled={!playable}
            onClick={() => controller.seek(0)}
          >
            回到初态
          </button>
          <button
            className="button button-small"
            disabled={!playable || snap.cursor === 0}
            onClick={() => controller.step(-1)}
          >
            统一后退
          </button>
          <button
            className="button button-small"
            disabled={!playable || snap.cursor === snap.length}
            onClick={() => (snap.playing ? controller.pause() : controller.play())}
          >
            {snap.playing ? '暂停对比' : '播放对比'}
          </button>
          <button
            className="button button-small"
            disabled={!playable || snap.cursor === snap.length}
            onClick={() => controller.step(1)}
          >
            统一前进
          </button>
          <button
            className="button button-small"
            disabled={!playable}
            onClick={() => controller.seek(snap.length)}
          >
            查看两侧末步
          </button>
          <label>
            速度{' '}
            <select
              aria-label="同题播放速度"
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
          统一步骤 {snap.cursor} / {snap.length}
          <input
            type="range"
            aria-label="同题统一步骤"
            min={0}
            max={snap.length || 1}
            value={snap.cursor}
            disabled={!playable}
            onChange={(e) => controller.seek(Number(e.target.value))}
          />
        </label>
        <p className="muted">
          两份运行共用1秒截止，顺序占用单执行槽，不自动重试。统一步号不代表相同算法阶段；短侧保持真实末态。播放速度与动画时长不代表算法效率。
        </p>
      </section>
      <div className="solution-lanes">
        {snap.lanes.map((lane, i) => {
          const solution = solutionsFor(spec)[swapped ? 1 - i : i],
            { view, result } = lane;
          const code = lane.request?.source ?? lane.prepared?.source;
          return (
            <section
              className="solution-lane"
              key={i}
              data-testid={`solution-lane-${i}`}
              data-phase={lane.phase}
              data-cursor={view.cursor}
              data-length={view.length}
              data-run-id={view.identity?.runId ?? ''}
              data-solution={solution.solutionRef.id}
            >
              <header>
                <h2>
                  {i === 0 ? '左侧' : '右侧'} · {solution.title}
                </h2>
                <p>{solution.strategy}</p>
                <p>{solution.time}</p>
                <p>{solution.space}</p>
              </header>
              <p data-testid="solution-lane-status">
                {lane.phase === 'accepted'
                  ? result?.trace
                    ? `${result.terminal.status} · ${view.cursor === view.length ? '已到末尾，保持末态' : '轨迹可回放'}`
                    : `没有轨迹 · ${result?.terminal.code}`
                  : lane.phase === 'running'
                    ? '本侧正在真实执行'
                    : lane.phase === 'failed'
                      ? `本侧未接收：${lane.error}`
                      : lane.phase === 'cancelled'
                        ? '本侧已取消'
                        : '等待本组运行'}
              </p>
              {lane.prepared && (
                <p data-testid="solution-input">输入副本：{JSON.stringify(lane.prepared.input)}</p>
              )}
              <dl className="solution-counters" data-testid="solution-counters">
                {(['comparisons', 'arrayWrites', 'scalarWrites', 'swaps'] as const).map((k) => (
                  <div key={k}>
                    <dt>
                      {
                        {
                          comparisons: '比较',
                          arrayWrites: '数组写入',
                          scalarWrites: '变量写入',
                          swaps: '交换标注',
                        }[k]
                      }
                    </dt>
                    <dd data-counter={k}>{view.state?.counters[k] ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              <label>
                观察视图{' '}
                <select
                  aria-label="本侧观察视图"
                  value={modes[i]}
                  onChange={(e) => setModes(modes.map((m, k) => (k === i ? e.target.value : m)))}
                >
                  <option value="basic">变量与数组</option>
                  <option value="memory">内存</option>
                  <option value="stack">调用栈</option>
                </select>
              </label>
              <div className="solution-observation" data-ui>
                {view.state && result ? (
                  <>
                    <p>
                      本侧步骤 {view.cursor} / {view.length} · {view.stepKind ?? '初态'}
                    </p>
                    <TraceArrays state={view.state} n={lane.prepared!.logicalLength} />
                    <CustomViews
                      key={view.identity?.runId}
                      state={view.state}
                      result={result}
                      mode={modes[i]}
                    />
                  </>
                ) : (
                  <p>运行后呈现该侧同一游标的数组、变量、输出、内存或栈。</p>
                )}
              </div>
              <details className="solution-code">
                <summary>本侧实际源码与高亮</summary>
                {code ? (
                  <SortSource source={code} range={view.byteRange} />
                ) : (
                  <p>运行本组后展示该侧实际请求源码。</p>
                )}
              </details>
              {result && view.cursor === view.length && (
                <p data-testid="solution-terminal">
                  终态：{result.terminal.status} · 返回值{result.terminal.returnValue ?? '无'}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <section className="solution-reasoning">
        <h2>复杂度与适用场景</h2>
        <p>
          当前计数来自真实步骤，包含输入、初始化、循环及同值写；交换标注未由引擎标记时保持真实0，不由前端推测。渐进复杂度按输入规模n推导，不能只凭本次计数判断所有输入。
        </p>
        <div className="custom-table-scroll">
          <table>
            <thead>
              <tr>
                <th>比较点</th>
                {choices.map((s) => (
                  <th key={s.solutionRef.id}>{s.title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['time', 'space', 'derivation', 'suitable', 'cautions'] as const).map((k) => (
                <tr key={k}>
                  <th>
                    {
                      {
                        time: '时间',
                        space: '额外空间',
                        derivation: '推导',
                        suitable: '适用场景',
                        cautions: '边界与取舍',
                      }[k]
                    }
                  </th>
                  {choices.map((s) => (
                    <td key={s.solutionRef.id}>{s[k]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p>
        来源：
        <a href={spec.source.url} target="_blank" rel="noreferrer noopener">
          力扣 {spec.source.problemNumber} · {spec.source.title}
        </a>
        。{spec.originalConstraints}{' '}
        平台采用原创讲解与代码，授权未确认；原题范围与本页有界演示分开。
      </p>
      <p>
        本页不保存输入或轨迹，不计题目通过或积分。
        <Link to={`/advanced/examples/${spec.id}`}>查看原例题讲解、来源与基础复习</Link>
      </p>
      <nav className="advanced-bottom" aria-label="同题对比导航">
        <Link to="/advanced/examples">返回经典例题</Link>
        <Link to="/advanced">返回进阶课程</Link>
      </nav>
    </div>
  );
}
export default function ExampleComparisonPage() {
  const { exampleId } = useParams(),
    spec = findExample(exampleId);
  return spec ? (
    <Workspace key={spec.id} spec={spec} />
  ) : (
    <MissingPage title="找不到这个同题对比" backTo="/advanced/examples" backLabel="返回经典例题" />
  );
}
