import { Link } from 'react-router';
import { paths } from '../navigation';
import { subjectLearningText, useLearning } from '../learning/react';
import { reconstructionQuestions, type ReconstructionQuestion } from './reconstruction';
import './reconstruction.css';

export function ReconstructionReference({
  question,
  source,
}: {
  question: ReconstructionQuestion;
  source: string;
}) {
  return (
    <section
      className="reconstruction-reference"
      aria-label="拆积木参考程序"
      data-testid="reconstruction-reference"
    >
      <div>
        <h3>{question.title}</h3>
        <p>
          读懂右侧 C 程序，再用积木搭出相同的行为。输入声明已备好，参考代码不会自动填入你的解答。
        </p>
        <p>{question.hint}</p>
        <p className="muted">
          可以使用不同的搭法；判题同时检查本题教学结构、输入的实际参与和全部测试结果。
        </p>
        <p className="muted">
          与本题其他作答方式共用通过记录和首次积分；已通过的题目再次提交不重复奖励。
        </p>
      </div>
      <div>
        <h4>参考 C · 第一组输入</h4>
        <pre className="sample-source" tabIndex={0} aria-label="只读参考 C 代码">
          {source}
        </pre>
      </div>
    </section>
  );
}

export function ReconstructionCatalog() {
  const { state } = useLearning();
  const reading = state.reading;
  if (
    !reading ||
    reading.packageRef.id !== 'content.c.p05' ||
    reading.packageRef.version !== '1.0.0'
  )
    return null;
  const questions = reconstructionQuestions.filter((question) =>
    reading.exercises.some(
      (exercise) =>
        exercise.id === question.exerciseRef.id &&
        exercise.version === question.exerciseRef.version,
    ),
  );
  return (
    <details
      className="card section-card reconstruction-catalog"
      data-testid="reconstruction-catalog"
    >
      <summary>拆积木练习 · {questions.length} 题</summary>
      <p>从给定 C 代码出发，用积木还原程序。沿用对应小节的积木权限、通过记录和首次积分。</p>
      <ul>
        {questions.map((question) => (
          <li key={question.exerciseRef.id}>
            <Link to={`${paths.practice(question.exerciseRef.id)}?mode=reconstruction`}>
              {question.title}
            </Link>
            <span className="muted">
              {subjectLearningText(state, 'exercise', question.exerciseRef.id)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
