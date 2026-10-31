import { Link } from 'react-router';
import { examples } from './content';
export function ExampleCatalog() {
  return (
    <section className="example-catalog" aria-labelledby="example-catalog-title">
      <div className="advanced-chapter-heading">
        <h2 id="example-catalog-title">经典例题 · C++</h2>
        <Link to="/advanced/examples">查看全部三例 →</Link>
      </div>
      <p>从原创讲解和有界输入开始，观察真实执行。每例可对比两种C++方案，演示不计题目通过或积分。</p>
      <ol className="advanced-lesson-list">
        {examples.map((spec) => (
          <li key={spec.id}>
            <div>
              <h3>
                <Link to={`/advanced/examples/${spec.id}`}>{spec.title}</Link>
              </h3>
              <p>
                {spec.topic} · {spec.strategy}
              </p>
              <Link to={`/advanced/examples/${spec.id}/compare`}>同题两解与复杂度 →</Link>
            </div>
            <span>来源：力扣 {spec.source.problemNumber}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
