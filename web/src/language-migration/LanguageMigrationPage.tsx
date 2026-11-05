import { useEffect, useReducer } from 'react';
import { Link } from 'react-router';
import { Breadcrumbs } from '../components/Ui';
import { useLearning, LearningSaveStatus } from '../learning/react';
import { paths } from '../navigation';
import {
  availableMigrationLesson,
  languageIds,
  languageInfo,
  migrationContent,
  initialTeachingState,
  teachingReducer,
} from './model';
import '../advanced-course/advanced-course.css';
import './migration.css';

export default function LanguageMigrationPage() {
  const { state: learning, service } = useLearning();
  const [state, dispatch] = useReducer(teachingReducer, initialTeachingState);
  const topic = migrationContent.topics.find((t) => t.id === state.topic)!;
  const lesson = availableMigrationLesson(topic, learning.reading);
  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') dispatch({ type: 'pause' });
      else dispatch({ type: 'tick', generation: state.generation });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [state.playing, state.cursor, state.generation]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== 'visible') dispatch({ type: 'pause' });
    };
    document.addEventListener('visibilitychange', hidden);
    const unsubscribe = service.subscribeSessionInvalidation(() => dispatch({ type: 'pause' }));
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      unsubscribe();
    };
  }, [service]);
  return (
    <div
      className="advanced-course migration-page"
      data-testid="language-migration"
      data-known={state.known}
      data-target={state.target}
      data-topic={state.topic}
      data-cursor={state.cursor}
      data-playing={state.playing}
    >
      <Breadcrumbs
        items={[{ label: '进阶课程', to: '/advanced' }, { label: '语言迁移与语法对照' }]}
      />
      <header className="advanced-heading">
        <h1 tabIndex={-1}>语言迁移与语法对照</h1>
        <p>从熟悉的语言出发，比较写法与边界，先读懂当前C++算法。</p>
      </header>
      <p className="migration-boundary">
        静态教学对照：代码与标注均为预写内容，不执行代码，不产生真实轨迹，也不计学习完成或积分。
      </p>
      <div className="migration-selectors">
        <label>
          已有语言
          <select
            aria-label="已有语言"
            value={state.known}
            onChange={(e) => dispatch({ type: 'known', value: e.target.value })}
          >
            {languageIds.map((id) => (
              <option key={id} value={id}>
                {languageInfo(id).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          对照语言
          <select
            aria-label="对照语言"
            value={state.target}
            onChange={(e) => dispatch({ type: 'target', value: e.target.value })}
          >
            {languageIds.map((id) => (
              <option key={id} value={id} disabled={id === state.known}>
                {languageInfo(id).label}
              </option>
            ))}
          </select>
        </label>
        <label>
          阅读主题
          <select
            aria-label="阅读主题"
            value={state.topic}
            onChange={(e) => dispatch({ type: 'topic', value: e.target.value })}
          >
            {migrationContent.topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="migration-order">
        <summary>建议顺序：C → C++ → Python → Java</summary>
        <ol>
          {languageIds.map((id) => (
            <li key={id} aria-current={state.known === id ? 'step' : undefined}>
              {languageInfo(id).label}
              {state.known === id ? ' · 你选择的基础' : ''}
            </li>
          ))}
        </ol>
        <p className="muted">
          顺序用于引导阅读，可切换对照回看差异；选择已有语言不会改变学习记录。
        </p>
      </details>
      <p data-testid="migration-bridge">{languageInfo(state.known).bridge}</p>
      <section aria-labelledby="migration-topic-title" className="migration-comparison">
        <h2 id="migration-topic-title">{topic.title}</h2>
        <p>{topic.question}</p>
        <div className="migration-playback" aria-label="教学标注控制">
          <button
            className="button button-small"
            disabled={state.cursor === 0}
            onClick={() => dispatch({ type: 'step', delta: -1 })}
          >
            上一步标注
          </button>
          <button
            className="button button-small"
            disabled={state.cursor === 3}
            onClick={() => dispatch({ type: 'step', delta: 1 })}
          >
            下一步标注
          </button>
          <button
            className="button button-primary button-small"
            onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}
          >
            {state.playing ? '暂停标注' : '播放教学标注'}
          </button>
          <button className="button button-small" onClick={() => dispatch({ type: 'reset' })}>
            重置标注
          </button>
          <span data-testid="migration-step-status" role="status">
            标注 {state.cursor}/3 · {state.playing ? '播放中' : '已暂停'}
          </span>
        </div>
        <p className="muted">
          每1.2秒切换一条阅读标注，可手动前后查看；它强调语法与含义，不模拟程序求值。
        </p>
        <div className="migration-code-pair">
          {([state.known, state.target] as const).map((id) => {
            const info = languageInfo(id),
              snippet = topic.snippets[id],
              step = snippet.steps[state.cursor - 1];
            return (
              <article
                key={id}
                className="migration-snippet"
                data-testid="migration-snippet"
                data-language={id}
              >
                <h3>
                  {info.label} <span>{info.reference}</span>
                </h3>
                <p className="migration-context">{snippet.context}</p>
                <pre aria-label={info.label + '静态代码'}>
                  <code>
                    {snippet.code.split('\n').map((line, i) => (
                      <span
                        key={i}
                        data-line={i + 1}
                        data-highlighted={!!step?.lines.includes(i + 1)}
                      >
                        {step?.lines.includes(i + 1) ? <mark>{line || ' '}</mark> : line || ' '}
                        {i < snippet.code.split('\n').length - 1 ? '\n' : ''}
                      </span>
                    ))}
                  </code>
                </pre>
                <div className="migration-annotation" data-testid="migration-annotation">
                  <h4>{step?.label ?? '先读完整片段'}</h4>
                  <p>
                    {step?.explanation ?? '用下一步或播放逐条强调声明、操作和边界；尚未选择标注。'}
                  </p>
                </div>
                <ul>
                  {snippet.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
        <p className="migration-caution">{topic.caution}</p>
      </section>
      <div className="migration-followup">
        <section aria-labelledby="migration-review-title">
          <h2 id="migration-review-title">基础准备与复习</h2>
          <p>{topic.reviewQuestion}</p>
          {lesson ? (
            <>
              <Link to={paths.lesson(lesson.id)}>回到原C小节：{lesson.title}</Link>
              <ul>
                {lesson.requiredExerciseRefs.map((ref) => (
                  <li key={ref.id}>
                    <Link to={paths.practice(ref.id)}>
                      {learning.reading!.exercises.find((e) => e.id === ref.id)!.title}
                    </Link>
                  </li>
                ))}
              </ul>
              <p>
                原知识点：
                {topic.knowledgeRefs
                  .map(
                    (ref) => learning.reading!.knowledgePoints.find((k) => k.id === ref.id)!.title,
                  )
                  .join('、')}
                。可在原小节标记陌生点。
              </p>
            </>
          ) : (
            <p role="status">
              基础课程版本暂不可用，不能确认原小节与练习引用；静态对照仍可阅读。可返回课程重新读取。
            </p>
          )}
          <p>
            {' '}
            <Link to="/notebook">错题与陌生点</Link> · <Link to="/courses">C课程目录</Link>
          </p>
        </section>
        <section aria-labelledby="migration-execution-title">
          <h2 id="migration-execution-title">接着看真实案例</h2>
          <p>现有C工作台与C/C++案例仅支持各自已验教学子集；本页24份静态片段不会送入引擎。</p>
          <ul>
            <li>
              <Link to="/visualize/case.c.loops">C循环真实观察</Link>
            </li>
            <li>
              <Link to="/algorithms/case.cpp.insertion-sort">C++插入排序真实观察</Link>
            </li>
            <li>
              <Link to="/advanced/algorithms/case.cpp.kmp">C++ KMP真实观察</Link>
            </li>
          </ul>
          <p>
            C++通用语言课程、Python与Java的完整执行学习闭环尚未开放，按后续任务逐项开放。静态对照不能代替真实执行验收。
          </p>
        </section>
      </div>
      <details className="migration-sources">
        <summary>版本参照与官方资料</summary>
        {migrationContent.languages.map((l) => (
          <section key={l.id}>
            <h3>{l.reference}</h3>
            <ul>
              {l.sourceRefs.map((ref) => (
                <li key={ref.url}>
                  <a href={ref.url} target="_blank" rel="noreferrer">
                    {ref.label}
                  </a>{' '}
                  · {ref.sections}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p>
          片段与解释独立编写，已按上述官方资料核验语义；本页未编译运行这些片段。打开外部资料需要网络，基础教学不依赖外部资料或AI。
        </p>
      </details>
      <LearningSaveStatus />
      <nav className="advanced-bottom" aria-label="语言迁移导航">
        <Link to="/advanced">返回进阶课程</Link>
        <Link to="/cases">算法与演示</Link>
      </nav>
    </div>
  );
}
