import { Link } from 'react-router';
import { nodeCases } from './content';
export function NodeCaseCatalog() {
  return (
    <section data-testid="cpp-node-catalog">
      <h2>C++链表与树</h2>
      <p>真实动态节点与指针操作，和内存/调用栈共用同一执行步骤；观察不计课程或积分。</p>
      <div className="case-grid">
        {nodeCases.map((s) => (
          <article className="card" key={s.id}>
            <h3>{s.title}</h3>
            <p>{s.description}</p>
            <p className="muted">容量7 · 原输入最多30整数槽 · C++子集</p>
            <Link className="text-link" to={`/nodes/${s.id}`}>
              查看{s.title}工作区 →
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
