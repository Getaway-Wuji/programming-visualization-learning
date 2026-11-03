import { Link } from 'react-router';
import type { EntityRef } from '../content/types';
import type { LearningServiceState } from '../learning/service';
import { useLearning } from '../learning/react';
import { KnowledgeMarkButton } from '../review-notebook/marks';

// These are current prerequisites, not equivalences or imported old completions.
const preparations: Record<string, readonly string[]> = {
  'lesson.c.logical-length-guards': ['10.1.4', '6.11.1'],
  'lesson.c.adjacent-order': ['6.3.5', '6.11.1'],
  'lesson.c.array-extrema': ['6.11.1', '7.3.4'],
  'lesson.c.nested-loops': ['6.10.1', '6.10.2'],
  'lesson.c.binary-search-first': ['10.1.4', '7.3.4'],
};

export function c6Foundation(state: LearningServiceState, prior: EntityRef) {
  const c6 = state.c6;
  const sections = prior.version === '1.0.0' ? preparations[prior.id] : undefined;
  if (!c6?.index || !c6.manifest || !sections?.length) return null;
  const lessons = sections.map((section) => {
    const lesson = c6.index!.lessons.find((l) => l[0] === `lesson.c6.s${section}`);
    const node = c6.manifest!.nodes.find((n) => `node.${n.id}` === lesson?.[1]);
    if (!lesson || !node) throw new Error('C6_FOUNDATION_REFERENCE');
    const progress = state.projection?.lessons.find((p) => p.id === lesson[0]);
    return {
      id: lesson[0],
      title: node.titleDisplay,
      knowledgeId: lesson[3],
      completed: progress?.completed ?? false,
    };
  });
  return {
    lessons,
    known: !!state.snapshot && !!state.projection,
    completed: !!state.snapshot && !!state.projection && lessons.every((l) => l.completed),
  };
}

export function C6Foundation({ prior }: { prior: EntityRef }) {
  const { state } = useLearning();
  const foundation = c6Foundation(state, prior);
  if (!foundation) return <p>基础准备暂不可确认。</p>;
  return (
    <section data-testid="c6-foundation">
      <p>
        {foundation.known
          ? foundation.completed
            ? '基础准备完成'
            : '基础准备尚未完成'
          : '学习记录待确认'}
        · 按新书小节的阅读确认与绑定练习记录判断。
      </p>
      <ul>
        {foundation.lessons.map((lesson) => (
          <li key={lesson.id}>
            <Link to={`/lessons/${lesson.id}`}>{lesson.title}</Link> ·{' '}
            {foundation.known ? (lesson.completed ? '已完成' : '待学习') : '待确认'}
            <KnowledgeMarkButton lessonId={lesson.id} knowledgeId={lesson.knowledgeId} />
          </li>
        ))}
      </ul>
    </section>
  );
}
