import { continueLesson } from '../content/reading';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { PageHeading, StatePanel } from '../components/Ui';
import { chapters, lessons, paths } from '../navigation';
import { cases } from '../navigation';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { memoryBugQuestions } from '../memory-bugs/content';
import type { LedgerEntry } from '../storage/model';
import { challengeQuestion } from '../challenges/content';
import { DailyGoalSettings, DailyGoalSummary, GoalHistory } from '../learning/goal-components';
import {
  AvatarPicture,
  ProfileSummary,
  savedCourseProjection,
} from '../learning/profile-components';
import '../learning/rewards.css';
import { bugQuestions } from '../bugs/content';
import { KnowledgeMap } from '../knowledge/KnowledgeMap';
import { AchievementSummary } from '../achievements/react';
import { ReviewDueSummary } from '../review-scheduler/react';

const panels = {
  points: {
    title: '积分明细',
  },
  goals: {
    title: '每日目标',
  },
  history: {
    title: '打卡历史',
  },
} as const;

function contentTitle(id: string) {
  return (
    lessons.find((item) => item.id === id)?.title ??
    lessons.find((item) => item.exerciseId === id)?.exerciseTitle ??
    cases.find((item) => item.id === id)?.title ??
    bugQuestions.find((item) => item.exerciseRef.id === id)?.title ??
    memoryBugQuestions.find((item) => item.exerciseRef.id === id)?.title ??
    challengeQuestion(id)?.title ??
    (id.startsWith('local-goal.') ? `${id.slice('local-goal.'.length)} 每日目标` : '旧版本学习内容')
  );
}

function rewardTitle(entry: LedgerEntry) {
  return {
    'reward.exercise.first-pass': '练习首次通过',
    'reward.lesson.first-completion': '小节首次完成',
    'reward.case.first-view': '案例首次观看',
    'reward.daily-goal.once': '每日目标达成',
    'reward.challenge.first-answer': '挑战首次作答',
  }[entry.sourceId];
}

function HomePanel({ panel, dismiss }: { panel: keyof typeof panels; dismiss: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { state, service } = useLearning();
  const projection = savedCourseProjection(state);
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const value = panels[panel];
  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="home-panel-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div className="modal-header">
        <h2 id="home-panel-title">{value.title}</h2>
        <button className="modal-close" onClick={dismiss} aria-label="关闭面板">
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">
        {panel === 'points' && (
          <section className="reward-rules" aria-label="首次奖励规则">
            <h3>首次学习奖励</h3>
            <p>练习首次通过 10 分 · 小节首次完成 20 分 · 案例首次观看 5 分</p>
            <p>每日目标达成另奖 5 分，每个日期只奖励一次。</p>
            <p className="muted">
              每项内容的首次奖励只发一次。新日期的真实复习可计入每日目标。案例需逐步看完并主动确认。
            </p>
            {state.rewardStatus === 'loading' && <p role="status">正在检查奖励规则……</p>}
            {state.rewardStatus === 'failed' && (
              <p role="alert">奖励暂未入账，已保存的待入账权利会保留。</p>
            )}
            {(state.rewardStatus === 'failed' || !!projection?.ledger.pending.length) && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void service.settleRewards()}
                disabled={state.status === 'saving' || state.status === 'readonly'}
              >
                重试奖励入账
              </button>
            )}
          </section>
        )}
        {state.temporary && (
          <p className="notice">当前仅临时使用。这里的未保存记录会在关闭或刷新页面后丢失。</p>
        )}
        {panel === 'points' &&
          (state.recovery?.ledgerUncertain ? (
            <StatePanel
              kind="error"
              title="积分暂不可确认"
              description="积分账本中有损坏或无法确认的记录。原账本已保留，相关写入已暂停，不会跳过这些记录显示缩水总分。请在本地设置中查看恢复选项。"
            />
          ) : projection?.ledger.history.length ? (
            <>
              <p className="muted">
                已入账{' '}
                {state.snapshot?.ledger
                  .filter((row) => row.status === 'posted')
                  .reduce((sum, row) => sum + BigInt(row.points), 0n)
                  .toString() ?? '0'}{' '}
                分，另有 {projection.ledger.pending.length} 条待入账奖励。
              </p>
              <ul className="learning-history-list reward-ledger">
                {[...projection.ledger.history]
                  .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
                  .map((entry) => (
                    <li key={`${entry.sourceId}:${entry.subjectId}:${entry.localDate}`}>
                      <strong>{contentTitle(entry.subjectId)}</strong>
                      <span>
                        {rewardTitle(entry)} · {entry.localDate}
                      </span>
                      <span className="reward-entry-value">
                        {entry.status === 'posted'
                          ? `${entry.points} 分 · 已入账`
                          : '待入账，暂不计入总分'}
                      </span>
                      {entry.policyRef && (
                        <span className="muted">奖励规则 {entry.policyRef.version}</span>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <StatePanel
              title="暂无积分记录"
              description="通过练习、完成小节或逐步看完案例后确认，即可获得首次奖励。每笔奖励入账后都会显示在这里。"
            />
          ))}
        {panel === 'goals' && <DailyGoalSettings />}
        {panel === 'history' && <GoalHistory />}
      </div>
    </dialog>
  );
}

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
    requested && Object.hasOwn(panels, requested) ? (requested as keyof typeof panels) : null;
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
        <ReviewDueSummary />
        <AchievementSummary />
        <KnowledgeMap />
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
          <ProfileSummary />
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
              {state.snapshot && (
                <AvatarPicture
                  avatar={state.snapshot.avatar}
                  configuration={state.profileConfiguration}
                />
              )}
            </div>
            <p className="muted">基础形象、显示偏好与本地数据说明，集中在本地设置中。</p>
            <Link className="card-link" to="/settings?panel=avatar">
              查看基础形象
              <Icon name="arrow" />
            </Link>
          </div>
        </section>
      </div>
      {panel && (
        <HomePanel key={panel} panel={panel} dismiss={() => setSearch({}, { replace: true })} />
      )}
    </div>
  );
}
