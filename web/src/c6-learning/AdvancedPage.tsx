import { Link } from 'react-router';
import { advancedCourse } from '../advanced-course/model';
import { allSortCases, prepareSort } from '../algorithms/content';
import { useLearning } from '../learning/react';
import { C6Foundation, c6Foundation } from './foundations';
import { ExampleCatalog } from '../examples/ExampleCatalog';
import { AdvancedAlgorithmCatalog } from '../advanced-algorithms/AdvancedAlgorithmCatalog';
import { KmpCatalog } from '../advanced-algorithms/KmpCatalog';
import { C6Boundary } from './CoursePages';

export function C6AdvancedPage({ lessonId }: { lessonId?: string }) {
  const { state } = useLearning();
  const entry = advancedCourse.lessons.find((l) => l.lessonRef.id === lessonId);
  const spec =
    entry &&
    allSortCases.find((c) => c.id === entry.caseRef.id && c.version === entry.caseRef.version);
  return (
    <C6Boundary>
      <div className="advanced-course" data-testid="advanced-course">
        <header className="advanced-heading">
          <h1>{entry?.title ?? '进阶课程'}</h1>
          <p>从新书中的边界、循环与状态出发，观察已支持的 C++ 算法。</p>
        </header>
        {lessonId && !entry ? (
          <p>
            找不到这个进阶小节。<Link to="/advanced">返回目录</Link>
          </p>
        ) : !entry ? (
          <>
            {advancedCourse.chapters.map((chapter) => (
              <section key={chapter.id}>
                <h2>{chapter.title}</h2>
                <ol className="advanced-lesson-list">
                  {chapter.lessonRefs.map((ref) => {
                    const item = advancedCourse.lessons.find((l) => l.lessonRef.id === ref.id)!;
                    const preparation = c6Foundation(state, ref);
                    return (
                      <li key={ref.id}>
                        <div>
                          <h3>
                            <Link to={`/advanced/${ref.id}`}>{item.title}</Link>
                          </h3>
                          <p>
                            {preparation?.known
                              ? preparation.completed
                                ? '基础准备完成'
                                : '基础准备尚未完成'
                              : '学习记录待确认'}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            <ExampleCatalog />
            <AdvancedAlgorithmCatalog />
            <KmpCatalog />
            <p>
              <Link to="/advanced/migration">语言迁移与语法对照</Link>
            </p>
          </>
        ) : (
          <>
            <p>
              <Link to="/advanced">返回进阶目录</Link>
            </p>
            <div className="advanced-detail">
              <article>
                <h2>讲解与观察目标</h2>
                {entry.explanation.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                <h2>复杂度为何如此</h2>
                <p>
                  <strong>{entry.complexity}</strong>
                </p>
                <p>{entry.derivation}</p>
                <h2>输入与边界</h2>
                <ul>
                  {entry.boundaries.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                {spec && (
                  <>
                    <h2>C++ 案例完整源码</h2>
                    <pre className="sample-source" tabIndex={0}>
                      {prepareSort(spec, spec.defaultInput).source}
                    </pre>
                    <Link className="button button-primary" to={`/algorithms/${spec.id}`}>
                      打开{spec.title}可视化
                    </Link>
                  </>
                )}
              </article>
              <aside>
                <h2>基础准备与复习</h2>
                <p>{entry.reviewQuestion}</p>
                <C6Foundation prior={entry.lessonRef} />
                <p>拓展阅读与算法观察不增加课程完成或积分。</p>
                <Link to="/reviews">今日复习</Link>
              </aside>
            </div>
          </>
        )}
      </div>
    </C6Boundary>
  );
}
