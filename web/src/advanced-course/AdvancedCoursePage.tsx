import { KmpCatalog } from '../advanced-algorithms/KmpCatalog';
import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage } from '../components/Ui';
import { ReadingBoundary } from '../components/CourseReading';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { lessonCompletionDetails } from '../learning/completion';
import { KnowledgeMarkButton, KnowledgeMarksStatus } from '../review-notebook/marks';
import { paths } from '../navigation';
import { advancedCourse, advancedChapterProgress, availableAdvancedLesson } from './model';
import './advanced-course.css';
import { ExampleCatalog } from '../examples/ExampleCatalog';
import { AdvancedAlgorithmCatalog } from '../advanced-algorithms/AdvancedAlgorithmCatalog';

export default function AdvancedCoursePage() {
  const { lessonId } = useParams();
  const { state } = useLearning();
  const entry = advancedCourse.lessons.find((item) => item.lessonRef.id === lessonId);
  const resolved = entry ? availableAdvancedLesson(entry, state.reading) : null;
  const details = entry ? lessonCompletionDetails(state, entry.lessonRef.id) : null;
  if (lessonId && !entry)
    return <MissingPage title="找不到这个进阶小节" backTo="/advanced" backLabel="返回进阶课程" />;
  return (
    <div className="advanced-course" data-testid="advanced-course">
      <Breadcrumbs
        items={[
          { label: '学习首页', to: '/' },
          { label: '进阶课程', to: entry ? '/advanced' : undefined },
          ...(entry ? [{ label: entry.title }] : []),
        ]}
      />
      <header className="advanced-heading">
        <h1 tabIndex={-1}>{entry?.title ?? '进阶课程'}</h1>
        <p>
          {entry
            ? '从已有知识出发，读源码、看真实执行，再回到练习检验。'
            : '先把边界、循环与状态学扎实，再走向C++算法。'}
        </p>
      </header>
      <LearningSaveStatus />
      <ReadingBoundary>
        <p className="advanced-rule">
          基础准备进度与C语言课程共用：主动确认学习并通过原小节全部必修题后完成。算法拓展阅读与C++观察单独供学习，不计完成或积分。
        </p>
        {!entry ? (
          <>
            <div className="advanced-chapters">
              {advancedCourse.chapters.map((chapter) => {
                const progress = advancedChapterProgress(chapter.lessonRefs, state);
                return (
                  <section
                    key={chapter.id}
                    aria-labelledby={chapter.id}
                    data-advanced-chapter={chapter.id}
                  >
                    <div className="advanced-chapter-heading">
                      <h2 id={chapter.id}>{chapter.title}</h2>
                      <span data-testid="advanced-chapter-progress">
                        {progress.known
                          ? `${progress.completed}/${progress.total} 基础准备${progress.complete ? '完成' : '已完成'}`
                          : '基础记录暂不可确认'}
                      </span>
                    </div>
                    <ol className="advanced-lesson-list">
                      {chapter.lessonRefs.map((ref) => {
                        const item = advancedCourse.lessons.find(
                          (item) => item.lessonRef.id === ref.id,
                        )!;
                        const source = availableAdvancedLesson(item, state.reading);
                        const saved = source ? lessonCompletionDetails(state, ref.id) : null;
                        return (
                          <li key={ref.id}>
                            <div>
                              <h3>
                                {source ? (
                                  <Link to={`/advanced/${ref.id}`}>{item.title}</Link>
                                ) : (
                                  item.title
                                )}
                              </h3>
                              <p>
                                {source
                                  ? `${source.lesson.title} → C++ ${source.spec.title}`
                                  : '对应课程版本暂不可用，请重试读取扩充课程。'}
                              </p>
                            </div>
                            <span>
                              {!saved
                                ? '记录未就绪'
                                : saved.completed
                                  ? '基础准备完成'
                                  : saved.confirmed
                                    ? '待通过必修题'
                                    : '待确认与练习'}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
            </div>
            <ExampleCatalog />
            <AdvancedAlgorithmCatalog />
            <KmpCatalog />
            <section className="advanced-next">
              <h2>后续课程</h2>
              <p>经典例题已有三例两解，筛法、序列与KMP均可真实运行；语言迁移提供静态对照。</p>
              <p>
                当前可使用上方四节阅读与既有真实案例；C++通用语言课程、Python和Java执行尚未开放，将按后续任务逐项开放。
              </p>
              <Link to="/advanced/migration">语言迁移与语法对照：从已有语言读懂C++</Link>
            </section>
          </>
        ) : !resolved ? (
          <section role="status">
            <h2>对应课程版本暂不可用</h2>
            <p>请使用上方重试入口恢复扩充课程。已有记录保留，本节暂不显示完成。</p>
          </section>
        ) : (
          <>
            <div className="advanced-detail">
              <article>
                <section>
                  <h2>讲解与观察目标</h2>
                  {entry.explanation.map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                </section>
                <section>
                  <h2>复杂度为何如此</h2>
                  <p>
                    <strong>{entry.complexity}</strong>
                  </p>
                  <p>{entry.derivation}</p>
                </section>
                <section>
                  <h2>输入与边界</h2>
                  <ul>
                    {entry.boundaries.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h2>C++案例源码</h2>
                  <p>
                    默认输入：{resolved.spec.defaultInput.join(' ')}
                    。此完整实例与案例工作区默认运行源码相同。
                  </p>
                  <details>
                    <summary>展开{resolved.spec.title}源码</summary>
                    <pre className="sample-source" tabIndex={0} aria-label="进阶案例C++源码">
                      {resolved.prepared.source}
                    </pre>
                  </details>
                </section>
              </article>
              <aside>
                <section>
                  <h2>观察真实执行</h2>
                  <p>运行、前进与后退，查看同游标的源码、数组、内存和调用栈。</p>
                  <Link className="button button-primary" to={`/algorithms/${resolved.spec.id}`}>
                    打开{resolved.spec.title}可视化
                  </Link>
                </section>
                <section data-testid="advanced-lesson-progress">
                  <h2>基础准备清单</h2>
                  <p>
                    {details
                      ? details.completed
                        ? '基础准备完成'
                        : '基础准备尚未完成'
                      : '学习记录尚未读取'}
                  </p>
                  <p>学习确认：{details?.confirmed ? '已保存' : '未确认'}</p>
                  <Link className="text-link" to={paths.lesson(resolved.lesson.id)}>
                    学习或复习：{resolved.lesson.title}
                  </Link>
                  <ul>
                    {resolved.lesson.requiredExerciseRefs.map((ref) => (
                      <li key={ref.id}>
                        <Link to={paths.practice(ref.id)}>
                          {state.reading!.exercises.find((item) => item.id === ref.id)!.title}
                        </Link>{' '}
                        ·{' '}
                        {details?.exercises.find((item) => item.id === ref.id)?.passed
                          ? '已通过并保存'
                          : '待通过'}
                      </li>
                    ))}
                  </ul>
                  {state.temporary && <p role="status">有操作尚未保存；清单仅显示已保存的记录。</p>}
                </section>
                <section>
                  <h2>复习入口</h2>
                  <p>{entry.reviewQuestion}</p>
                  <ul>
                    {entry.knowledgeRefs.map((ref) => (
                      <li key={ref.id}>
                        {state.reading!.knowledgePoints.find((item) => item.id === ref.id)?.title}
                        <KnowledgeMarkButton lessonId={resolved.lesson.id} knowledgeId={ref.id} />
                      </li>
                    ))}
                  </ul>
                  <KnowledgeMarksStatus />
                  <p>
                    <Link to="/notebook">错题与陌生点</Link> · <Link to="/reviews">今日复习</Link>
                  </p>
                </section>
              </aside>
            </div>
            <nav className="advanced-bottom" aria-label="进阶小节导航">
              <Link to="/advanced">返回进阶课程</Link>
              {advancedCourse.lessons[advancedCourse.lessons.indexOf(entry) + 1] && (
                <Link
                  to={`/advanced/${advancedCourse.lessons[advancedCourse.lessons.indexOf(entry) + 1].lessonRef.id}`}
                >
                  下一节阅读 →
                </Link>
              )}
            </nav>
          </>
        )}
      </ReadingBoundary>
    </div>
  );
}
