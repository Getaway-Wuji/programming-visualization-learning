import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { lessonCompletionDetails } from '../learning/completion';
import { useLearning } from '../learning/react';
import { paths } from '../navigation';
import './practice-progress.css';

export function LessonCompletion({
  lessonId,
  currentExerciseId,
}: {
  lessonId: string;
  currentExerciseId?: string;
}) {
  const { state } = useLearning();
  const location = useLocation();
  const details = lessonCompletionDetails(state, lessonId);
  const hasDetails = !!details;
  useEffect(() => {
    const targetId = location.hash.slice(1);
    if (!hasDetails || !['lesson-study-confirmation', 'practice-answer'].includes(targetId)) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ block: 'start', behavior: 'instant' });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.hash, location.pathname, hasDetails]);
  const loading = state.status === 'loading' || state.readingStatus === 'loading';
  const missingExercise = details?.exercises.find((exercise) => !exercise.passed);
  const nextStep = !details
    ? undefined
    : !details.confirmed
      ? {
          to: `${paths.lesson(lessonId)}#lesson-study-confirmation`,
          text: '阅读并确认本节学习',
        }
      : missingExercise
        ? missingExercise.id === currentExerciseId
          ? {
              to: `${paths.practice(missingExercise.id)}#practice-answer`,
              text: '继续搭建并提交全部测试',
            }
          : { to: paths.practice(missingExercise.id), text: '完成必修练习' }
        : details.completed && details.nextLesson
          ? {
              to: paths.lesson(details.nextLesson.id),
              text: `下一小节：${details.nextLesson.title}`,
            }
          : { to: paths.courses, text: '返回课程目录' };
  return (
    <section
      className="lesson-completion"
      data-testid="lesson-completion"
      data-state={
        details
          ? details.completed
            ? 'completed'
            : 'incomplete'
          : loading
            ? 'loading'
            : 'unavailable'
      }
      aria-label="小节完成清单"
    >
      <div className="lesson-completion-heading">
        <h3>小节完成清单</h3>
        {details && (
          <span className="lesson-completion-count">
            {Number(details.confirmed) + details.exercises.filter((item) => item.passed).length}/
            {1 + details.exercises.length} 项已保存
          </span>
        )}
      </div>
      {!details ? (
        <p role="status">
          {loading
            ? '正在读取本节完成记录……'
            : '本节完成记录暂不可用，请恢复本地档案与课程内容后查看。'}
        </p>
      ) : (
        <>
          <ul className="lesson-completion-list">
            <li
              data-testid="lesson-confirmation-check"
              data-saved={details.confirmed ? 'yes' : 'no'}
            >
              <span>阅读并主动确认学习</span>
              <strong>
                {details.confirmed ? '已保存' : details.started ? '已开始，待确认' : '待确认'}
              </strong>
            </li>
            {details.exercises.map((exercise) => (
              <li
                key={exercise.id}
                data-testid="lesson-exercise-check"
                data-saved={exercise.passed ? 'yes' : 'no'}
              >
                <span>{exercise.title}</span>
                <strong>{exercise.passed ? '通过已保存' : '待通过并保存'}</strong>
              </li>
            ))}
          </ul>
          <p className="lesson-completion-outcome" data-testid="lesson-completion-outcome">
            {details.completed ? '小节已完成并保存' : '小节尚未完成'}
          </p>
          {(state.temporary || state.pendingCount > 0) && (
            <p className="muted" role="status">
              有学习操作尚未保存；清单只显示当前浏览器中已保存的记录。
            </p>
          )}
          {state.practiceStatus === 'failed' && (
            <p className="muted">练习保存授权暂不可用，新的通过记录尚不能保存。</p>
          )}
          {nextStep && (
            <Link
              className="button button-secondary"
              data-testid="lesson-next-step"
              to={nextStep.to}
            >
              {nextStep.text}
            </Link>
          )}
        </>
      )}
    </section>
  );
}
