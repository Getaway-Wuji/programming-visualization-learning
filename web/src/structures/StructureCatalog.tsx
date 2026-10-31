import { Link } from 'react-router';
import { structureCases } from './content';
export function StructureCatalog() {
  return (
    <section aria-labelledby="cpp-structures-title" data-testid="cpp-structure-catalog">
      <div className="section-heading">
        <h2 id="cpp-structures-title">C++ · 栈与队列</h2>
        <span className="badge badge-muted">2个操作案例</span>
      </div>
      <p>
        给出入/出操作序列，真实执行后核对有效项、物理残值与空满结果。容量各5，不计学习进度或积分。
      </p>
      <div className="case-grid">
        {structureCases.map((spec) => (
          <article className="card case-card" key={spec.id}>
            <h3>{spec.title}</h3>
            <p>{spec.description}</p>
            <p className="muted">最多30个编码整数槽 · −999～999 · C++受支持子集</p>
            <Link className="card-link" to={`/structures/${spec.id}`}>
              查看{spec.title}工作区 →
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
