import { Link } from 'react-router';
import { useLearning } from '../learning/react';
import { KnowledgeMarkButton, KnowledgeMarksStatus } from '../review-notebook/marks';
import { useMemo } from 'react';

export function C6KnowledgeOverview() {
  const { state } = useLearning();
  const index = state.c6!.index!,
    manifest = state.c6!.manifest!;
  const completed = useMemo(
    () => new Set(state.projection?.lessons.filter((l) => l.completed).map((l) => l.id)),
    [state.projection],
  );
  const chapters = useMemo(() => {
    const titles = new Map(manifest.nodes.map((node) => [`node.${node.id}`, node.titleDisplay]));
    const byChapter = new Map<string, (typeof index.lessons)[number][]>();
    for (const lesson of index.lessons) {
      const group = byChapter.get(lesson[2]) ?? [];
      group.push(lesson);
      byChapter.set(lesson[2], group);
    }
    return index.knowledge
      .filter((k) => k[2] === 'chapter')
      .map((chapter) => ({
        id: chapter[0],
        title: titles.get(chapter[1])!,
        lessons: (byChapter.get(chapter[1]) ?? []).map((lesson) => ({
          lesson,
          title: titles.get(lesson[1])!,
        })),
      }));
  }, [index, manifest]);
  const chapterLit = chapters.filter((chapter) =>
    chapter.lessons.every(({ lesson }) => completed.has(lesson[0])),
  ).length;
  return (
    <section
      className="card c6-section"
      aria-labelledby="c6-knowledge-title"
      data-testid="c6-knowledge-map"
    >
      <h2 id="c6-knowledge-title">
        我的知识图谱 ·{' '}
        {state.projection ? `${completed.size + chapterLit} / 421 已点亮` : '学习记录待确认'}
      </h2>
      <p className="muted">
        完成小节后点亮对应知识；章内小节全部完成后点亮整章。不熟悉的知识可以单独标记。
      </p>
      <KnowledgeMarksStatus />
      {chapters.map((chapter) => {
        const lessons = chapter.lessons;
        return (
          <details key={chapter.id}>
            <summary>
              {chapter.title} · {lessons.filter(({ lesson }) => completed.has(lesson[0])).length} /{' '}
              {lessons.length}
            </summary>
            <ul className="c6-knowledge-list">
              {lessons.map(({ lesson, title }) => (
                <li key={lesson[0]}>
                  <div>
                    <Link to={`/lessons/${lesson[0]}`}>{title}</Link>
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
