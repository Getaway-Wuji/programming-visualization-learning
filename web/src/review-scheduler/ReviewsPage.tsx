import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { useLearning } from '../learning/react';
import { memoryBugQuestions } from '../memory-bugs/content';
import { useReviews, ReviewStatus } from './react';
import { reviewGroups, scheduled, ratingLabels, type Rating, type ReviewCard } from './model';
const states = {
  active: '待复习',
  repaired: '题目已修复',
  familiar: '已改熟悉',
  unavailable: '来源暂不可用',
};
export default function ReviewsPage() {
  const { state, controller } = useReviews(),
    learning = useLearning().state;
  const [selected, setSelected] = useState('');
  const [correction, setCorrection] = useState<Rating>('good');
  const confirmed = state.status === 'ready' || state.status === 'unsaved';
  const groups = state.today
    ? reviewGroups(state.rows, state.today)
    : { due: [], future: [], paused: [] };
  const card =
    state.rows.find((c) => c.cardId === selected) ??
    groups.due[0] ??
    groups.future[0] ??
    groups.paused[0];
  const title = (c: ReviewCard) =>
    c.kind === 'knowledge'
      ? learning.reading?.knowledgePoints.find(
          (k) => k.id === c.subjectRef.id && k.version === c.subjectRef.version,
        )?.title
      : (learning.reading?.exercises.find(
          (e) => e.id === c.subjectRef.id && e.version === c.subjectRef.version,
        )?.title ?? memoryBugQuestions.find((q) => q.exerciseRef.id === c.subjectRef.id)?.title);
  const lesson = card
    ? learning.reading?.lessons.find(
        (l) => l.id === card.lessonRef.id && l.version === card.lessonRef.version,
      )
    : undefined;
  const enabled = state.status === 'ready' && learning.clockStatus !== 'rollback';
  return (
    <div className="review-page" data-page-id="PAGE-15-3">
      <PageHeading
        kicker="本地复习"
        title="今日复习"
        description="回顾真实错题和自己标记的陌生点，再用自评安排下一次复习。"
      />
      <ReviewStatus />
      {learning.clockStatus === 'rollback' && (
        <p role="alert">本地时间明显倒退，请校准时间并重新读取；当前不能保存评价。</p>
      )}
      <p className="muted review-date" data-testid="review-observed-date">
        {state.today ? `${state.today} · ${state.zone}` : '日期待确认'} ·
        自评不代表练习通过，不增加积分或课程完成。
      </p>
      {!confirmed ? (
        <p data-testid="review-unknown">复习队列暂不能确认，请先恢复本地档案或重新读取。</p>
      ) : (
        <>
          <p className="review-counts" data-testid="review-counts">
            到期 {groups.due.length} · 未到期 {groups.future.length} · 暂停 {groups.paused.length}
          </p>
          {!state.rows.length && (
            <div className="card section-card" data-testid="review-empty">
              <h2>还没有复习卡片</h2>
              <p>有效错题或课程里的陌生标记会加入计划；查看课程本身不会生成卡片。</p>
              <Link className="text-link" to="/notebook">
                查看错题与陌生点 →
              </Link>
            </div>
          )}
          {state.rows.length > 0 && (
            <div className="review-layout" data-mobile-detail={!!selected}>
              <section className="card section-card" aria-label="复习卡片列表">
                {(
                  [
                    ['due', '到期'],
                    ['future', '未到期'],
                    ['paused', '暂停'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="review-group">
                    <h2>
                      {label} · {groups[key].length}
                    </h2>
                    {!groups[key].length ? (
                      <p className="muted">
                        {key === 'due'
                          ? '今天没有到期卡片。'
                          : key === 'future'
                            ? '没有尚未到期的计划。'
                            : '没有暂停的卡片。'}
                      </p>
                    ) : (
                      <ul>
                        {groups[key].map((c) => (
                          <li key={c.cardId}>
                            <button
                              type="button"
                              className="review-select"
                              aria-pressed={card?.cardId === c.cardId}
                              data-review-card={c.cardId}
                              onClick={() => setSelected(c.cardId)}
                            >
                              <span>{title(c) ?? c.subjectRef.id}</span>
                              <small>
                                {c.kind === 'exercise' ? '错题' : '陌生知识'} ·{' '}
                                {c.state === 'active' ? c.dueDate : states[c.state]}
                              </small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </section>
              {card && (
                <section
                  className="card section-card review-detail"
                  aria-labelledby="review-card-title"
                  data-testid="review-detail"
                  data-card-id={card.cardId}
                  data-source-id={card.subjectRef.id}
                  data-due-date={card.dueDate}
                  data-level={card.level}
                >
                  <button
                    type="button"
                    className="text-link review-back"
                    onClick={() => setSelected('')}
                  >
                    返回卡片列表
                  </button>
                  <p className="page-kicker">
                    {card.kind === 'exercise' ? '真实错题复习' : '陌生知识自评'}
                  </p>
                  <h2 id="review-card-title">{title(card) ?? card.subjectRef.id}</h2>
                  <p>
                    {states[card.state]} · 下次复习 {card.dueDate} · 已评价 {card.reviewCount} 次
                  </p>
                  <p>先回顾来源，想一想概念或解题方法，再选择最接近当前情况的评价。</p>
                  {card.state !== 'unavailable' && lesson ? (
                    <div className="inline-actions">
                      <Link className="text-link" to={`/lessons/${lesson.id}`}>
                        复习：{lesson.title}
                      </Link>
                      {card.kind === 'exercise' && (
                        <Link
                          className="text-link"
                          to={
                            memoryBugQuestions.some((q) => q.exerciseRef.id === card.subjectRef.id)
                              ? `/bugs/memory/${card.subjectRef.id}`
                              : `/practice/${card.subjectRef.id}`
                          }
                        >
                          重新练习
                        </Link>
                      )}
                    </div>
                  ) : (
                    <p>旧记录保留，当前来源无法确认，暂不安排评价。</p>
                  )}
                  {card.state === 'active' && card.dueDate <= state.today && (
                    <div className="review-ratings" aria-label="本次复习评价">
                      {(Object.keys(ratingLabels) as Rating[]).map((r) => (
                        <button
                          key={r}
                          type="button"
                          className="button button-secondary"
                          disabled={!enabled}
                          data-review-rating={r}
                          onClick={() => void controller.act(card.cardId, 'rate', r)}
                        >
                          <span>{ratingLabels[r]}</span>
                          <small>下次 {scheduled(card.level, r, state.today).dueDate}</small>
                        </button>
                      ))}
                    </div>
                  )}
                  {card.state === 'active' && card.dueDate > state.today && (
                    <p data-testid="review-not-due">
                      尚未到期，计划保持。可以回顾来源或明确重新学习。
                    </p>
                  )}
                  {card.lastReview && (
                    <div className="review-correction">
                      <h3>最后一次自评</h3>
                      <p>
                        {card.lastReview.localDate} · {ratingLabels[card.lastReview.rating]}
                        。修订从原评价前状态重算，不额外增加次数。
                      </p>
                      <label>
                        修订评价
                        <select
                          aria-label="修订评价"
                          value={correction}
                          onChange={(e) => setCorrection(e.target.value as Rating)}
                        >
                          {(Object.keys(ratingLabels) as Rating[]).map((r) => (
                            <option key={r} value={r}>
                              {ratingLabels[r]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={!enabled}
                        onClick={() => void controller.act(card.cardId, 'correct', correction)}
                      >
                        保存评价修订
                      </button>
                    </div>
                  )}
                  {(card.state === 'active' || card.state === 'repaired') && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={!enabled}
                      onClick={() => void controller.act(card.cardId, 'restart', null)}
                    >
                      重新学习此卡（今天到期）
                    </button>
                  )}
                  {card.state === 'familiar' && (
                    <p>已在来源改为熟悉。重新标记陌生后会再次加入复习。</p>
                  )}
                </section>
              )}
            </div>
          )}
        </>
      )}
      <details className="review-rule">
        <summary>复习日期怎样安排</summary>
        <p>
          采用固定日历分级：记得前进一级，熟练前进两级；间隔依次为1、3、7、14、30、60天。吃力保持等级并将间隔折半向上取整，重学回到起点并安排次日。日期按本地档案固定时区计算。
        </p>
        <p>
          新错误或再次标陌生会从来源日期重开；题目修复或改熟悉暂停。评价是自评，没有后台通知或额外奖励。
        </p>
      </details>
    </div>
  );
}
