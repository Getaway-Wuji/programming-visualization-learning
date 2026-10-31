import { Link } from 'react-router';
import { classicCases } from './content';
export function ClassicCatalog() {
  return (
    <section data-testid="cpp-classic-catalog">
      <h2>C++经典问题</h2>
      <p>真实数值、盘位置与调用栈回放；四例独立观察不计课程或积分。</p>
      <div className="case-grid">
        {classicCases.map((s) => (
          <article className="card" key={s.id}>
            <h3>{s.title}</h3>
            <p>{s.description}</p>
            <p className="muted">{s.inputHelp}</p>
            <Link className="text-link" to={`/classics/${s.id}`}>
              查看{s.title}工作区 →
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
