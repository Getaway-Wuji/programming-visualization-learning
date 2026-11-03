import { Link, useParams } from 'react-router';
import { bugQuestions } from '../bugs/content';
import { MissingPage } from '../components/Ui';
import { PracticeExecution } from '../components/PracticeExecution';
import { C6Boundary } from './CoursePages';

export default function IndependentPracticePage({ review = false }: { review?: boolean }) {
  const { exerciseId } = useParams();
  const question = bugQuestions.find((q) => q.exerciseRef.id === exerciseId);
  return (
    <C6Boundary>
      {question ? (
        <div data-mode={review ? 'exercise-review' : undefined}>
          <p>
            <Link to="/bugs">Bug 修复闯关</Link>
          </p>
          <h1>
            {question.title}
            {review ? ' · 本次复盘' : ''}
          </h1>
          <p>
            {review
              ? '查看本题当前有效提交的真实轨迹。复盘不会重新运行或获得奖励；刷新后不恢复临时结果。'
              : question.prompt}
          </p>
          <PracticeExecution id={question.exerciseRef.id} review={review} />
        </div>
      ) : (
        <MissingPage />
      )}
    </C6Boundary>
  );
}
