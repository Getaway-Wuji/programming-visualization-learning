import { CodeEditor } from '../components/CodeEditor';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import { Breadcrumbs, MissingPage, PageHeading } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { currentCourseBundle } from '../content/course-bundle';
import {
  hasMemoryBugLearningSupplement,
  memoryBugQuestion,
  memoryBugQuestions,
  type MemoryBugQuestion,
} from './content';
import { MemoryBugSession } from './session';
import '../memory/memory.css';
import './memory-bugs.css';
import '../c6-learning/workbench.css';
import { c6IndependentSupplement } from '../c6-learning/supplements';
import { PracticeExamples } from '../components/PracticeExamples';

export function MemoryBugCatalog() {
  const { state } = useLearning();
  const available = !!c6IndependentSupplement() || !!currentCourseBundle()?.memoryBugSupplement;
  return (
    <>
      {(['pointer', 'loop'] as const).map((category) => (
        <section className="bug-category" key={category}>
          <h2>{category === 'pointer' ? '野指针与生命期' : '死循环与终止'}</h2>
          <p>受限C++代码关卡 · 真实内存解释执行 · 不提供积木映射。</p>
          <div className="bug-list">
            {memoryBugQuestions
              .filter((q) => q.category === category)
              .map((q) => (
                <article key={q.exerciseRef.id}>
                  <h3>{q.title}</h3>
                  <p>{q.prompt}</p>
                  <p>
                    {state.projection?.exercises.some(
                      (e) => e.ref.id === q.exerciseRef.id && e.passed,
                    )
                      ? '已通过'
                      : '尚未保存通过'}{' '}
                    · 4组真实测试 · 首次10分
                  </p>
                  {available ? (
                    <Link className="button" to={`/bugs/memory/${q.exerciseRef.id}`}>
                      修复：{q.title}
                    </Link>
                  ) : (
                    <p>内存关卡资源尚未就绪。</p>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}
function MemoryBugWorkspace({ question }: { question: MemoryBugQuestion }) {
  const { state: learning, service } = useLearning();
  const owner = useMemo(
    () =>
      new MemoryBugSession(
        question,
        {
          context: () => {
            const state = service.getState(),
              catalog = state.practiceCatalog;
            return {
              catalog:
                catalog && hasMemoryBugLearningSupplement(catalog.exercises) ? catalog : null,
              epoch: state.sessionEpoch,
            };
          },
          save: (fact, epoch) => service.recordPracticePass(fact, epoch),
          saveAttempt: (fact, epoch) => service.recordPracticeAttempt(fact, epoch),
        },
        {
          context: () => service.editorHistoryContext(),
          read: (ctx) => service.readEditorHistory(ctx),
          save: (ctx, record, update) => service.saveEditorHistory(ctx, record, update),
        },
      ),
    [question, service],
  );
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const history = useSyncExternalStore(owner.history.subscribe, owner.history.getSnapshot);
  const [selected, setSelected] = useState('');
  const chosen = history.items.find((row) => row.entryId === selected) ?? history.items[0];
  const [hints, setHints] = useState(0);
  const generation = learning.snapshot?.meta.generation;
  useEffect(() => {
    if (generation) void owner.startHistory();
    return () => owner.invalidate();
  }, [owner, generation, learning.sessionEpoch]);
  const busy = state.phase === 'running';
  const available = !!c6IndependentSupplement() || !!currentCourseBundle()?.memoryBugSupplement;
  const passed =
    learning.pendingCount === 0 &&
    learning.status === 'ready' &&
    learning.projection?.exercises.some(
      (row) => row.ref.id === question.exerciseRef.id && row.passed,
    );
  return (
    <div
      data-testid="memory-bug-session"
      data-state={state.phase}
      data-save-state={passed ? 'saved' : state.save}
    >
      <Breadcrumbs
        items={[
          { label: '练习', to: '/practice' },
          { label: 'Bug 闯关', to: '/bugs' },
          { label: question.title },
        ]}
      />
      <PageHeading kicker="Bug 修复闯关" title={question.title} />
      <h2>题目描述</h2>
      <p>{question.prompt}</p>
      <PracticeExamples
        key={question.exerciseRef.id}
        inputFormat={question.category === 'pointer' ? '输入一个整数 x。' : '输入一个非负整数 n。'}
        outputFormat="输出一个整数，并在行末换行。"
        samples={question.tests.map((test) => ({
          input: test.input.join(' '),
          output: test.expectedStdout,
        }))}
      />
      <section className="card oj-answer">
        <h2>提交代码</h2>
        <p>C++ 代码</p>
        <CodeEditor
          label="编辑关卡 C++ 代码"
          dialect="cpp"
          value={state.source}
          onChange={(text) => owner.edit(text)}
        />
        <div className="inline-actions">
          <button
            className="button button-primary"
            disabled={busy || !available}
            onClick={() => void owner.run(true)}
          >
            {busy ? '提交中…' : '提交'}
          </button>
          {busy && (
            <button className="button" onClick={() => owner.cancel()}>
              取消
            </button>
          )}
        </div>
        {['passed', 'unmet', 'failed'].includes(state.phase) && (
          <p
            role="status"
            className="oj-verdict"
            data-testid="oj-verdict"
            data-verdict={
              state.phase === 'passed'
                ? 'passed'
                : state.phase === 'unmet'
                  ? 'failed'
                  : 'incomplete'
            }
          >
            {state.phase === 'passed'
              ? '通过'
              : state.phase === 'unmet'
                ? '未通过'
                : '提交未完成，请重试'}
          </p>
        )}
        {!available && <p role="alert">题目暂时无法读取，请刷新后重试。</p>}
        <details
          className="editor-history"
          data-testid="memory-bug-history"
          data-save-state={history.status}
        >
          <summary>编辑历史</summary>
          <label>
            历史版本{' '}
            <select
              aria-label="内存关卡历史版本"
              value={chosen?.entryId ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {!chosen && <option value="">暂无已保存历史</option>}
              {history.items.map((row) => (
                <option key={row.entryId} value={row.entryId}>
                  {row.createdAt} · 版本 {row.documentRevision}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button"
            disabled={busy || !chosen}
            onClick={() => chosen && owner.restore(chosen.entryId)}
          >
            恢复所选版本
          </button>
          {history.status === 'unsaved' && (
            <button className="button" onClick={() => void owner.history.retry()}>
              重试保存编辑历史
            </button>
          )}
          {history.message && <p role="status">{history.message}</p>}
        </details>
        <LearningSaveStatus />
      </section>
      <details className="memory-bug-help">
        <summary>提示与解析</summary>
        <button className="button" disabled={hints === 3} onClick={() => setHints(hints + 1)}>
          {hints === 3 ? '提示已展开' : '查看提示'}
        </button>
        {hints > 0 && (
          <ol>
            {question.hints.slice(0, hints).map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ol>
        )}
        <details>
          <summary>参考写法</summary>
          <pre>
            <code>{question.solutionSource}</code>
          </pre>
        </details>
      </details>
      <Link className="text-link" to="/bugs">
        返回Bug关卡目录
      </Link>
    </div>
  );
}
export default function MemoryBugPage() {
  const { exerciseId } = useParams();
  const question = exerciseId && memoryBugQuestion(exerciseId);
  return question ? (
    <MemoryBugWorkspace key={question.exerciseRef.id} question={question} />
  ) : (
    <MissingPage title="找不到这个内存关卡" backTo="/bugs" backLabel="返回关卡目录" />
  );
}
