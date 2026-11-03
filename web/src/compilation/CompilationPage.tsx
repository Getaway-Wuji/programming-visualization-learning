import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Breadcrumbs, PageHeading } from '../components/Ui';
import {
  compilationExample,
  compilationFaults,
  compilationScenarios,
  compilationStages,
} from './content';
import './compilation.css';

export default function CompilationPage() {
  const [scenario, setScenario] = useState<(typeof compilationScenarios)[number]>(
    compilationScenarios[0],
  );
  const [flow, setFlow] = useState({ index: 0, completed: 0, stopped: false });
  const heading = useRef<HTMLHeadingElement>(null);
  const stage = compilationStages[flow.index];
  const example = compilationExample(scenario);
  const hasOutput = flow.index < flow.completed;
  const stopped = flow.stopped && flow.index === flow.completed;
  const fault = compilationFaults[flow.index];
  const reset = () => setFlow({ index: 0, completed: 0, stopped: false });
  const selectStage = (index: number) => {
    if (index < 0 || index > 3 || index > flow.completed) return;
    setFlow({ ...flow, index });
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: 'nearest' });
    });
  };
  return (
    <div
      className="compilation-page"
      data-page-id="PAGE-14-2"
      data-scenario={scenario.id}
      data-stage={flow.index}
      data-completed={flow.completed}
    >
      <Breadcrumbs items={[{ label: '学习首页', to: '/' }, { label: '编译流程' }]} />
      <PageHeading
        kicker="从源码到程序文件"
        title="编译流程，分四步看。"
        description="看清每一步的输入、输出，以及错误为什么会在这里停下。"
      />
      <p className="compilation-notice">
        <strong>教学模拟</strong> · 所有中间内容都是预编写的概念示意。本页不调用
        GCC、汇编器或链接器，不生成机器产物。
      </p>
      <div className="compilation-toolbar">
        <label>
          演示情景
          <select
            value={scenario.id}
            onChange={(event) => {
              setScenario(
                compilationScenarios.find((item) => item.id === event.target.value) ??
                  compilationScenarios[0],
              );
              reset();
            }}
          >
            {compilationScenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <span role="status">已演示 {flow.completed} / 4 个阶段</span>
        <button className="button" onClick={reset}>
          重新开始
        </button>
      </div>
      <ol className="compilation-chain" aria-label="编译四阶段">
        {compilationStages.map((item, index) => (
          <li key={item.title}>
            <button
              type="button"
              aria-current={flow.index === index ? 'step' : undefined}
              disabled={index > flow.completed}
              onClick={() => selectStage(index)}
            >
              <strong>
                {index + 1}. {item.title}
              </strong>
              <span>{item.output}</span>
              <small>
                {index < flow.completed
                  ? '已演示'
                  : flow.stopped && index === flow.completed
                    ? '示例停止'
                    : index === flow.index
                      ? '当前阶段'
                      : '等待前一步'}
              </small>
            </button>
          </li>
        ))}
      </ol>
      <section className="compilation-detail" aria-labelledby="compilation-stage-title">
        <header className="compilation-stage-heading">
          <h2 ref={heading} tabIndex={-1} id="compilation-stage-title">
            第 {flow.index + 1} 步 · {stage.title}
          </h2>
          <span className="muted">
            {hasOutput ? '本阶段已演示' : stopped ? '示例在此停止' : '等待演示'}
          </span>
        </header>
        <p>{stage.job}</p>
        <div className="compilation-artifacts">
          <section aria-label="本阶段输入">
            <h3>输入 · {stage.input}</h3>
            <pre tabIndex={0} aria-label="输入概念示例">
              <code>{flow.index === 0 ? example.source : example.artifacts[flow.index - 1]}</code>
            </pre>
            {flow.index === 0 && example.header && (
              <pre tabIndex={0} aria-label="教学头文件">
                <code>{example.header}</code>
              </pre>
            )}
            {flow.index === 3 && (
              <p className="muted">
                {scenario.id === 'symbol'
                  ? '还需必要的启动代码与库支持；这里没有提供 helper 的定义。'
                  : '还需必要的启动代码与库支持；它们不由头文件替代。'}
              </p>
            )}
          </section>
          <section aria-label="本阶段输出">
            <h3>输出 · {stage.output}</h3>
            <p className="compilation-caption">
              教学模拟 ·{' '}
              {flow.index === 1 ? '架构无关伪汇编，不能交给真实汇编器' : '概念示意，非真实文件'}
            </p>
            {hasOutput ? (
              <pre tabIndex={0} aria-label="输出概念示例" data-testid="compilation-output">
                <code>{example.artifacts[flow.index]}</code>
              </pre>
            ) : (
              <p className="compilation-empty">
                {stopped
                  ? '本阶段没有产物，后续阶段未进行。'
                  : '点击“演示此阶段”查看输入怎样转为下一种表示。'}
              </p>
            )}
            {stopped && (
              <div role="alert" className="compilation-fault">
                <h4>{fault.title}</h4>
                <p>常见错误说明 · 非真实诊断</p>
                <p>{fault.detail}</p>
                <p>
                  <strong>检查方向：</strong>
                  {fault.repair}
                </p>
                <button
                  className="button"
                  onClick={() => {
                    setScenario(compilationScenarios[0]);
                    reset();
                  }}
                >
                  恢复正常示例
                </button>
              </div>
            )}
          </section>
        </div>
        <p>{stage.change}</p>
        <p className="muted">{stage.reminder}</p>
        <div className="compilation-actions">
          <button
            className="button"
            disabled={flow.index === 0}
            onClick={() => selectStage(flow.index - 1)}
          >
            上一步
          </button>
          <button
            className="button button-primary"
            disabled={hasOutput || stopped}
            onClick={() =>
              setFlow(
                scenario.fault === flow.index
                  ? { ...flow, stopped: true }
                  : { ...flow, completed: flow.index + 1 },
              )
            }
          >
            演示此阶段
          </button>
          <button
            className="button"
            disabled={!hasOutput || flow.index === 3}
            onClick={() => selectStage(flow.index + 1)}
          >
            下一步
          </button>
        </div>
        {flow.completed === 4 && (
          <p role="status" className="compilation-complete">
            四阶段示意已完成。这里没有启动程序，也没有生成可执行文件。
          </p>
        )}
      </section>
      <section className="compilation-comparison" aria-labelledby="compilation-compare-title">
        <h2 id="compilation-compare-title">本站怎样运行你的程序？</h2>
        <p>
          本站把受支持的源码交给浏览器内的 Rust
          解释器，进行词法、语法和语义检查，再受限执行并生成真实 Step DSL
          轨迹，供播放器查看变量、输出与源码位置。
        </p>
        <p>
          这条路径不经过上面的原生汇编和链接。识别约定的头文件行，也不等于展开系统头文件；本页的宏与伪汇编示意不代表解释器支持这些写法。
        </p>
        <div className="compilation-links">
          <Link className="button" to="/visualize/case.c.assignment">
            查看真实解释执行
          </Link>
          <Link className="button" to="/practice/exercise.c6.s2.1">
            在练习中查看真实诊断
          </Link>
        </div>
        <p className="muted">本页浏览、回看与重置只改变演示状态，不计入课程完成或积分。</p>
      </section>
      <details className="compilation-sources">
        <summary>概念依据与阅读边界</summary>
        <p>示例只说明传统 C 工具链的基本职责，不涵盖所有优化、平台格式或动态加载细节。</p>
        <ul>
          <li>
            <a
              href="https://gcc.gnu.org/onlinedocs/gcc/Overall-Options.html"
              target="_blank"
              rel="noreferrer"
            >
              GCC：四阶段与文件后缀
            </a>
          </li>
          <li>
            <a
              href="https://gcc.gnu.org/onlinedocs/cpp/Preprocessor-Output.html"
              target="_blank"
              rel="noreferrer"
            >
              GNU CPP：预处理输出
            </a>
          </li>
          <li>
            <a
              href="https://sourceware.org/binutils/docs/as/Overview.html"
              target="_blank"
              rel="noreferrer"
            >
              GNU as：汇编器
            </a>
          </li>
          <li>
            <a
              href="https://sourceware.org/binutils/docs/ld/Overview.html"
              target="_blank"
              rel="noreferrer"
            >
              GNU ld：链接器
            </a>
          </li>
        </ul>
      </details>
    </div>
  );
}
