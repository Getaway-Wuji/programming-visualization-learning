import { Link } from 'react-router';
import { useLearning } from '../learning/react';
import { lessonCompletionDetails } from '../learning/completion';
import { KnowledgeMarkButton, KnowledgeMarksStatus } from '../review-notebook/marks';
import type { AdvancedAlgorithmSpec } from './content';
import { C6Foundation } from '../c6-learning/foundations';
export function AlgorithmReading({
  spec,
}: {
  spec: Pick<
    AdvancedAlgorithmSpec,
    | 'prerequisiteLessonRef'
    | 'knowledgeRefs'
    | 'strategy'
    | 'explanation'
    | 'complexity'
    | 'derivation'
    | 'pitfalls'
    | 'reviewQuestion'
  >;
}) {
  const { state } = useLearning(),
    lesson = state.reading?.lessons.find(
      (l) =>
        l.id === spec.prerequisiteLessonRef.id && l.version === spec.prerequisiteLessonRef.version,
    ),
    progress = lesson ? lessonCompletionDetails(state, lesson.id) : null;
  return (
    <details className="example-reading">
      <summary>算法讲解、复杂度与基础复习</summary>
      <div className="example-reading-grid">
        <section>
          <h2>{spec.strategy}</h2>
          {spec.explanation.map((t) => (
            <p key={t}>{t}</p>
          ))}
          <h3>复杂度与存储</h3>
          <p>
            <strong>{spec.complexity}</strong>
          </p>
          <p>{spec.derivation}</p>
          <h3>边界与误区</h3>
          <ul>
            {spec.pitfalls.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2>基础准备与复习</h2>
          <p>{spec.reviewQuestion}</p>
          {state.c6 ? (
            <C6Foundation prior={spec.prerequisiteLessonRef} />
          ) : lesson ? (
            <>
              <p>
                <Link to={'/lessons/' + lesson.id}>{lesson.title}</Link> ·{' '}
                {progress?.completed ? '基础准备完成' : '查看原小节学习清单'}
              </p>
              <ul>
                {spec.knowledgeRefs.map((ref) => (
                  <li key={ref.id}>
                    {state.reading?.knowledgePoints.find((k) => k.id === ref.id)?.title}
                    <KnowledgeMarkButton lessonId={lesson.id} knowledgeId={ref.id} />
                  </li>
                ))}
              </ul>
              <KnowledgeMarksStatus />
            </>
          ) : (
            <p>基础记录暂不可用，仍可独立阅读和运行本案例。</p>
          )}
          <p>
            {' '}
            <Link to="/notebook">错题与陌生点</Link>
          </p>
          <p>
            讲解、代码与样例为本项目独立编写。这里只提供有界教学算法，不是新可提交练习或通用C++编辑器。
          </p>
        </section>
      </div>
    </details>
  );
}
