import { useCallback } from 'react';
import { Link } from 'react-router';
import { useLearning } from '../learning/react';
import { PythonNavigation } from './CoursePage';
import { isPythonPackage, pythonExercise, pythonTopic } from './identities';
import { useReviews, ReviewStatus } from '../review-scheduler/react';
import { ratingLabels, type Rating } from '../review-scheduler/model';
import { usePythonResource } from './use-resource';

const failureLabels = {
  'wrong-answer': '输出与预期不符',
  'teaching-goal-unmet': '需要用题目指定的方法',
  'program-error': '程序运行错误',
};

export default function PythonReviewPage() {
  const { service, state } = useLearning();
  const review = useReviews();
  const cards = review.state.rows.filter(
    (card) => isPythonPackage(card.packageRef) && card.state === 'active',
  );
  const read = useCallback(
    () => service.readPythonCourse(state.sessionEpoch),
    [service, state.sessionEpoch],
  );
  const ready = state.snapshot?.meta.dbVersion === 11 && state.recovery?.writable !== false;
  const { value, failed, retry } = usePythonResource(
    ready ? state.snapshot!.meta.revision : -1,
    read,
  );
  const rows =
    value?.activities
      .filter((row) => row.kind === 'exercise')
      .toSorted((a, b) => b.latestAttempt.at.localeCompare(a.latestAttempt.at)) ?? [];
  return (
    <section className="python-screen">
      <PythonNavigation />
      <h1 tabIndex={-1}>Python 复盘</h1>
      <p className="muted">查看保存在本机的最近判题结果和首次通过记录。</p>
      {!ready && state.status !== 'loading' && <p role="alert">本地学习档案暂不可用。</p>}
      {state.status === 'loading' && <p role="status">正在读取本地档案…</p>}
      {ready && failed && (
        <p role="alert">
          复盘记录暂时无法读取。 <button onClick={retry}>重试</button>
        </p>
      )}
      {ready && !failed && !value && <p role="status">正在读取判题记录…</p>}
      {value &&
        (rows.length ? (
          <ul className="python-review-list">
            {rows.map(({ subjectRef, latestAttempt, firstPass }) => {
              const exercise = pythonExercise(subjectRef.id)!;
              return (
                <li key={subjectRef.id}>
                  <div>
                    <h2>{exercise.title}</h2>
                    <p>
                      {latestAttempt.category
                        ? failureLabels[latestAttempt.category] +
                          ' · 第 ' +
                          latestAttempt.failedCaseKey?.slice(5) +
                          ' 组'
                        : '四组全部通过'}
                    </p>
                    <time dateTime={latestAttempt.at}>
                      {new Date(latestAttempt.at).toLocaleString('zh-CN')}
                    </time>
                    {firstPass && (
                      <p className="muted">
                        首次通过 {new Date(firstPass.at).toLocaleString('zh-CN')}
                      </p>
                    )}
                  </div>
                  <div className="python-actions">
                    <Link to={'/python/article/' + exercise.articleOrder + '/' + exercise.lessonId}>
                      回顾小节
                    </Link>
                    <Link to={'/python/practice/' + subjectRef.id}>再次练习</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p>
            完成一次真实提交后，判题记录会出现在这里。 <Link to="/python">返回 Python 课程</Link>
          </p>
        ))}
      {ready && (
        <section className="python-sheet">
          <h2>Python 复习卡</h2>
          <ReviewStatus />
          {cards.length ? (
            <ul className="python-review-list">
              {cards.map((card) => {
                const subject =
                  pythonExercise(card.subjectRef.id) ?? pythonTopic(card.subjectRef.id);
                if (!subject) return null;
                return (
                  <li key={card.cardId}>
                    <div>
                      <Link to={'/python/article/' + subject.articleOrder + '/' + subject.lessonId}>
                        {subject.title}
                      </Link>
                      <p>下次复习 {card.dueDate}</p>
                    </div>
                    <div className="python-actions">
                      {Object.entries(ratingLabels).map(([rating, label]) => (
                        <button
                          key={rating}
                          type="button"
                          disabled={review.state.status !== 'ready'}
                          onClick={() =>
                            void review.controller.act(card.cardId, 'rate', rating as Rating)
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>当前没有待复习的 Python 主题。</p>
          )}
        </section>
      )}
    </section>
  );
}
