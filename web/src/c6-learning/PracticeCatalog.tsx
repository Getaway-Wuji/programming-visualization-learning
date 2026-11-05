import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { useLearning } from '../learning/react';
import { C6Boundary } from './CoursePages';

export function C6PracticeCatalog() {
  const { state } = useLearning();
  const [query, setQuery] = useState('');
  const index = state.c6?.index;
  const nodes = state.c6?.manifest?.nodes ?? [];
  return (
    <C6Boundary>
      <PageHeading
        kicker="动手写代码"
        title="练习"
        description="选择章节练习，写代码并提交检查；也可以挑战 Bug 修复。"
      />
      <p className="inline-actions">
        <Link className="button button-primary" to="/bugs">
          Bug 修复闯关
        </Link>
      </p>
      <label className="c6-search">
        查找练习
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例如：循环、数组、指针"
        />
      </label>
      <div className="c6-practice-catalog">
        {index?.exercises
          .filter((e) =>
            nodes.find((n) => `node.${n.id}` === e[1])?.titleDisplay.includes(query.trim()),
          )
          .map((exercise, i) => {
            const node = nodes.find((n) => `node.${n.id}` === exercise[1]);
            const passed = state.projection?.exercises.find((e) => e.id === exercise[0])?.passed;
            return (
              <Link
                className="card c6-practice-entry"
                key={exercise[0]}
                to={`/practice/${exercise[0]}`}
              >
                <span className="muted">练习 {i + 1}</span>
                <h2>{node?.titleDisplay}</h2>
                <span>{passed ? '已通过 · 再练一次' : '开始练习'} →</span>
              </Link>
            );
          })}
      </div>
      {index &&
        !index.exercises.some((e) =>
          nodes.find((n) => `node.${n.id}` === e[1])?.titleDisplay.includes(query.trim()),
        ) && <p>没有找到匹配的练习。</p>}
    </C6Boundary>
  );
}
