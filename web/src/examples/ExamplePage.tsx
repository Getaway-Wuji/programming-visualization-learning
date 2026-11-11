import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage } from '../components/Ui';
import { CaseWalkthrough } from '../components/CaseWalkthrough';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { lessonCompletionDetails } from '../learning/completion';
import { KnowledgeMarkButton, KnowledgeMarksStatus } from '../review-notebook/marks';
import { CustomCodeController } from '../custom-code/controller';
import { CustomViews } from '../custom-code/Views';
import { Workbench } from '../workbench/Workbench';
import { DebugSource } from '../debug/DebugSource';
import { memoryDiagnostics, memoryStepLabels } from '../memory/presentation';
import { findExample, parseExampleInput, prepareExample, type ExampleSpec } from './content';
import { ExampleCatalog } from './ExampleCatalog';
import '../advanced-course/advanced-course.css';
import '../custom-code/custom-code.css';
import './examples.css';
import { C6Foundation } from '../c6-learning/foundations';

function ExampleWorkspace({ spec }: { spec: ExampleSpec }) {
  const { state: learning, service } = useLearning();
  const [controller] = useState(() => new CustomCodeController());
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [draft, setDraft] = useState(spec.defaults.values.join(' '));
  const [target, setTarget] = useState(
    spec.defaults.target === undefined ? '' : String(spec.defaults.target),
  );
  const [mode, setMode] = useState('basic'),
    [sample, setSample] = useState('');
  const parsed = useMemo(() => parseExampleInput(spec, draft, target), [spec, draft, target]);
  const prepared = parsed.valid ? prepareExample(spec, parsed.input) : null;
  const source = prepared?.source ?? '';
  const { view, result, status } = snap;
  useEffect(() => {
    controller.setSource(prepareExample(spec, spec.defaults).source, 'cpp');
    const unsubscribe = service.subscribeSessionInvalidation(() => controller.invalidate());
    const hidden = () => {
      if (document.visibilityState !== 'visible') controller.pause();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      controller.invalidate();
      unsubscribe();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [controller, service, spec]);
  const change = (values: string, nextTarget: string, key = '') => {
    controller.invalidate();
    const next = parseExampleInput(spec, values, nextTarget);
    controller.setSource(next.valid ? prepareExample(spec, next.input).source : '', 'cpp');
    setDraft(values);
    setTarget(nextTarget);
    setSample(key);
  };
  const stop = useCallback(
    (visible: boolean) => {
      if (!visible) controller.pause();
    },
    [controller],
  );
  const lesson = learning.reading?.lessons.find(
    (item) =>
      item.id === spec.prerequisiteLessonRef.id &&
      item.version === spec.prerequisiteLessonRef.version,
  );
  const progress = lesson ? lessonCompletionDetails(learning, lesson.id) : null;
  const available = !!view.state;
  const range =
    result?.terminal.status !== 'completed' && view.cursor === view.length
      ? (result?.terminal.byteRange ?? view.byteRange)
      : view.byteRange;
  const valuesObject = view.state?.objects.find(
    (object) => object.name === 'values' && object.typeName === 'int' && object.alive,
  );
  return (
    <div
      className="advanced-course example-page"
      data-testid="example-workspace"
      data-state={status}
      data-example={spec.id}
      data-solution={spec.solutionRef.id}
      data-cursor={view.cursor}
      data-length={view.length}
    >
      <Breadcrumbs
        items={[
          { label: '进阶课程', to: '/advanced' },
          { label: '经典例题', to: '/advanced/examples' },
          { label: spec.topic },
        ]}
      />
      <header className="advanced-heading">
        <h1 tabIndex={-1}>{spec.title}</h1>
        <p>{spec.statement}</p>
      </header>
      <p className="example-domain">{spec.platformConstraints}</p>
      <p>
        <Link to={`/advanced/examples/${spec.id}/compare`}>对比本题两种C++方案与复杂度 →</Link>
      </p>
      <form
        className="example-input"
        onSubmit={(event) => {
          event.preventDefault();
          if (prepared && status !== 'running')
            void controller.execute(prepared.source, 'cpp', prepared.input);
        }}
      >
        <label>
          整数数组
          <input
            data-testid="example-values"
            value={draft}
            maxLength={1024}
            onChange={(event) => change(event.target.value, target)}
            aria-invalid={!parsed.valid}
            aria-describedby="example-input-help"
          />
        </label>
        {spec.hasTarget && (
          <label>
            目标值
            <input
              data-testid="example-target"
              value={target}
              maxLength={16}
              inputMode="numeric"
              onChange={(event) => change(draft, event.target.value)}
              aria-invalid={!parsed.valid}
              aria-describedby="example-input-help"
            />
          </label>
        )}
        <div className="inline-actions">
          <button
            className="button button-primary"
            type="submit"
            disabled={!prepared || status === 'running'}
          >
            运行C++例题
          </button>
          <button
            className="button"
            type="button"
            onClick={() =>
              change(
                spec.defaults.values.join(' '),
                spec.defaults.target === undefined ? '' : String(spec.defaults.target),
              )
            }
          >
            恢复示例输入
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
            aria-label="例题边界样例"
            value={sample}
            onChange={(event) => {
              const item = spec.samples.find((item) => item.key === event.target.value);
              if (item)
                change(
                  item.values.join(' '),
                  item.target === undefined ? '' : String(item.target),
                  item.key,
                );
            }}
          >
            <option value="">选择一组输入</option>
            {spec.samples.map((item, index) => (
              <option key={item.key} value={item.key}>
                {index + 1} · {item.values.join(', ')}
                {item.target === undefined ? '' : ` → 目标${item.target}`}
                {item.expectedReturn ? '（输入约定反例）' : ''}
              </option>
            ))}
          </select>
        </label>
        <p id="example-input-help" role={!parsed.valid ? 'alert' : undefined}>
          {parsed.valid
            ? '长度与数值格式有效；本例的答案与额外输入承诺由实际C++执行检查。'
            : parsed.issue}
        </p>
      </form>
      <details className="example-reading">
        <summary>讲解、复杂度、边界与原始来源</summary>
        <div className="example-reading-grid">
          <section>
            <h2>{spec.strategy}</h2>
            {spec.explanation.map((text) => (
              <p key={text}>{text}</p>
            ))}
            <h3>复杂度</h3>
            <p>
              <strong>{spec.complexity}</strong>
            </p>
            <p>{spec.derivation}</p>
            <h3>常见误区</h3>
            <ul>
              {spec.pitfalls.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </section>
          <section>
            <h2>来源与范围</h2>
            <p>
              <a href={spec.source.url} target="_blank" rel="noreferrer noopener">
                力扣 {spec.source.problemNumber} · {spec.source.title} 原题
              </a>
            </p>
            <p>{spec.originalConstraints}</p>
            <p>
              来源核验日期：{spec.source.checkedAt}。{spec.source.use}
            </p>
            <p>
              没有本项目书面授权记录；仅作来源链接与独立教学概括。
              <a href={spec.source.termsUrl} target="_blank" rel="noreferrer noopener">
                查看来源站条款
              </a>
            </p>
            <p>本页采用完整main与标准流输入输出，教学范围更小；不是原站的完整评测环境。</p>
            <h3>复习与基础准备</h3>
            <p>{spec.reviewQuestion}</p>
            {learning.c6 ? (
              <C6Foundation prior={spec.prerequisiteLessonRef} />
            ) : lesson ? (
              <>
                <p>
                  <Link to={`/lessons/${lesson.id}`}>{lesson.title}</Link> ·{' '}
                  {progress?.completed ? '基础准备完成' : '查看原小节学习清单'}
                </p>
                <ul>
                  {spec.knowledgeRefs.map((ref) => (
                    <li key={ref.id}>
                      {learning.reading?.knowledgePoints.find((item) => item.id === ref.id)?.title}
                      <KnowledgeMarkButton lessonId={lesson.id} knowledgeId={ref.id} />
                    </li>
                  ))}
                </ul>
                <KnowledgeMarksStatus />
              </>
            ) : (
              <p>对应基础记录暂不可用；例题仍可独立阅读与运行。</p>
            )}
            <p>
              {' '}
              <Link to="/notebook">错题与陌生点</Link>
            </p>
          </section>
        </div>
      </details>
      <p className="muted">
        当前单方案演示不保存代码、输入或轨迹，不计题目通过或积分；原学习记录继续在统一档案中保存。
      </p>
      <Workbench
        kind="visualize"
        firstLabel="同源C++代码"
        secondLabel="真实执行观察"
        onSecondVisibility={stop}
        first={
          <section className="example-code memory-source">
            <h2>本次执行的C++源码</h2>
            {prepared ? (
              <DebugSource
                source={source}
                byteRange={range ?? null}
                breakpoints={snap.breakpoints}
                visitedLines={snap.visitedLines}
                ready={!!result}
                onToggle={(line) => controller.toggleBreakpoint(line)}
              />
            ) : (
              <p>输入无效，请先修正上方输入；旧运行已经失效。</p>
            )}
          </section>
        }
        second={
          <section
            className="custom-stage example-stage"
            aria-label="例题执行观察"
            tabIndex={0}
            onKeyDown={(event) => {
              if (
                (event.target as HTMLElement).closest('button,input,select,textarea,a') ||
                event.ctrlKey ||
                event.altKey ||
                event.metaKey
              )
                return;
              if (event.code === 'Space') {
                event.preventDefault();
                controller.toggle();
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                controller.step(event.key === 'ArrowLeft' ? -1 : 1);
              }
            }}
          >
            <h2>执行观察</h2>
            <p role="status" data-testid="example-run-status">
              {status === 'running'
                ? '正在执行并检查真实轨迹……'
                : status === 'failed'
                  ? `本次运行未接收：${snap.error}。可重新运行。`
                  : result
                    ? result.terminal.status === 'completed'
                      ? result.terminal.returnValue === 0
                        ? '程序已正常结束；从初态逐步查看。'
                        : '实际程序检查到输入约定不满足，返回1；可回放并更换输入。'
                      : `程序停止：${result.terminal.code ?? result.terminal.status}`
                    : '运行后，从初始状态查看变化。'}
            </p>
            {result?.terminal.code && (
              <p role="alert">
                {result.terminal.code} ·{' '}
                {memoryDiagnostics[result.terminal.code] ?? '本次程序未能继续。'}
              </p>
            )}
            <div className="custom-playback">
              <button
                className="button button-small"
                disabled={!available || view.cursor === 0}
                onClick={() => controller.step(-1)}
              >
                后退
              </button>
              <button
                className="button button-small"
                disabled={!available || view.cursor === view.length}
                onClick={() => controller.step(1)}
              >
                前进
              </button>
              <button
                className="button button-small"
                disabled={!available || (!view.playing && view.cursor === view.length)}
                onClick={() => controller.toggle()}
              >
                {view.playing ? '暂停' : '播放'}
              </button>
              <button
                className="button button-small"
                disabled={!available}
                onClick={() => controller.seek(0)}
              >
                回到初态
              </button>
              <button
                className="button button-small"
                disabled={!available}
                onClick={() => controller.seek(view.length)}
              >
                查看末步
              </button>
              <label>
                速度
                <select
                  aria-label="例题播放速度"
                  value={snap.rate}
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
            <label className="custom-cursor">
              步骤 {view.cursor} / {view.length}
              <input
                type="range"
                aria-label="例题执行步骤"
                min={0}
                max={Math.max(1, view.length)}
                value={view.cursor}
                disabled={!available}
                onChange={(event) => controller.seek(Number(event.target.value))}
              />
            </label>
            <p>
              {view.stepKind ? (memoryStepLabels[view.stepKind] ?? '执行步骤') : '初始状态'}
              {snap.hit ? ` · 已命中第${snap.hit.line}行断点` : ''}
            </p>
            <label>
              观察视图
              <select
                aria-label="例题观察视图"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                <option value="basic">变量与数组</option>
                <option value="memory">内存</option>
                <option value="stack">调用栈</option>
              </select>
            </label>
            {view.state && result ? (
              <>
                <section
                  className="example-array"
                  aria-label="例题逻辑数组"
                  data-testid="example-array"
                >
                  {valuesObject ? (
                    <ol>
                      {Array.from({ length: parsed.input.values.length }, (_, index) => (
                        <li key={index} data-index={index}>
                          <small>[{index}]</small>
                          <strong>
                            {String(
                              valuesObject.cells.find((cell) => cell.byteOffset === index * 4)
                                ?.value ?? (valuesObject.zeroInitialized ? 0 : '未初始化'),
                            )}
                          </strong>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>当前数组尚未声明或已结束；前进/后退可查看。</p>
                  )}
                </section>
                <CustomViews state={view.state} result={result} mode={mode} />
              </>
            ) : (
              <p>这里将呈现当前游标的真实状态。</p>
            )}
            {result && view.cursor === view.length && (
              <p data-testid="example-terminal">
                终态：{result.terminal.status} · 返回值{result.terminal.returnValue ?? '无'}
              </p>
            )}
          </section>
        }
      />
      <LearningSaveStatus />
      <CaseWalkthrough caseId={spec.id} returnTo="/advanced" />
      <nav className="advanced-bottom" aria-label="例题导航">
        <Link to="/advanced/examples">返回经典例题</Link>
        <Link to="/advanced">返回进阶课程</Link>
      </nav>
    </div>
  );
}
export default function ExamplePage() {
  const { exampleId } = useParams();
  const spec = findExample(exampleId);
  if (exampleId && !spec)
    return (
      <MissingPage
        title="找不到这个经典例题"
        backTo="/advanced/examples"
        backLabel="返回经典例题"
      />
    );
  if (spec) return <ExampleWorkspace key={spec.id} spec={spec} />;
  return (
    <div className="advanced-course example-page" data-testid="example-catalog">
      <Breadcrumbs items={[{ label: '进阶课程', to: '/advanced' }, { label: '经典例题' }]} />
      <header className="advanced-heading">
        <h1 tabIndex={-1}>经典例题</h1>
        <p>把枚举、数组写入和二分边界，放回一个具体问题中理解。</p>
      </header>
      <ExampleCatalog />
      <p>
        三题讲解、代码与输入样例随应用提供。原始题目链接仅供核对，外部网站不可用时仍能学习和运行。
      </p>
      <p>每题提供两种真实C++方案，可在共同输入上对比结果、边界处理与复杂度。</p>
      <Link to="/advanced">返回进阶课程</Link>
    </div>
  );
}
