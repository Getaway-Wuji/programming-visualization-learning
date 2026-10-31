import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { Breadcrumbs } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { CustomCodeController } from '../custom-code/controller';
import { AlgorithmWorkbench } from './AlgorithmWorkbench';
import { AlgorithmReading } from './AlgorithmReading';
import { KmpState } from './KmpState';
import { kmpSpec, parseKmpInput, prepareKmp, validKmpLine } from './kmp-content';
import '../advanced-course/advanced-course.css';
import '../custom-code/custom-code.css';
import '../examples/examples.css';
import './algorithms.css';
import './kmp.css';

export default function KmpPage() {
  const { service } = useLearning();
  const [controller] = useState(() => new CustomCodeController()),
    [draft, setDraft] = useState(kmpSpec.defaults),
    [sample, setSample] = useState('');
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot),
    parsed = parseKmpInput(draft.text, draft.pattern),
    prepared = parsed.valid ? prepareKmp(draft.text, draft.pattern) : null;
  useEffect(() => {
    controller.setSource(prepareKmp(kmpSpec.defaults.text, kmpSpec.defaults.pattern).source, 'cpp');
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
  }, [controller, service]);
  const change = (next: { text: string; pattern: string }, key = '') => {
    controller.invalidate();
    controller.setSource(
      parseKmpInput(next.text, next.pattern).valid
        ? prepareKmp(next.text, next.pattern).source
        : '',
      'cpp',
    );
    setDraft(next);
    setSample(key);
  };
  return (
    <div
      className="advanced-course example-page sieve-page kmp-page"
      data-testid="kmp-workspace"
      data-case={kmpSpec.id}
      data-state={snap.status}
      data-cursor={snap.view.cursor}
      data-length={snap.view.length}
    >
      <Breadcrumbs
        items={[
          { label: '进阶课程', to: '/advanced' },
          { label: '算法与演示', to: '/cases' },
          { label: kmpSpec.title },
        ]}
      />
      <header className="advanced-heading">
        <h1 tabIndex={-1}>{kmpSpec.title}</h1>
        <p>{kmpSpec.statement}</p>
      </header>
      <form
        className="example-input kmp-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (prepared && snap.status !== 'running')
            void controller.execute(prepared.source, 'cpp', prepared.input);
        }}
      >
        {(['text', 'pattern'] as const).map((key) => (
          <label key={key}>
            {key === 'text' ? '文本 text' : '模式 pattern'}
            <input
              data-testid={'kmp-' + key + '-input'}
              value={draft[key]}
              maxLength={1024}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!validKmpLine(draft[key])}
              aria-describedby="kmp-input-help"
              onChange={(e) => change({ ...draft, [key]: e.target.value })}
            />
            <small>
              {validKmpLine(draft[key])
                ? `${draft[key].length}/30 字节；${draft[key] === '' ? '明确空串' : '空格按原样保留'}`
                : '输入超出长度或字符范围'}
            </small>
          </label>
        ))}
        <div className="inline-actions">
          <button
            className="button button-primary"
            type="submit"
            disabled={!prepared || snap.status === 'running'}
          >
            运行C++ KMP
          </button>
          <button className="button" type="button" onClick={() => change(kmpSpec.defaults)}>
            恢复默认输入
          </button>
          {snap.status === 'running' && (
            <button className="button" type="button" onClick={() => controller.cancel()}>
              取消运行
            </button>
          )}
        </div>
        <label>
          边界样例
          <select
            aria-label="KMP边界样例"
            value={sample}
            onChange={(e) => {
              const item = kmpSpec.samples.find((s) => s.key === e.target.value);
              if (item) change({ text: item.text, pattern: item.pattern }, item.key);
            }}
          >
            <option value="">选择一组输入</option>
            {kmpSpec.samples.map((s) => (
              <option key={s.key} value={s.key}>
                {s.key} · 文本{s.text.length}/模式{s.pattern.length}字节
              </option>
            ))}
          </select>
        </label>
        <p id="kmp-input-help" role={!parsed.valid ? 'alert' : undefined}>
          {parsed.valid ? kmpSpec.platformConstraints : parsed.issue}
        </p>
      </form>
      <AlgorithmReading spec={kmpSpec} />
      <p className="muted">
        独立C++教学演示，不保存文本、模式或轨迹，不计学习完成或积分。输出首个匹配位置，前缀表和指针来自真实执行。
      </p>
      <AlgorithmWorkbench
        controller={controller}
        snap={snap}
        source={prepared?.source ?? null}
        renderArrays={(state) => <KmpState state={state} />}
      />
      <LearningSaveStatus />
      <nav className="advanced-bottom" aria-label="KMP导航">
        <Link to="/advanced/algorithms">筛法与序列</Link>
        <Link to="/cases">算法与演示</Link>
        <Link to="/advanced">进阶课程与复习入口</Link>
      </nav>
    </div>
  );
}
