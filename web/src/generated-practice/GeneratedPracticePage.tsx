import { CodeEditor } from '../components/CodeEditor';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { useLearning } from '../learning/react';
import { WeaknessController } from '../weaknesses/WeaknessPage';
import { weaknessReasons } from '../weaknesses/model';
import '../custom-code/custom-code.css';
import { GeneratedPracticeController } from './controller';
import { practiceKnowledgeIds } from './protocol';
import './practice.css';
import { c6GeneratedFoundation } from '../c6-learning/independent';
import { PracticeExamples } from '../components/PracticeExamples';

const labels: Record<string, string> = {
  'knowledge.c.expressions': '表达式',
  'knowledge.c.variables': '变量',
  'knowledge.c.output': '输出',
  'knowledge.c.input': '输入',
  'knowledge.c.conditions': '条件判断',
  'knowledge.c.loops': '循环',
};
const errors: Record<string, string> = {
  E_GEN_SEED: '种子需为0至4294967295的十进制整数，不含空格或符号。',
  E_GEN_INPUT: '试运行输入需为题目范围内的一个十进制整数。',
  E_SOURCE_LIMIT: '代码超过32 KiB，请缩短后重试。',
  E_DEADLINE: '本次操作超过1秒，已终止。可以缩短代码后重试。',
  E_FUEL_LIMIT: '本次操作已达到执行预算，未判为通过。',
  E_CANCELLED: '本次操作已取消，未接受迟到结果。',
  E_MODULE_LOAD: '执行资源未能加载，请检查连接后重试。',
  E_GENERATED_REFERENCE: '参考解未通过真实验证，未交付题目，请重试。',
};
export default function GeneratedPracticePage() {
  const { service, state: learning } = useLearning();
  const [controller] = useState(() => new GeneratedPracticeController());
  const [weakness] = useState(() => new WeaknessController(service));
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const summary = useSyncExternalStore(weakness.subscribe, weakness.getSnapshot);

  useEffect(() => {
    void weakness.reload();
  }, [
    weakness,
    learning.snapshot?.meta.generation,
    learning.snapshot?.meta.revision,
    learning.sessionEpoch,
    learning.practiceCatalog,
    learning.capabilities.learning,
  ]);
  useEffect(() => {
    const stop = service.subscribeSessionInvalidation(() => {
      weakness.invalidate();
      controller.clear();
    });
    const refresh = () => {
      void weakness.reload();
    };
    const hidden = () => {
      if (document.visibilityState !== 'visible') controller.pause();
    };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      stop();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', hidden);
      weakness.invalidate();
      controller.clear();
    };
  }, [service, controller, weakness]);
  const supported = new Set<string>(practiceKnowledgeIds);
  const active =
    summary.status === 'ready'
      ? (summary.summary?.rows ?? []).filter((r) => weaknessReasons(r).length)
      : [];
  const recommended = active.find((r) =>
    supported.has(
      learning.c6 ? (c6GeneratedFoundation(r.knowledgeRef.id) ?? '') : r.knowledgeRef.id,
    ),
  );
  const recommendedId = recommended
    ? learning.c6
      ? c6GeneratedFoundation(recommended.knowledgeRef.id)!
      : recommended.knowledgeRef.id
    : null;
  const currentLessons = learning.c6?.index?.lessons;
  const currentLesson =
    currentLessons?.find(
      (l) =>
        l[3] === recommended?.knowledgeRef.id &&
        c6GeneratedFoundation(l[3]) === snap.selection.knowledgeId,
    ) ?? currentLessons?.find((l) => c6GeneratedFoundation(l[3]) === snap.selection.knowledgeId);
  const currentNode = learning.c6?.manifest?.nodes.find(
    (node) => `node.${node.id}` === currentLesson?.[1],
  );
  const lesson = learning.c6
    ? currentLesson && currentNode
      ? { id: currentLesson[0], title: currentNode.titleDisplay }
      : null
    : learning.reading?.lessons.find((l) =>
        l.knowledgeRefs.some((k) => k.id === snap.selection.knowledgeId),
      );
  const { problem, assessment } = snap;
  const running = snap.status === 'running';
  const validSource = new TextEncoder().encode(snap.source).length <= 32768;
  return (
    <div
      className="generated-practice-page"
      data-testid="generated-practice"
      data-status={snap.status}
    >
      <PageHeading
        kicker="规则生成 · C 基础"
        title="换一道，再练一次"
        description="选择知识与难度，用固定种子得到一道可复现的题。参考解和你的提交都由浏览器内的 Rust 解释器真实执行。"
      />
      <p className="practice-scope">
        临时加练 · 不计分，不改变课程进度或薄弱点记录 ·
        草稿与结果刷新后丢弃。保留种子可重新生成同一道题。
      </p>
      <section
        className="practice-recommendation"
        aria-label="本地复习建议"
        data-testid="generated-recommendation"
        data-state={summary.status}
      >
        {summary.status !== 'ready' ? (
          <p>本地学习依据暂未确认；可自行选择基础题继续加练。</p>
        ) : recommended ? (
          <>
            <p>
              <strong>可从{labels[recommendedId!]}开始</strong> ·{' '}
              {weaknessReasons(recommended).join('；')}。
            </p>
            <button
              className="text-link"
              onClick={() => controller.select({ knowledgeId: recommendedId! })}
            >
              采用此知识建议
            </button>
          </>
        ) : (
          <p>
            {active.length
              ? '当前建议涉及尚未提供的题型。可回原课程复习，或自行选择基础题。'
              : '暂无待复习的本地依据，可从表达式基础题开始；这不代表已掌握其他知识。'}
          </p>
        )}
        <div className="practice-links">
          <Link to="/weaknesses">核对学习依据 →</Link>
          {lesson && <Link to={`/lessons/${lesson.id}`}>原课程：{lesson.title} →</Link>}
        </div>
      </section>
      <section className="card section-card" aria-labelledby="generation-title">
        <div className="module-title">
          <h2 id="generation-title">01 / 选一道题</h2>
          <span className="muted">3类题型 · 各2档难度</span>
        </div>
        <div className="practice-config">
          <label>
            知识
            <select
              aria-label="知识"
              value={snap.selection.knowledgeId}
              onChange={(e) => controller.select({ knowledgeId: e.target.value })}
            >
              {practiceKnowledgeIds.map((id) => (
                <option key={id} value={id}>
                  {labels[id]}
                </option>
              ))}
            </select>
          </label>
          <label>
            难度
            <select
              aria-label="难度"
              value={snap.selection.difficulty}
              onChange={(e) => controller.select({ difficulty: Number(e.target.value) as 1 | 2 })}
            >
              <option value={1}>1 · 基础</option>
              <option value={2}>2 · 变化</option>
            </select>
          </label>
          <label>
            种子
            <input
              aria-label="种子"
              inputMode="numeric"
              value={snap.selection.seed}
              maxLength={32}
              onChange={(e) => controller.select({ seed: e.target.value })}
            />
          </label>
          <button
            className="button button-primary"
            disabled={running}
            onClick={() => void controller.run('generate')}
          >
            生成题目
          </button>
          {running && (
            <button className="button" onClick={() => controller.cancel()}>
              取消本次操作
            </button>
          )}
          <button className="button" onClick={() => controller.clear()}>
            清空本次加练
          </button>
        </div>
        <div role="status" data-testid="generated-status">
          {running
            ? '正在真实执行，请稍候……'
            : snap.error
              ? `${errors[snap.error] ?? '操作未完成，请检查代码或重试。'}（${snap.error}）`
              : problem
                ? `参考解已验证全部${problem.validation.checkedCases}个输入。`
                : '生成后显示题目、输入范围与起始代码。'}
        </div>
      </section>
      {problem && (
        <>
          <section className="practice-problem" aria-labelledby="generated-title">
            <p className="muted">
              C · 难度{problem.difficulty} · 种子{problem.seed}
            </p>
            <h2 id="generated-title">{problem.title}</h2>
            <p>{problem.prompt}</p>
            <p>
              输入为整数 {problem.inputMin} 至 {problem.inputMax}，共{problem.cases.length}
              个。提交会检查该范围内的全部输入。
            </p>
            <PracticeExamples
              key={problem.problemId}
              inputFormat={`输入一个 ${problem.inputMin} 至 ${problem.inputMax} 之间的整数。`}
              outputFormat="按题目要求输出计算结果，末尾换行。"
              samples={problem.cases.map((test) => ({
                input: test.inputText,
                output: test.expectedStdout,
              }))}
            />
            <details>
              <summary>查看可复现题目标识与输入预期</summary>
              <p className="practice-id">{problem.problemId}</p>
              <ul>
                {problem.cases.map((c) => (
                  <li key={c.caseId}>
                    输入 <code>{c.inputText}</code> → 输出 <code>{c.expectedStdout.trimEnd()}</code>
                  </li>
                ))}
              </ul>
            </details>
          </section>
          <section className="card section-card" aria-labelledby="generated-editor-title">
            <div className="module-title">
              <h2 id="generated-editor-title">02 / 写下你的解法</h2>
              <span className="muted">教学 C 子集 · 32 KiB以内</span>
            </div>
            <p>C 代码</p>
            <CodeEditor
              label="C 代码"
              dialect="c"
              value={snap.source}
              onChange={(text) => controller.edit(text)}
            />
            {!validSource && <p role="alert">代码超过32 KiB。</p>}
            <div className="practice-config practice-submit">
              <button
                className="button button-primary"
                disabled={running || !validSource}
                onClick={() => void controller.run('grade')}
              >
                提交
              </button>
              {running && (
                <button className="button" onClick={() => controller.cancel()}>
                  取消本次操作
                </button>
              )}
            </div>
            <details>
              <summary>查看已验证的参考解</summary>
              <pre>{problem.referenceSource}</pre>
              <button className="button" onClick={() => controller.edit(problem.referenceSource)}>
                用参考解替换当前草稿
              </button>
            </details>
          </section>
        </>
      )}
      {assessment && (
        <section
          className="card section-card"
          data-testid="generated-assessment"
          data-verdict={assessment.verdict}
          data-complete={String(assessment.complete)}
        >
          <h2 role="status">
            {assessment.verdict === 'passed'
              ? '通过'
              : assessment.complete
                ? '未通过'
                : '提交未完成，请重试'}
          </h2>
        </section>
      )}
    </div>
  );
}
