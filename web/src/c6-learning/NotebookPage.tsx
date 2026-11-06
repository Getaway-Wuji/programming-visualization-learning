import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import {
  KnowledgeMarkButton,
  KnowledgeMarksStatus,
  useKnowledgeMarks,
} from '../review-notebook/marks';
import { mistakeLabels } from '../review-notebook/model';
import { C6Boundary } from './CoursePages';
import { collectC6Mistakes, isC6Mark } from './review';
import { c6DisplayReference } from './display';
import { c6IndependentReference, c6IndependentHref } from './independent';

export default function C6NotebookPage() {
  return (
    <C6Boundary>
      <Notebook />
    </C6Boundary>
  );
}
function Notebook() {
  const { state } = useLearning();
  const marks = useKnowledgeMarks().state;
  const index = state.c6!.index!;
  const uncertain = state.recovery?.issues.some((issue) =>
    ['receipts', 'aliases', 'progress'].includes(issue.store),
  );
  const mistakes = state.snapshot && !uncertain ? collectC6Mistakes(state.snapshot, index) : null;
  const marked = marks.rows.filter((m) => isC6Mark(m, index) && m.marked);
  return (
    <div className="c6-course-page">
      <PageHeading
        kicker="本地复习"
        title="错题与陌生点"
        description="保留真实练习中的困难，主动标记还不熟悉的知识。"
      />
      <div className="c6-action-row">
        <Link className="text-link" to="/weaknesses">
          查看薄弱点依据
        </Link>
        <Link className="text-link" to="/study-notes">
          整理学习笔记
        </Link>
        <Link className="text-link" to="/python/review">
          查看 Python 复盘
        </Link>
      </div>
      <section className="c6-section">
        <h2>错题记录{mistakes ? ` · ${mistakes.length} 题` : ''}</h2>
        <p className="muted">
          答案不符、教学目标未满足和程序错误计入错题；取消和系统故障不计入。通过后标为已修复，再次答错会重新打开。
        </p>
        {!mistakes ? (
          <p>学习记录暂不能确认，请恢复本地档案。</p>
        ) : !mistakes.length ? (
          <p>
            暂无已保存的错题。
            <Link className="text-link" to="/practice">
              去做一道练习 →
            </Link>
          </p>
        ) : (
          <ul className="c6-mistake-list">
            {mistakes.map((m) => {
              const title =
                c6DisplayReference(state, { id: m.id, version: '2.0.0' })?.title ??
                c6IndependentReference(m.id)?.question.title ??
                m.id;
              return (
                <li key={m.id}>
                  <h3>
                    {title} · {m.repaired ? '已修复' : '待复习'}
                  </h3>
                  <p>
                    共 {m.failures} 次有效错误 · 最近：{mistakeLabels[m.lastCategory]}
                    {m.failedCaseKey ? ` · ${m.failedCaseKey}` : ''}
                  </p>
                  <Link className="text-link" to={c6IndependentHref(m.id)}>
                    重新练习并查看判题组
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="c6-section">
        <h2>陌生知识 · {marked.length} 项</h2>
        <KnowledgeMarksStatus />
        {!marked.length && (
          <p>
            在课程正文或知识图谱中标记陌生点，它们会出现在这里。
            <Link className="text-link" to="/courses">
              浏览课程 →
            </Link>
          </p>
        )}
        <ul className="c6-knowledge-list">
          {marked.map((m) => (
            <li key={m.knowledgeRef.id}>
              <Link to={`/lessons/${m.lessonRef.id}`}>
                {c6DisplayReference(state, m.knowledgeRef)?.title ?? m.knowledgeRef.id}
              </Link>
              <KnowledgeMarkButton lessonId={m.lessonRef.id} knowledgeId={m.knowledgeRef.id} />
            </li>
          ))}
        </ul>
      </section>
      <LearningSaveStatus />
    </div>
  );
}
