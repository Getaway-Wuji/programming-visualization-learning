import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { loadCoursePractice, type CoursePractice } from '../content/practice';
import { memoryBugQuestions } from '../memory-bugs/content';
import { collectMistakes, mistakeLabels } from './model';
import { useKnowledgeMarks, KnowledgeMarksStatus, KnowledgeMarkButton } from './marks';
import './notebook.css';
export default function NotebookPage() {
  const { state } = useLearning(),
    marks = useKnowledgeMarks().state;
  const [practice, setPractice] = useState<CoursePractice | null>(null);
  useEffect(() => {
    let active = true;
    void loadCoursePractice()
      .then((p) => {
        if (active) setPractice(p);
      })
      .catch(() => {
        if (active) setPractice(null);
      });
    return () => {
      active = false;
    };
  }, [state.reading]);
  const catalog = state.practiceCatalog ?? state.reading?.catalog,
    uncertain = state.recovery?.issues.some((issue) =>
      ['receipts', 'aliases', 'progress'].includes(issue.store),
    ),
    rows =
      state.snapshot && catalog && !uncertain ? collectMistakes(state.snapshot, catalog) : null;
  const marked = marks.rows.filter((r) => r.marked);
  return (
    <div className="notebook-page" data-page-id="PAGE-15-2">
      <PageHeading
        kicker="本地复习"
        title="错题与陌生点"
        description="把真实练习中的困难留下来，也可以主动标记还不熟悉的知识。"
      />
      <LearningSaveStatus />
      <Link className="text-link" to="/weaknesses">
        查看薄弱点与学习依据 →
      </Link>
      <Link className="text-link" to="/reviews">
        打开复习队列 →
      </Link>
      <div className="notebook-layout">
        <section className="card section-card" aria-labelledby="mistake-title">
          <h2 id="mistake-title">错题记录 {rows ? `· ${rows.length} 题` : ''}</h2>
          <p className="muted">
            记录答案不符、教学目标未满足和程序错误。取消、资源超限与系统故障不计入错题。通过后保留记录并标为已修复；再次答错会重新打开。
          </p>
          {state.pendingCount > 0 && (
            <p className="notice">有学习操作尚未保存，列表只显示已保存记录。请使用上方重试入口。</p>
          )}
          {!rows ? (
            <p>学习记录暂不能确认，请先恢复本地档案。</p>
          ) : !rows.length ? (
            <p data-testid="mistakes-empty">
              暂无已保存的错题。完成一次真实提交后，有效错误会记录在这里。
            </p>
          ) : (
            <ul className="notebook-list">
              {rows.map((item, index) => {
                const exercise = item.currentId
                    ? practice?.exercises.find((e) => e.id === item.currentId)
                    : null,
                  memory = item.currentId
                    ? memoryBugQuestions.find((q) => q.exerciseRef.id === item.currentId)
                    : null;
                const current = !!item.currentId && (!!exercise || !!memory);
                const knowledge =
                  exercise?.knowledgeRefs ??
                  (memory
                    ? state.reading?.lessons.find((l) => l.id === memory.lessonRef.id)
                        ?.knowledgeRefs
                    : []);
                return (
                  <li
                    key={`${item.id}:${index}`}
                    data-mistake-id={item.id}
                    data-repaired={item.repaired ? 'yes' : 'no'}
                  >
                    <div className="module-title">
                      <h3>{exercise?.title ?? memory?.title ?? `旧版本练习：${item.id}`}</h3>
                      <span>{item.repaired ? '已修复' : '待复习'}</span>
                    </div>
                    <p>
                      {item.failures} 次真实失败 · 最近错误：{mistakeLabels[item.lastCategory]}
                      {item.failedCaseKey ? ` · 测试 ${item.failedCaseKey}` : ''}
                    </p>
                    <p className="muted">
                      出现过：{item.categories.map((c) => mistakeLabels[c]).join('、')} · 最近学习{' '}
                      {item.lastAt.slice(0, 10)}
                    </p>
                    <p>
                      关联知识：
                      {knowledge
                        ?.map(
                          (k) =>
                            state.reading?.knowledgePoints.find(
                              (p) => p.id === k.id && p.version === k.version,
                            )?.title ?? k.id,
                        )
                        .join('、') || '旧内容关联暂不可用'}
                    </p>
                    {current ? (
                      <Link
                        className="text-link"
                        to={
                          memory
                            ? `/bugs/memory/${memory.exerciseRef.id}`
                            : `/practice/${exercise!.id}`
                        }
                      >
                        重新练习：{exercise?.title ?? memory?.title}
                      </Link>
                    ) : (
                      <p>旧摘要已保留，当前版本没有可确认的练习入口。</p>
                    )}
                    {exercise && (
                      <Link className="text-link" to={`/lessons/${exercise.lessonRef.id}`}>
                        复习来源课程
                      </Link>
                    )}
                    {memory && (
                      <Link className="text-link" to={`/lessons/${memory.lessonRef.id}`}>
                        复习关联基础课程
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card section-card" aria-labelledby="unfamiliar-title">
          <h2 id="unfamiliar-title">
            陌生知识点 ·{' '}
            {marks.status === 'ready' || marks.status === 'unsaved' ? marked.length : '待确认'}
          </h2>
          <p className="muted">
            在课程正文的“本节知识点”中标记。自评标记与课程完成、题目通过和图谱点亮分别保存。
          </p>
          <KnowledgeMarksStatus />
          {!marked.length && marks.status === 'ready' ? (
            <p>暂无陌生标记，可从课程里选择还不熟悉的知识。</p>
          ) : (
            <ul className="notebook-list">
              {marked.map((mark) => {
                const knowledge = state.reading?.knowledgePoints.find(
                    (k) => k.id === mark.knowledgeRef.id && k.version === mark.knowledgeRef.version,
                  ),
                  lesson = state.reading?.lessons.find(
                    (l) => l.id === mark.lessonRef.id && l.version === mark.lessonRef.version,
                  );
                return (
                  <li key={mark.knowledgeRef.id} data-unfamiliar-id={mark.knowledgeRef.id}>
                    <h3>{knowledge?.title ?? mark.knowledgeRef.id}</h3>
                    <p>
                      首次标记 {mark.firstAt.slice(0, 10)} · 最近标记 {mark.lastAt.slice(0, 10)}
                    </p>
                    {lesson && knowledge ? (
                      <>
                        <p>来源：{lesson.title}</p>
                        <div className="inline-actions">
                          <Link className="text-link" to={`/lessons/${lesson.id}`}>
                            复习：{lesson.title}
                          </Link>
                          <KnowledgeMarkButton lessonId={lesson.id} knowledgeId={knowledge.id} />
                        </div>
                      </>
                    ) : (
                      <p>旧来源已保留，当前课程无精确匹配入口。</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Link className="card-link" to="/courses">
            去课程标记陌生点 →
          </Link>
        </section>
      </div>
    </div>
  );
}
