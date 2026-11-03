import { Link } from 'react-router';
import { useLearning } from '../learning/react';
import { KnowledgeMarkButton } from '../review-notebook/marks';

export function C6KnowledgeOverview() {
  const { state } = useLearning();
  const index = state.c6!.index!,
    manifest = state.c6!.manifest!;
  const completed = new Set(state.projection?.lessons.filter((l) => l.completed).map((l) => l.id));
  const chapters = index.knowledge.filter((k) => k[2] === 'chapter');
  const chapterLit = chapters.filter((k) =>
    index.lessons.filter((l) => l[2] === k[1]).every((l) => completed.has(l[0])),
  ).length;
  return (
    <section
      className="c6-section"
      aria-labelledby="c6-knowledge-title"
      data-testid="c6-knowledge-map"
    >
      <h2 id="c6-knowledge-title">
        我的知识图谱 ·{' '}
        {state.projection ? `${completed.size + chapterLit} / 421 已点亮` : '学习记录待确认'}
      </h2>
      <p className="muted">
        完成小节后点亮对应知识；章内小节全部完成后点亮整章。陌生标记用于复习安排。
      </p>
      {chapters.map((chapter) => {
        const node = manifest.nodes.find((n) => `node.${n.id}` === chapter[1])!;
        const lessons = index.lessons.filter((l) => l[2] === chapter[1]);
        return (
          <details key={chapter[0]}>
            <summary>
              {node.titleDisplay} · {lessons.filter((l) => completed.has(l[0])).length} /{' '}
              {lessons.length}
            </summary>
            <ul className="c6-knowledge-list">
              {lessons.map((lesson) => (
                <li key={lesson[0]}>
                  <div>
                    <Link to={`/lessons/${lesson[0]}`}>
                      {manifest.nodes.find((n) => `node.${n.id}` === lesson[1])!.titleDisplay}
                    </Link>
                    <small>
                      {state.projection
                        ? completed.has(lesson[0])
                          ? '已点亮'
                          : '未学完'
                        : '记录待确认'}
                    </small>
                  </div>
                  <KnowledgeMarkButton lessonId={lesson[0]} knowledgeId={lesson[3]} />
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}
