import { useState } from 'react';
import { Link } from 'react-router';
import { visualCategories, visualModules } from './catalog';
import './lab.css';

export function VisualLabCatalog() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const visible = visualModules.filter(
    (s) =>
      (category === '全部' || s.category === category) &&
      `${s.title} ${s.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="lab-catalog" aria-label="算法可视化目录">
      <div className="lab-catalog-heading">
        <h2>
          算法可视化 <span className="muted">{visualModules.length} 个模块</span>
        </h2>
        <label>
          查找算法
          <input
            type="search"
            placeholder="例如：红黑树、背包、排序"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="lab-categories" aria-label="算法分类">
        {['全部', ...visualCategories].map((name) => (
          <button
            key={name}
            className="button button-small"
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="lab-category-grid">
        {visualCategories
          .filter((name) => visible.some((s) => s.category === name))
          .map((name) => (
            <section className="card lab-category" key={name}>
              <h3>{name}</h3>
              <ul>
                {visible
                  .filter((s) => s.category === name)
                  .map((spec) => (
                    <li key={spec.slug}>
                      <Link to={`/algorithms/lab/${spec.slug}`}>
                        <strong>{spec.title}</strong>
                        <span className="muted">{spec.description}</span>
                        <span aria-hidden="true">→</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
      </div>
      {!visible.length && <p>没有找到匹配的算法。</p>}
    </section>
  );
}
