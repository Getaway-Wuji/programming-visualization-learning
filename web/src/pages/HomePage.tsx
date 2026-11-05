import { continueLesson } from '../content/reading';
import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { PageHeading } from '../components/Ui';
import { chapters, lessons, paths } from '../navigation';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { DailyGoalSummary } from '../learning/goal-components';
import { savedCourseProjection } from '../learning/profile-components';
import '../learning/rewards.css';
import { HomePanel, homePanels } from '../learning/HomePanel';
import { KnowledgeMap } from '../knowledge/KnowledgeMap';
import { ReviewDueSummary } from '../review-scheduler/react';

export function HomePage() {
  const [search, setSearch] = useSearchParams();
  const { state } = useLearning();
  const projection = savedCourseProjection(state);
  const completed = projection?.lessons.filter((lesson) => lesson.completed).length ?? 0;
  const courseTotal = state.reading?.lessons.length ?? lessons.length;
  const courseKnown = !!projection && state.readingStatus === 'ready';
  const nextId = state.reading
    ? continueLesson(state.reading, projection, state.snapshot?.aliases)
    : lessons[0].id;
  const nextLesson = state.reading?.lessons.find((lesson) => lesson.id === nextId);
  const nextNavigation = lessons.find((lesson) => lesson.id === nextId);
  const nextChapterId = nextLesson?.chapterRef.id ?? nextNavigation?.chapterId;
  const nextChapter = chapters.find((chapter) => chapter.id === nextChapterId);
  const nextTitle = nextLesson?.title ?? nextNavigation?.title ?? '当前课程';
  const courseProgress = courseKnown && courseTotal ? (completed / courseTotal) * 100 : 0;
  const requested = search.get('panel');
  const panel =
    requested && Object.hasOwn(homePanels, requested)
      ? (requested as keyof typeof homePanels)
      : null;
  return (
    <div className="p05-home" data-page-id="PAGE-01">
      <div className="home-heading">
        <PageHeading
          kicker="学习，从看懂开始"
          title="让每一步，都看得明白。"
          description="从一行代码开始，理解程序怎样改变数据。"
        />
        <span className="home-archive-label">
          {state.temporary ? '临时使用，尚未保存' : projection ? '本地学习档案' : '正在读取记录'}
        </span>
      </div>
      <LearningSaveStatus />
      <div className="home-composition">
        <section className="study-feature">
          <div className="feature-copy">
            <span className="eyeline">
              {completed === courseTotal && courseKnown ? '继续复习' : '下一小节'}
              {nextChapter && <span>{nextChapter.title}</span>}
            </span>
            <h2>{nextTitle}</h2>
            <p>
              {nextLesson?.teaching.objectives[0] ??
                '先读懂一个小概念，再用积木和真实执行把它看清楚。'}
            </p>
            <div className="inline-actions">
              <Link
                className="button button-primary feature-action"
                data-testid="home-continue-learning"
                to={paths.lesson(nextId)}
              >
                {projection?.lessons.some((lesson) => lesson.started) ? '继续学习' : '开始学习'}
                <Icon name="arrow" />
              </Link>
              <Link className="text-link" to="/courses">
                浏览 C 语言课程
              </Link>
            </div>
            <p className="muted feature-meta">
              阅读课程、搭建积木并提交真实测试；学习确认与通过记录保存在当前浏览器。
            </p>
          </div>
          <div className="concept-object" aria-hidden="true">
            <span className="concept-brace">{'{'}</span>
            <div>
              <i />
              <i />
              <i />
            </div>
            <span className="concept-brace">{'}'}</span>
          </div>
          <div className="feature-code">
            <span>学习课程</span>
            <span>搭建积木</span>
            <span>观察执行</span>
          </div>
        </section>
        <section className="study-progress">
          <div className="module-title">
            <h2 className="card-title">我的学习</h2>
            <span className="badge badge-muted">已保存记录</span>
          </div>
          <div
            className="progress-dial"
            style={{ '--progress': `${courseProgress}%` } as CSSProperties}
            role="img"
            aria-label={
              courseKnown ? `已完成小节：${completed}/${courseTotal}` : '学习进度尚未读取'
            }
          >
            <div>
              <strong data-testid="learning-course-progress">
                {courseKnown ? `${completed}/${courseTotal}` : '—'}
              </strong>
              <span>已完成小节</span>
            </div>
          </div>
          <div className="metric-grid">
            {[
              {
                label: '已入账积分',
                value: state.recovery?.ledgerUncertain
                  ? '暂不可确认'
                  : (projection?.ledger.totalPoints ?? '—'),
                testId: 'learning-posted-points',
              },
              {
                label: '待入账奖励',
                value: state.recovery?.ledgerUncertain
                  ? '暂不可确认'
                  : projection
                    ? String(projection.ledger.pending.length)
                    : '—',
                testId: 'learning-pending-rewards',
              },
            ].map((metric) => (
              <div className="metric" key={metric.label}>
                <span className="metric-value" data-testid={metric.testId}>
                  {metric.value}
                </span>
                <span className="metric-label">{metric.label}</span>
              </div>
            ))}
          </div>
          <p className="muted">
            {state.temporary
              ? '当前仅临时使用，关闭或刷新会丢失未保存内容。'
              : '这里显示当前浏览器可确认的已保存历史记录。'}
            历史通过不代表当前程序或提交的判定。
          </p>
          <Link className="card-link" to="/?panel=points">
            查看积分明细
            <Icon name="arrow" />
          </Link>
        </section>
        <section className="study-path">
          <div className="module-title">
            <div>
              <p className="page-kicker">循序渐进</p>
              <h2>认识 C 语言</h2>
            </div>
            <Link className="text-link" to="/courses">
              查看课程目录
              <Icon name="arrow" />
            </Link>
          </div>
          <div className="chapter-rows">
            {chapters.map((chapter) => {
              const current = state.reading?.chapters.find((item) => item.id === chapter.id);
              const ids =
                current?.lessonRefs.map((ref) => ref.id) ??
                lessons
                  .filter((lesson) => lesson.chapterId === chapter.id)
                  .map((lesson) => lesson.id);
              const done =
                projection?.lessons.filter((lesson) => ids.includes(lesson.id) && lesson.completed)
                  .length ?? 0;
              return (
                <Link
                  key={chapter.id}
                  className={`chapter-row${nextChapterId === chapter.id ? ' is-current' : ''}`}
                  to={paths.chapter(chapter.id)}
                >
                  <span className="chapter-number">{chapter.number}</span>
                  <span className="chapter-text">
                    <strong>{current?.title ?? chapter.title}</strong>
                    <small>{chapter.description}</small>
                  </span>
                  <span className="chapter-status">
                    {courseKnown ? `${done}/${ids.length} 小节` : '记录尚未读取'}
                  </span>
                  <span className="row-arrow" aria-label="查看小节">
                    <Icon name="arrow" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
        <section className="study-today">
          <div className="module-title">
            <h2 className="card-title">今天，向前一小步</h2>
            <Icon name="clock" />
          </div>
          <p className="muted">给自己一个适合的学习目标，积累每一天的进步。</p>
          <div data-testid="learning-today-goal">
            <DailyGoalSummary />
          </div>
          <div className="inline-actions">
            <Link className="text-link" to="/?panel=goals">
              设置每日目标
            </Link>
            <Link className="text-link" to="/?panel=history">
              查看打卡历史
            </Link>
          </div>
        </section>
        <ReviewDueSummary />
        <section className="study-explore">
          <div>
            <div className="module-title">
              <h2 className="card-title">看见算法的过程</h2>
              <Icon name="chart" />
            </div>
            <p className="muted">从变量变化到排序与查找，先认识案例，再逐步理解执行。</p>
            <div className="inline-actions">
              <Link className="card-link" to="/cases">
                浏览算法与演示
                <Icon name="arrow" />
              </Link>
              <Link className="text-link" to={paths.visualize('case.c.bubble-sort')}>
                打开冒泡排序
                <Icon name="arrow" />
              </Link>
            </div>
          </div>
          <div className="home-profile-link">
            <div className="module-title">
              <h2 className="card-title">自己的学习空间</h2>
            </div>
            <p className="muted">显示偏好与本地数据说明，集中在本地设置中。</p>
            <Link className="card-link" to="/settings?panel=display">
              显示设置
              <Icon name="arrow" />
            </Link>
          </div>
        </section>
        <KnowledgeMap />
      </div>
      {panel && (
        <HomePanel key={panel} panel={panel} dismiss={() => setSearch({}, { replace: true })} />
      )}
    </div>
  );
}
