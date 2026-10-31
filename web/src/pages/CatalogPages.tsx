import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage, PageHeading } from '../components/Ui';
import { Icon } from '../components/Icon';
import { CatalogSample } from '../components/ContentSample';
import { cases, paths } from '../navigation';
import { ReadingBoundary, lessonProgress } from '../components/CourseReading';
import { continueLesson } from '../content/reading';
import { LearningSaveStatus } from '../learning/react';
import { subjectLearningText, useLearning } from '../learning/react';
import { ReconstructionCatalog } from '../practice/ReconstructionPanel';
import { BugCatalogLink } from '../bugs/BugPanel';
import { AlgorithmCatalog } from '../algorithms/AlgorithmCatalog';
import { StructureCatalog } from '../structures/StructureCatalog';
import { NodeCaseCatalog } from '../node-cases/NodeCaseCatalog';
import { ClassicCatalog } from '../classics/ClassicCatalog';

export function CoursePage() {
  const { chapterId } = useParams();
  const { state } = useLearning();
  const reading = state.reading;
  const selected = reading?.chapters.find((chapter) => chapter.id === chapterId);
  const visible = selected ? [selected] : (reading?.chapters ?? []);
  return (
    <div data-page-id="PAGE-02">
      <Breadcrumbs
        items={[
          { label: '学习首页', to: '/' },
          { label: 'C 语言课程', to: selected ? '/courses' : undefined },
          ...(selected ? [{ label: selected.title }] : []),
        ]}
      />
      <PageHeading
        kicker="C 语言入门"
        title={selected?.title ?? '从基础开始，一步步学懂。'}
        description="按章节学习目标、讲解与示例，主动记录学习，并通过必修练习完成小节。"
      />
      <LearningSaveStatus />
      <ReadingBoundary>
        {chapterId && !selected ? (
          <MissingPage title="找不到这个章节" backTo="/courses" backLabel="返回课程目录" />
        ) : (
          <>
            {reading && (
              <div className="inline-actions course-continue">
                <Link
                  className="button button-primary"
                  to={paths.lesson(continueLesson(reading, state.projection))}
                >
                  继续学习
                  <Icon name="arrow" />
                </Link>
                <span className="muted">
                  进度仅保存在当前浏览器；本节学习确认与必修题通过分别记录。
                </span>
              </div>
            )}
            {!selected && <ReconstructionCatalog />}
            {!selected && <BugCatalogLink />}
            <div className="course-grid">
              {visible.map((chapter) => (
                <section className="card chapter-card" key={chapter.id}>
                  <div className="card-header">
                    <span className="chapter-number">{String(chapter.order).padStart(2, '0')}</span>
                    <span className="badge badge-muted">课程阅读</span>
                  </div>
                  <h2>{chapter.title}</h2>
                  <ol className="lesson-list">
                    {chapter.lessonRefs.map((ref, index) => {
                      const lesson = reading!.lessons.find(
                        (item) => item.id === ref.id && item.version === ref.version,
                      );
                      return (
                        <li key={ref.id} data-course-lesson={ref.id}>
                          {lesson ? (
                            <Link className="lesson-link" to={paths.lesson(lesson.id)}>
                              <span className="lesson-order">{index + 1}</span>
                              <span className="lesson-copy">
                                <strong className="lesson-title">{lesson.title}</strong>
                                <span className="lesson-status">
                                  {lessonProgress(state, lesson.id)}
                                </span>
                              </span>
                              <Icon name="chevron" />
                            </Link>
                          ) : (
                            <p role="alert">课程内容缺失</p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>
          </>
        )}
      </ReadingBoundary>
    </div>
  );
}

export function CasesPage() {
  const { state } = useLearning();
  return (
    <div data-page-id="PAGE-05">
      <Breadcrumbs items={[{ label: '学习首页', to: '/' }, { label: '算法与演示' }]} />
      <PageHeading
        kicker="看懂程序怎样执行"
        title="让数据变化，有迹可循。"
        description="选择案例、输入数据，运行实际源码并逐步查看变化。原C案例完整观看后主动确认可获首次奖励；新增C++观察不计积分。"
      />
      <CatalogSample kind="case" />
      <p className="muted">
        建议按顺序学习：基础语法演示 → 排序与查找 → 数据结构 → 经典问题与进阶观察。
      </p>
      {(['demo', 'algorithm'] as const).map((kind) => (
        <section key={kind}>
          <div className="section-heading">
            <h2>{kind === 'demo' ? '基础语法演示' : '排序与查找'}</h2>
            <span className="badge badge-muted">
              {kind === 'demo' ? '4 个语法演示' : '3 个算法案例'}
            </span>
          </div>
          <div className="case-grid">
            {cases
              .filter((item) => item.kind === kind)
              .map((item) => (
                <article className="card case-card" key={item.id}>
                  <div className="case-icon">
                    <Icon name={kind === 'demo' ? 'code' : 'chart'} />
                  </div>
                  <h3>{item.title}</h3>
                  <p className="muted">{item.description}</p>
                  {item.id === 'case.c.binary-search-first' && (
                    <p className="notice">输入须为非递减数组。</p>
                  )}
                  <span className="badge badge-muted">可运行与回放</span>
                  <p className="muted">{subjectLearningText(state, 'case', item.id)}</p>
                  <Link className="card-link" to={paths.visualize(item.id)}>
                    查看演示工作区
                    <Icon name="arrow" />
                  </Link>
                </article>
              ))}
          </div>
        </section>
      ))}
      <AlgorithmCatalog />
      <p>
        <Link className="button" to="/compare">
          打开同数据双算法对比
        </Link>{' '}
        比较冒泡与选择排序，或归并与快速排序。
      </p>
      <StructureCatalog />
      <NodeCaseCatalog />
      <ClassicCatalog />
      <section aria-labelledby="advanced-observation-title">
        <div className="section-heading">
          <h2 id="advanced-observation-title">进阶观察 · 内存与调用栈</h2>
        </div>
        <p>
          <Link className="text-link" to="/memory">
            打开内存观察 →
          </Link>{' '}
          逐步查看指针、对象与教学地址。
        </p>
        <p>
          <Link className="text-link" to="/memory?example=hanoi&view=stack">
            打开递归与调用栈 →
          </Link>{' '}
          观察函数进入、返回及局部状态，点击源码行号设置断点。
        </p>
      </section>
    </div>
  );
}
