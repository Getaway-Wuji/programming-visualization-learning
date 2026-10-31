import { Link } from 'react-router';
export function KmpCatalog() {
  return (
    <section
      className="example-catalog"
      aria-labelledby="kmp-catalog-title"
      data-testid="kmp-catalog"
    >
      <div className="advanced-chapter-heading">
        <h2 id="kmp-catalog-title">字符串匹配 · C++</h2>
        <Link to="/advanced/algorithms/case.cpp.kmp">打开KMP →</Link>
      </div>
      <p>
        沿真实前缀表和失配回退理解首个匹配；两个输入字段分别保留空串和空格，不计学习完成或积分。
      </p>
      <ol className="advanced-lesson-list">
        <li>
          <div>
            <h3>
              <Link to="/advanced/algorithms/case.cpp.kmp">KMP字符串匹配</Link>
            </h3>
            <p>前缀构造、字符比较与模式指针回退</p>
          </div>
          <span>两行ASCII，各0～30字节</span>
        </li>
      </ol>
    </section>
  );
}
