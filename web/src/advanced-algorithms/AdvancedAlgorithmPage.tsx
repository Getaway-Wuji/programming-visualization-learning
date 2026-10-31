import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { CustomCodeController } from '../custom-code/controller';
import {
  findAdvancedAlgorithm,
  parseAlgorithmInput,
  prepareAdvancedAlgorithm,
  type AdvancedAlgorithmSpec,
} from './content';
import { AdvancedAlgorithmCatalog } from './AdvancedAlgorithmCatalog';
import { AlgorithmReading } from './AlgorithmReading';
import { AlgorithmArrays } from './AlgorithmArrays';
import { AlgorithmWorkbench } from './AlgorithmWorkbench';
import '../advanced-course/advanced-course.css';
import '../custom-code/custom-code.css';
import '../examples/examples.css';
import './algorithms.css';

function Workspace({ spec }: { spec: AdvancedAlgorithmSpec }) {
  const { service } = useLearning();
  const [controller] = useState(() => new CustomCodeController()),
    [draft, setDraft] = useState(
      spec.defaults.values.length ? spec.defaults.values.join(' ') : '[]',
    ),
    [sample, setSample] = useState('');
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot),
    parsed = useMemo(() => parseAlgorithmInput(spec, draft), [spec, draft]),
    prepared = parsed.valid ? prepareAdvancedAlgorithm(spec, parsed.values) : null;
  const { view, status } = snap;
  useEffect(() => {
    controller.setSource(prepareAdvancedAlgorithm(spec, spec.defaults.values).source, 'cpp');
    const unsubscribe = service.subscribeSessionInvalidation(() => controller.invalidate()),
      hidden = () => {
        if (document.visibilityState !== 'visible') controller.pause();
      };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      controller.invalidate();
      unsubscribe();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [controller, service, spec]);
  const change = (value: string, key = '') => {
    controller.invalidate();
    const next = parseAlgorithmInput(spec, value);
    controller.setSource(
      next.valid ? prepareAdvancedAlgorithm(spec, next.values).source : '',
      'cpp',
    );
    setDraft(value);
    setSample(key);
  };
  return (
    <div
      className="advanced-course example-page sieve-page"
      data-testid="advanced-algorithm-workspace"
      data-case={spec.id}
      data-state={status}
      data-cursor={view.cursor}
      data-length={view.length}
    >
      <Breadcrumbs
        items={[
          { label: '进阶课程', to: '/advanced' },
          { label: '筛法与序列', to: '/advanced/algorithms' },
          { label: spec.title },
        ]}
      />
      <header className="advanced-heading">
        <h1 tabIndex={-1}>{spec.title}</h1>
        <p>{spec.statement}</p>
      </header>
      <form
        className="example-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (prepared && status !== 'running')
            void controller.execute(prepared.source, 'cpp', prepared.input);
        }}
      >
        <label>
          {spec.inputKind === 'bound' ? '包含端点的上界' : '整数序列'}
          <input
            data-testid="algorithm-input"
            value={draft}
            maxLength={1024}
            inputMode={spec.inputKind === 'bound' ? 'numeric' : 'text'}
            aria-invalid={!parsed.valid}
            aria-describedby="algorithm-input-help"
            onChange={(e) => change(e.target.value)}
          />
        </label>
        <div className="inline-actions">
          <button
            className="button button-primary"
            type="submit"
            disabled={!prepared || status === 'running'}
          >
            运行C++算法
          </button>
          <button
            className="button"
            type="button"
            onClick={() =>
              change(spec.defaults.values.length ? spec.defaults.values.join(' ') : '[]')
            }
          >
            恢复默认输入
          </button>
          {status === 'running' && (
            <button className="button" type="button" onClick={() => controller.cancel()}>
              取消运行
            </button>
          )}
        </div>
        <label>
          边界样例
          <select
            aria-label="算法边界样例"
            value={sample}
            onChange={(e) => {
              const item = spec.samples.find((s) => s.key === e.target.value);
              if (item) change(item.values.length ? item.values.join(' ') : '[]', item.key);
            }}
          >
            <option value="">选择一组输入</option>
            {spec.samples.map((s) => (
              <option key={s.key} value={s.key}>
                {s.key} ·{' '}
                {spec.inputKind === 'bound' ? '上界' + s.values[0] : s.values.length + '项'}
              </option>
            ))}
          </select>
        </label>
        <p id="algorithm-input-help" role={!parsed.valid ? 'alert' : undefined}>
          {parsed.valid ? spec.platformConstraints : parsed.issue}
        </p>
      </form>
      <AlgorithmReading spec={spec} />
      <p className="muted">
        独立C++教学演示，不保存输入或轨迹，不计学习完成或积分。所有图形与多视图只读取当前真实执行状态。
      </p>
      <AlgorithmWorkbench
        controller={controller}
        snap={snap}
        source={prepared?.source ?? null}
        renderArrays={(state) => (
          <AlgorithmArrays spec={spec} values={parsed.values} state={state} />
        )}
      />
      <LearningSaveStatus />
      <nav className="advanced-bottom" aria-label="算法导航">
        <Link to="/advanced/algorithms">返回筛法与序列</Link>
        <Link to="/cases">算法与演示</Link>
        <Link to="/advanced">进阶课程与复习入口</Link>
      </nav>
    </div>
  );
}
export default function AdvancedAlgorithmPage() {
  const { caseId } = useParams(),
    spec = findAdvancedAlgorithm(caseId);
  if (caseId && !spec)
    return (
      <MissingPage
        title="找不到这个进阶算法"
        backTo="/advanced/algorithms"
        backLabel="返回筛法与序列"
      />
    );
  if (spec) return <Workspace key={spec.id} spec={spec} />;
  return (
    <div className="advanced-course example-page sieve-page">
      <Breadcrumbs items={[{ label: '进阶课程', to: '/advanced' }, { label: '筛法与序列' }]} />
      <header className="advanced-heading">
        <h1 tabIndex={-1}>筛法与序列</h1>
        <p>从排除一个合数，到保留一项递推状态，沿真实C++执行理解四个算法。</p>
      </header>
      <AdvancedAlgorithmCatalog />
      <p>筛法包含上界0/1，序列允许明确空输入；算法阅读与运行不另记完成或积分。</p>
      <Link to="/advanced">返回进阶课程</Link>
    </div>
  );
}
