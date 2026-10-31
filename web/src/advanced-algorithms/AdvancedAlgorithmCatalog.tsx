import { Link } from 'react-router';
import { advancedAlgorithms } from './content';
import '../advanced-course/advanced-course.css';
import '../examples/examples.css';
export function AdvancedAlgorithmCatalog() {
  return (
    <section
      className="example-catalog"
      aria-labelledby="sieve-sequence-title"
      data-testid="advanced-algorithm-catalog"
    >
      <div className="advanced-chapter-heading">
        <h2 id="sieve-sequence-title">筛法与序列 · C++</h2>
        <Link to="/advanced/algorithms">查看四个算法 →</Link>
      </div>
      <p>
        从真实标记和递推状态理解算法。四个阅读案例不计学习完成或积分，基础准备与复习仍用统一档案。
      </p>
      <ol className="advanced-lesson-list">
        {advancedAlgorithms.map((s) => (
          <li key={s.id}>
            <div>
              <h3>
                <Link to={'/advanced/algorithms/' + s.id}>{s.title}</Link>
              </h3>
              <p>{s.topic}</p>
            </div>
            <span>{s.inputKind === 'bound' ? '上界0～30' : '序列0～30项'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
