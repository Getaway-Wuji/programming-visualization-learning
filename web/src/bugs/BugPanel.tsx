import { useState } from 'react';
import { Link } from 'react-router';
import { bugQuestions, type BugQuestion } from './content';
import { useLearning } from '../learning/react';
import { currentCourseBundle } from '../content/course-bundle';
import { Breadcrumbs, PageHeading } from '../components/Ui';
import './bugs.css';
import { MemoryBugCatalog } from '../memory-bugs/MemoryBugPage';

export function BugGuidance({ question }: { question: BugQuestion }) {
  const [shown, setShown] = useState(0);
  return (
    <section className="bug-guidance" aria-label="关卡提示与解析">
      <p>
        <strong>{question.category === 'syntax' ? '语法修复' : '逻辑修复'}</strong> · 4组真实测试 ·
        首次通过10分，重复0分
      </p>
      <p>
        从给定错误稿修复。保留输入声明；错误位置与结果来自真实Rust检查或执行。已保存的编辑历史可在刷新后选择恢复，未保存内容可能丢失。
      </p>
      <button className="button" disabled={shown === 3} onClick={() => setShown(shown + 1)}>
        {shown === 3 ? '三层提示已展开' : `查看第 ${shown + 1} 层提示`}
      </button>
      {shown > 0 && (
        <ol>
          {question.hints.slice(0, shown).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      )}
      <details>
        <summary>查看修复解析与一种参考写法</summary>
        <p>{question.explanation}</p>
        <pre tabIndex={0}>
          <code>{question.solutionBody}</code>
        </pre>
        <p>这是main中的解答部分，输入声明仍需保留。符合教学目标的不同正确写法也可通过。</p>
      </details>
      <Link to="/bugs">返回Bug关卡目录</Link>
    </section>
  );
}
export function BugCatalogLink() {
  return (
    <p className="bug-catalog-entry">
      <Link className="button" to="/bugs">
        Bug 修复闯关
      </Link>{' '}
      从语法、逻辑、指针与循环错误稿开始，修复后用真实测试验证。
    </p>
  );
}
export default function BugPage() {
  const { state } = useLearning();
  const available = bugQuestions.every((q) =>
    currentCourseBundle()?.practice.exercises.some(
      (e) => e.id === q.exerciseRef.id && e.version === q.exerciseRef.version,
    ),
  );
  return (
    <div data-page-id="PAGE-14-3">
      <Breadcrumbs items={[{ label: 'C 语言课程', to: '/courses' }, { label: 'Bug 闯关' }]} />
      <PageHeading
        kicker="从错误中练习"
        title="找出问题，修好程序。"
        description="语法、逻辑、指针与死循环各两关。先看真实错误，再用全部测试验证修复。"
      />
      <p>
        原课程必修条件保持不变。八关有独立通过记录；首次通过各10分，共80分，刷新与重复提交不会重复奖励。
      </p>
      {!available && (
        <p role="status">
          正在读取关卡内容；若课程资源不可用，请返回课程目录重试。旧版课程不会授权这些新关卡。
        </p>
      )}
      {(['syntax', 'logic'] as const).map((category) => (
        <section className="bug-category" key={category}>
          <h2>{category === 'syntax' ? '语法 Bug' : '逻辑 Bug'}</h2>
          <div className="bug-list">
            {bugQuestions
              .filter((q) => q.category === category)
              .map((q) => {
                const progress = state.projection?.exercises.find(
                  (e) => e.ref.id === q.exerciseRef.id,
                );
                return (
                  <article key={q.exerciseRef.id}>
                    <h3>{q.title}</h3>
                    <p>{q.prompt}</p>
                    <p>{progress?.passed ? '已保存通过' : '尚未保存通过'} · 4组判定测试</p>
                    {available && (
                      <Link className="button" to={`/practice/${q.exerciseRef.id}`}>
                        修复：{q.title}
                      </Link>
                    )}
                  </article>
                );
              })}
          </div>
        </section>
      ))}
      <MemoryBugCatalog />
      <p>
        语法错误会阻止运行；逻辑错误可能正常结束，但不满足题目目标。通关只依据真实判题，不比较答案文本。
      </p>
    </div>
  );
}
