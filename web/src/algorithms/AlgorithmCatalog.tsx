import { Link } from 'react-router';
import { bucketSortCases, recursiveSortCases, sortCases } from './content';
export function AlgorithmCatalog() {
  return (
    <>
      <section aria-labelledby="cpp-sorts-title" data-testid="cpp-sort-catalog">
        <div className="section-heading">
          <h2 id="cpp-sorts-title">C++ · 迭代排序</h2>
          <span className="badge badge-muted">3个独立案例</span>
        </div>
        <p>通过实际C++程序观察插入、间隔分组和计数回填。此组观察不记课程进度或积分。</p>
        <div className="case-grid">
          {sortCases.map((spec) => (
            <article className="card case-card" key={spec.id}>
              <h3>{spec.title}</h3>
              <p>{spec.description}</p>
              <p className="muted">
                0～{spec.maxItems}项 · {spec.min}～{spec.max} · C++受支持子集
              </p>
              <Link className="card-link" to={`/algorithms/${spec.id}`}>
                查看{spec.title}工作区 →
              </Link>
            </article>
          ))}
        </div>
      </section>
      <section aria-labelledby="cpp-recursive-title" data-testid="cpp-recursive-catalog">
        <div className="section-heading">
          <h2 id="cpp-recursive-title">C++ · 递归排序</h2>
          <span className="badge badge-muted">2个独立案例与同数据对比</span>
        </div>
        <p>
          观察真实调用帧、共享数组别名与当前存储。归并借助辅助数组，快速递归较小区间；不计课程进度或积分。
        </p>
        <div className="case-grid">
          {recursiveSortCases.map((spec) => (
            <article className="card case-card" key={spec.id}>
              <h3>{spec.title}</h3>
              <p>{spec.description}</p>
              <p className="muted">0～30项 · −999～999 · C++受支持子集</p>
              <Link className="card-link" to={`/algorithms/${spec.id}`}>
                查看{spec.title}工作区 →
              </Link>
            </article>
          ))}
        </div>
        <p>
          <Link className="text-link" to="/compare?pair=cpp-recursive">
            归并与快速 · 同数据对比 →
          </Link>
        </p>
      </section>
      <section aria-labelledby="cpp-bucket-title" data-testid="cpp-bucket-catalog">
        <div className="section-heading">
          <h2 id="cpp-bucket-title">C++ · 桶排序</h2>
          <span className="badge badge-muted">1个独立案例</span>
        </div>
        <p>五个固定桶、真实槽位与桶内插入。物理容量与逻辑数量分开显示，不计课程进度或积分。</p>
        {bucketSortCases.map((spec) => (
          <article className="card case-card" key={spec.id}>
            <h3>{spec.title}</h3>
            <p>{spec.description}</p>
            <p className="muted">0～30项 · −20～29 · 五桶各30槽 · C++受支持子集</p>
            <Link className="card-link" to={`/algorithms/${spec.id}`}>
              查看{spec.title}工作区 →
            </Link>
          </article>
        ))}
      </section>
    </>
  );
}
