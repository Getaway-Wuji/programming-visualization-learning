import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useCardExpansion } from './card-expansion';
import '../python3/python.css';

interface OutlineEntry {
  id: string;
  parent: string | null;
  title: string;
  path: string;
}

export function CourseReader({
  outline,
  current,
  articleClassName,
  ready = true,
  children,
}: {
  outline: readonly OutlineEntry[];
  current: string;
  articleClassName: string;
  ready?: boolean;
  children: ReactNode;
}) {
  const article = useCardExpansion<HTMLElement>(ready);
  const [directoryOpen] = useState(() => matchMedia('(min-width: 761px)').matches);
  const byParent = new Map<string | null, OutlineEntry[]>();
  for (const entry of outline) {
    const siblings = byParent.get(entry.parent);
    if (siblings) siblings.push(entry);
    else byParent.set(entry.parent, [entry]);
  }

  const rows = (parent: string | null): ReactNode =>
    byParent.get(parent)?.map((entry) => (
      <li key={entry.id}>
        <Link to={entry.path} aria-current={entry.id === current ? 'page' : undefined}>
          {entry.title}
        </Link>
        {byParent.has(entry.id) && <ul>{rows(entry.id)}</ul>}
      </li>
    ));

  return (
    <div className="python-article-grid">
      <details className="python-directory" open={directoryOpen}>
        <summary>本章目录</summary>
        <ul className="python-tree">{rows(null)}</ul>
      </details>
      <article ref={article} className={`python-reading ${articleClassName}`}>
        {children}
      </article>
    </div>
  );
}
