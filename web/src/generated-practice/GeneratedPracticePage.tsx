import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { useLearning } from '../learning/react';
import { WeaknessController } from '../weaknesses/WeaknessPage';
import { weaknessReasons } from '../weaknesses/model';
import { CustomViews } from '../custom-code/Views';
import '../custom-code/custom-code.css';
import { GeneratedPracticeController } from './controller';
import { practiceKnowledgeIds } from './protocol';
import './practice.css';
import { c6GeneratedFoundation } from '../c6-learning/independent';

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
const outcomes = {
  passed: '通过',
  'wrong-answer': '输出不符',
  'program-error': '程序错误',
  'resource-limit': '达到预算',
};
export default function GeneratedPracticePage() {
  const { service, state: learning } = useLearning();
  const [controller] = useState(() => new GeneratedPracticeController());
  const [weakness] = useState(() => new WeaknessController(service));
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const summary = useSyncExternalStore(weakness.subscribe, weakness.getSnapshot);
  const [mode, setMode] = useState('basic');
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
  const { problem, assessment, view } = snap;
  const running = snap.status === 'running';
  const validSource = new TextEncoder().encode(snap.source).length <= 32768;
  const replay = assessment?.replay;
  const range = view.byteRange;
  const sourceBytes = new TextEncoder().encode(replay?.request.source ?? '');
  const decode = (start: number, end?: number) =>
    new TextDecoder().decode(sourceBytes.slice(start, end));
  return (
    <div
      className="generated-practice-page"
      data-testid="generated-practice"
      data-status={snap.status}
      data-cursor={view.cursor}
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
          <Link to="/reviews">复习队列 →</Link>
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
              个。提交将穷尽该范围；试运行只检查你输入的一个值。
            </p>
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
            <label className="practice-editor-label">
              C 代码
              <textarea
                spellCheck={false}
                data-testid="generated-source"
                value={snap.source}
                onChange={(e) => controller.edit(e.target.value)}
              />
            </label>
            {!validSource && <p role="alert">代码超过32 KiB。</p>}
            <div className="practice-config practice-submit">
              <label>
                试运行输入
                <input
                  aria-label="试运行输入"
                  value={snap.input}
                  maxLength={256}
                  onChange={(e) => controller.setInput(e.target.value)}
                />
              </label>
              <button
                className="button"
                disabled={running || !validSource}
                onClick={() => void controller.run('preview')}
              >
                试运行一个输入
              </button>
              <button
                className="button button-primary"
                disabled={running || !validSource}
                onClick={() => void controller.run('grade')}
              >
                提交全部输入
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
          aria-labelledby="generated-result-title"
          data-testid="generated-assessment"
          data-verdict={assessment.verdict}
          data-complete={String(assessment.complete)}
        >
          <h2 id="generated-result-title">
            {snap.operation === 'preview'
              ? '单个输入试运行'
              : assessment.verdict === 'passed'
                ? '全部输入通过'
                : '本次提交尚未通过'}
          </h2>
          <p>
            已检查{assessment.checkedCases}/{assessment.totalCases}个输入，{assessment.passedCases}
            个通过。
            {snap.operation === 'preview'
              ? '单次试运行不表示整题通过。'
              : !assessment.complete
                ? '执行中止，其余输入未检查。'
                : ''}
            本次结果不计分。
          </p>
          <div className="practice-results">
            <table>
              <thead>
                <tr>
                  <th>输入</th>
                  <th>预期输出</th>
                  <th>实际输出</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {assessment.results.map((c) => (
                  <tr key={c.caseId}>
                    <td>
                      <code>{c.inputText}</code>
                    </td>
                    <td>
                      <code>{c.expectedStdout.trimEnd()}</code>
                    </td>
                    <td>
                      <code>{c.actualStdout.trimEnd() || '（无输出）'}</code>
                    </td>
                    <td>
                      {outcomes[c.status]}
                      {c.code ? ` · ${c.code}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>03 / 沿真实执行回看</h3>
          <p>
            当前回放输入 {replay!.inputText}
            。提交保留首个未通过输入的轨迹；全部通过时保留最后一个输入。虚拟地址用于教学。
          </p>
          {view.state ? (
            <>
              <div className="practice-playback">
                <button
                  className="button"
                  disabled={view.cursor === 0}
                  onClick={() => controller.step(-1)}
                >
                  后退一步
                </button>
                <button
                  className="button"
                  disabled={view.cursor === view.length}
                  onClick={() => controller.step(1)}
                >
                  前进一步
                </button>
                <button
                  className="button"
                  onClick={() => (view.playing ? controller.pause() : controller.play())}
                >
                  {view.playing ? '暂停' : '播放'}
                </button>
                <button className="button" onClick={() => controller.replay()}>
                  重新播放
                </button>
                <label>
                  速度
                  <select
                    value={snap.rate}
                    onChange={(e) => controller.setRate(Number(e.target.value))}
                  >
                    {[0.25, 0.5, 1, 1.5, 2, 4].map((n) => (
                      <option key={n} value={n}>
                        {n}×
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  执行位置
                  <input
                    aria-label="执行位置"
                    type="range"
                    min={0}
                    max={view.length}
                    value={view.cursor}
                    onChange={(e) => controller.seek(Number(e.target.value))}
                  />
                </label>
                <span>
                  {view.cursor}/{view.length}
                </span>
              </div>
              <pre className="practice-replay-source" data-testid="generated-highlight">
                {range ? (
                  <>
                    {decode(0, range.start)}
                    <mark>{decode(range.start, range.end)}</mark>
                    {decode(range.end)}
                  </>
                ) : (
                  replay!.request.source
                )}
              </pre>
              <label>
                观察视图
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="basic">变量与输出</option>
                  <option value="memory">内存</option>
                  <option value="stack">调用栈</option>
                </select>
              </label>
              <div data-testid="generated-state" data-state={JSON.stringify(view.state)}>
                <CustomViews state={view.state} result={replay!.result} mode={mode} />
              </div>
            </>
          ) : (
            <p>程序未产生可回放轨迹。请按诊断修正代码。</p>
          )}
        </section>
      )}
    </div>
  );
}
