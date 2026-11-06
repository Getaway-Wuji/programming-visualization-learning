import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useLearning } from '../learning/react';
import { JavaExecutionClient } from '../engine/java-client';
import type { JavaPacket, JavaResponse } from '../engine/java-types';
import type { JavaDraft } from '../storage/java-course';
import { useUnsavedChanges } from '../workbench/use-unsaved-changes';
import type { JavaActivity, JavaExample } from './content-types';
import { JavaLoadState, JavaNavigation } from './CoursePage';
import { javaExercise, javaFreeDocument } from './identities';
import { loadJavaArticle } from './repository';
import { useJavaResource } from './use-resource';
import { JavaBlocks } from './JavaBlocks';
import { javaBlocks } from './blocks';
import { TraceView } from './TraceView';
import { JavaSnapshotPanel } from './SnapshotPanel';

type Exercise = Extract<JavaActivity, { kind: 'rust-judge' }>;
type Example = Extract<JavaExample, { status: 'runnable-required' }>;
const freeSource = `public class Main {
    public static void main(String[] args) {
        int total = 0;
        int i = 1;
        while (i <= 4) {
            total = total + i;
            i = i + 1;
        }
        System.out.println(total);
    }
}
`;
interface Target {
  id: string;
  title: string;
  initial: string;
  exercise?: Exercise;
  example?: Example;
  sourceUrl?: string;
  lessonPath?: string;
  lessonId?: string;
}
type Mapping = { revision: string; initial: ReturnType<typeof javaBlocks> };
type LiveResult = { response: JavaResponse; source: string; revision: string; token: number };
const message = (error: unknown) => {
  const code = error instanceof Error ? error.message : '';
  if (code === 'S_REVISION_CONFLICT')
    return '另一页面更新了草稿或档案。当前代码仍在编辑器，可核对后再保存。';
  if (code === 'S_GENERATION_STALE') return '本地档案已变化，请重新打开工作台。';
  if (code === 'E_DEADLINE') return '运行超过时间限制，可以缩小输入后重试。';
  if (code === 'E_SOURCE_LIMIT' || code === 'E_INPUT_LIMIT') return '代码或输入超过当前运行额度。';
  if (code === 'E_CANCELLED') return '已取消当前操作。';
  return '操作未完成' + (code ? ' · ' + code : '') + '。';
};

function Editor({
  target,
  draft,
  epoch,
  writable,
  latestPass,
}: {
  target: Target;
  draft: JavaDraft | null;
  epoch: number;
  writable: boolean;
  latestPass: boolean;
}) {
  const { service, state } = useLearning();
  const [engine] = useState(() => new JavaExecutionClient());
  const [source, setSource] = useState(draft?.source ?? target.initial);
  const [revision, setRevision] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState(target.example?.cases[0]?.input ?? '');
  const [savedDraft, setSavedDraft] = useState(draft);
  const [busy, setBusy] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<LiveResult | null>(null);
  const [judgeRetry, setJudgeRetry] = useState(false);
  const [caseIndex, selectCase] = useState(0);
  const [cursor, seek] = useState(0);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [blockDirty, setBlockDirty] = useState(false);
  const [showBlocks, setShowBlocks] = useState(false);
  const [mobilePane, setMobilePane] = useState<'task' | 'work'>('work');
  const [showSnapshot, setShowSnapshot] = useState(false);
  const operation = useRef(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const sourceRef = useRef(source);
  const dirty = source !== (savedDraft?.source ?? target.initial);
  useUnsavedChanges(!target.example && (dirty || blockDirty));
  const abort = useCallback(() => {
    operation.current++;
    engine.invalidate();
  }, [engine]);
  useEffect(() => {
    const unsubscribe = service.subscribeSessionInvalidation(abort);
    return () => {
      unsubscribe();
      abort();
    };
  }, [abort, service]);

  const changeSource = (text: string) => {
    abort();
    sourceRef.current = text;
    setSource(text);
    setRevision(crypto.randomUUID());
    setBusy('');
    setError('');
    setNotice('');
    setResult(null);
    setMapping(null);
    setShowSnapshot(false);
    setJudgeRetry(false);
    setShowBlocks(false);
    setBlockDirty(false);
  };
  const changeInput = (text: string) => {
    abort();
    setInput(text);
    setResult(null);
    setBusy('');
    setJudgeRetry(false);
    setNotice('');
    setError('');
  };
  const stillCurrent = (token: number) =>
    operation.current === token && service.getState().sessionEpoch === epoch;

  async function record(live: LiveResult, token: number) {
    if (!target.exercise || !writable || !stillCurrent(token)) return;
    try {
      const saved = await service.recordJavaJudge(target.id, live.response, epoch, live.revision);
      if (stillCurrent(token)) {
        setJudgeRetry(false);
        setNotice(saved ? '判题结果已保存到本机。' : '这次判题未完成，学习记录保持原状态。');
      }
    } catch (cause) {
      if (stillCurrent(token)) {
        setError('判题结果尚未保存。' + message(cause));
        setJudgeRetry(true);
      }
    }
  }
  async function execute(judge: boolean) {
    const token = ++operation.current;
    setBusy(judge ? '正在判题' : '正在运行');
    setResult(null);
    setError('');
    setNotice('');
    setJudgeRetry(false);
    try {
      const response = await (judge
        ? engine.judge(source, target.id, revision)
        : engine.run(source, input, revision));
      if (!stillCurrent(token)) return;
      const live = { response, source, revision, token };
      selectCase(0);
      seek(
        response.result.kind === 'run'
          ? response.result.packet.terminal.cursor
          : response.result.kind === 'judge'
            ? (response.result.cases[0]?.packet.terminal.cursor ?? 0)
            : 0,
      );
      setResult(live);
      if (judge) await record(live, token);
    } catch (cause) {
      if (stillCurrent(token)) setError(message(cause));
    } finally {
      if (stillCurrent(token)) setBusy('');
    }
  }
  async function analyze(text = source, apply = false) {
    const token = ++operation.current;
    const nextRevision = apply ? crypto.randomUUID() : revision;
    setBusy('正在核对积木');
    setResult(null);
    setJudgeRetry(false);
    setError('');
    setNotice('');
    try {
      const response = await engine.analyze(text, target.id, nextRevision);
      if (!stillCurrent(token)) return;
      const edit = response.result;
      if (edit.kind !== 'edit' || edit.status !== 'mapped') {
        const label =
          edit.kind === 'edit'
            ? (edit.diagnostic?.code ?? '当前程序含暂不支持往返的语法或注释')
            : '编辑结果无效';
        if (apply) throw Error(label);
        setMapping(null);
        setNotice(label + '。代码原稿已保留。');
        return;
      }
      const initial = javaBlocks(text, edit.blockMap);
      if (apply) {
        sourceRef.current = text;
        setSource(text);
        setRevision(nextRevision);
        setBlockDirty(false);
      }
      setMapping({ revision: nextRevision, initial });
      setShowBlocks(true);
    } catch (cause) {
      if (stillCurrent(token)) setError(message(cause));
      if (apply) throw cause;
    } finally {
      if (stillCurrent(token)) setBusy('');
    }
  }
  async function save(replace = false) {
    const copy = source;
    setSaving(true);
    setError('');
    try {
      const known = replace
        ? (await service.readJavaCourse(epoch)).drafts.find((row) => row.documentId === target.id)
        : savedDraft;
      const saved = await service.saveJavaDraft(target.id, copy, known?.revision ?? null, epoch);
      if (service.getState().sessionEpoch !== epoch) return;
      setSavedDraft(saved);
      setNotice(
        sourceRef.current === copy ? '草稿已保存到本机。' : '先前版本已保存，编辑器还有新修改。',
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }
  function indent(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      target.example ||
      (event.key !== 'Tab' && event.key !== 'Enter') ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.nativeEvent.isComposing
    )
      return;
    const area = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = area;
    const first = start === 0 ? 0 : source.lastIndexOf('\n', start - 1) + 1;
    const before = source.slice(0, first);
    const line = source.slice(first, start);
    if (event.key === 'Enter') {
      const existing = /^ */u.exec(line)?.[0] ?? '';
      const suite = line.trimEnd().endsWith('{');
      if (!existing && !suite) return;
      event.preventDefault();
      const insertion = '\n' + existing + (suite ? '    ' : '');
      changeSource(source.slice(0, start) + insertion + source.slice(end));
      requestAnimationFrame(() =>
        editor.current?.setSelectionRange(start + insertion.length, start + insertion.length),
      );
      return;
    }
    if (event.shiftKey && start === end) {
      const remove = /^ {1,4}/u.exec(source.slice(first))?.[0].length ?? 0;
      if (!remove) return;
      event.preventDefault();
      changeSource(before + source.slice(first + remove));
      const next = Math.max(first, start - remove);
      requestAnimationFrame(() => editor.current?.setSelectionRange(next, next));
      return;
    }
    event.preventDefault();
    const changed = source
      .slice(first, end)
      .split('\n')
      .map((line) => (event.shiftKey ? line.replace(/^ {1,4}/u, '') : '    ' + line))
      .join('\n');
    if (start === end) {
      changeSource(source.slice(0, start) + '    ' + source.slice(end));
      requestAnimationFrame(() => editor.current?.setSelectionRange(start + 4, end + 4));
    } else {
      changeSource(before + changed + source.slice(end));
      requestAnimationFrame(() => editor.current?.setSelectionRange(first, first + changed.length));
    }
  }
  const evaluation = result?.response.result;
  const packet: JavaPacket | undefined =
    evaluation?.kind === 'run'
      ? evaluation.packet
      : evaluation?.kind === 'judge'
        ? evaluation.cases[caseIndex]?.packet
        : undefined;
  const isExercise = !!target.exercise;
  return (
    <>
      <header className="python-title">
        <div>
          <h1 tabIndex={-1}>{target.title}</h1>
          <p className="muted">
            Java · {target.example ? '教学示例' : isExercise ? '课程练习' : '自由代码工作台'}
          </p>
        </div>
        {target.lessonPath && <Link to={target.lessonPath}>回到课程小节</Link>}
      </header>
      {(target.exercise || target.example) && (
        <div className="python-editor-tabs java-mobile-tabs" aria-label="练习区域">
          <button
            type="button"
            aria-pressed={mobilePane === 'work'}
            onClick={() => setMobilePane('work')}
          >
            工作区
          </button>
          <button
            type="button"
            aria-pressed={mobilePane === 'task'}
            onClick={() => setMobilePane('task')}
          >
            {target.exercise ? '题目' : '示例输入'}
          </button>
        </div>
      )}
      <div
        className={
          target.exercise || target.example ? 'java-work-grid' : 'java-work-grid java-solo'
        }
        data-mobile-pane={mobilePane}
      >
        {(target.exercise || target.example) && (
          <aside className="python-sheet java-task">
            <h2>{target.exercise ? '题目' : '示例输入'}</h2>
            {target.exercise && (
              <>
                <p>{target.exercise.task}</p>
                <p className="muted">{target.exercise.observation}</p>
                <p>提交使用四组固定测试。运行代码时读取「运行输入」里的内容。</p>
                <details>
                  <summary>解题提示</summary>
                  <ol>
                    {target.exercise.hints.map((hint) => (
                      <li key={hint}>{hint}</li>
                    ))}
                  </ol>
                </details>
                {latestPass && <p role="status">此题已通过并保存在本机。</p>}
              </>
            )}
            {target.example?.cases.map((item) => (
              <p key={item.name}>
                <button type="button" onClick={() => changeInput(item.input)}>
                  {item.name}
                </button>
              </p>
            ))}
            {target.sourceUrl && (
              <p>
                <a href={target.sourceUrl} rel="noreferrer">
                  课程来源
                </a>
              </p>
            )}
          </aside>
        )}
        <div className="python-work">
          <section className="python-sheet">
            <div className="python-actions">
              <button
                type="button"
                className="button button-primary"
                disabled={!!busy || blockDirty}
                onClick={() => void execute(false)}
              >
                运行代码
              </button>
              {isExercise && (
                <button
                  type="button"
                  disabled={!!busy || blockDirty}
                  onClick={() => void execute(true)}
                >
                  提交判题
                </button>
              )}
              {busy && (
                <button
                  type="button"
                  onClick={() => {
                    abort();
                    setBusy('');
                    setError('已取消当前操作。');
                  }}
                >
                  取消
                </button>
              )}
              {!target.example && (
                <button
                  type="button"
                  disabled={saving || !writable || !dirty}
                  onClick={() => void save()}
                >
                  保存草稿
                </button>
              )}
            </div>
            <div className="python-editor-tabs">
              <button
                type="button"
                aria-pressed={!showBlocks}
                disabled={blockDirty}
                onClick={() => setShowBlocks(false)}
              >
                代码
              </button>
              <button
                type="button"
                aria-pressed={showBlocks}
                disabled={!!busy}
                onClick={() => {
                  if (mapping?.revision === revision) setShowBlocks(true);
                  else void analyze();
                }}
              >
                积木
              </button>
            </div>
            {showBlocks && mapping?.revision === revision ? (
              <JavaBlocks
                initial={mapping.initial}
                disabled={!!busy || !!target.example}
                apply={(text) => analyze(text, true)}
                onDirty={setBlockDirty}
              />
            ) : (
              <textarea
                ref={editor}
                className="python-editor"
                aria-label="Java 代码"
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                value={source}
                readOnly={!!target.example}
                onKeyDown={indent}
                onChange={(event) => changeSource(event.target.value)}
              />
            )}
            {blockDirty && (
              <p role="status">
                有积木修改尚未应用到代码。
                <button
                  type="button"
                  onClick={() => {
                    setMapping(null);
                    setShowBlocks(false);
                    setBlockDirty(false);
                  }}
                >
                  丢弃积木修改
                </button>
              </p>
            )}
            <label className="python-stdin">
              运行输入
              <textarea
                aria-label="运行输入"
                spellCheck={false}
                value={input}
                onChange={(event) => changeInput(event.target.value)}
              />
            </label>
            {!writable && !target.example && (
              <p className="muted">当前只能临时运行，草稿和判题记录需要可写的本地档案。</p>
            )}
            {(busy || notice) && <p role="status">{busy || notice}</p>}
            {error && <p role="alert">{error}</p>}
            {error.includes('另一页面') && dirty && writable && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (window.confirm('用当前编辑器里的代码替换本地已保存的草稿？')) void save(true);
                }}
              >
                以当前代码保存
              </button>
            )}
          </section>
          {evaluation?.kind === 'judge' && (
            <section className="python-sheet" aria-label="判题结果">
              <h2>判题结果</h2>
              <p role="status">
                {evaluation.status === 'passed'
                  ? '四组全部通过'
                  : evaluation.status === 'failed'
                    ? '部分测试未通过'
                    : '判题未完成'}
                {evaluation.diagnostic && ' · ' + evaluation.diagnostic.code}
              </p>
              <div className="python-actions">
                {evaluation.cases.map((item, index) => (
                  <button
                    type="button"
                    key={item.caseKey}
                    aria-pressed={caseIndex === index}
                    onClick={() => {
                      selectCase(index);
                      seek(item.packet.terminal.cursor);
                    }}
                  >
                    第 {item.caseKey} 组 ·{' '}
                    {item.packet.terminal.status === 'completed' &&
                    item.stdoutMatches &&
                    item.observationMatches
                      ? '通过'
                      : '未通过'}
                  </button>
                ))}
              </div>
              {judgeRetry && result && (
                <button type="button" onClick={() => void record(result, operation.current)}>
                  重试保存结果
                </button>
              )}
              <p>
                <Link to="/java/review">查看本地复盘记录</Link>
              </p>
            </section>
          )}
          {packet && result && (
            <TraceView
              key={result.response.runId + '-' + caseIndex}
              packet={packet}
              response={result.response}
              source={result.source}
              cursor={cursor}
              seek={seek}
              playingAllowed={!busy && !showSnapshot}
              playbackRate={state.snapshot?.settings.playbackRate ?? 1}
            />
          )}
          {packet?.trace && result && (
            <JavaSnapshotPanel
              key={result.response.runId + ':' + caseIndex + ':' + cursor}
              packet={packet}
              response={result.response}
              cursor={cursor}
              caseIndex={caseIndex}
              origin={{
                title: target.title,
                documentId: target.id,
                lessonId: target.lessonId,
                sourceUrl: target.sourceUrl,
              }}
              isCurrent={() => stillCurrent(result.token)}
              onPreview={setShowSnapshot}
            />
          )}
        </div>
      </div>
    </>
  );
}

function Session({ target }: { target: Target }) {
  const { service, state } = useLearning();
  const readDrafts = useCallback((epoch: number) => service.readJavaCourse(epoch), [service]);
  const ready = state.snapshot?.meta.dbVersion === 12 && state.recovery?.writable !== false;
  const epoch = state.sessionEpoch;
  const { value, failed, retry } = useJavaResource(
    ready && !target.example ? epoch : -1,
    readDrafts,
  );
  if (ready && !target.example && !value)
    return failed ? (
      <p role="alert">
        本地 Java 档案暂时无法读取。 <button onClick={retry}>重试</button>
      </p>
    ) : (
      <p role="status">正在读取本地 Java 草稿…</p>
    );
  if (!ready && state.status === 'loading') return <p role="status">正在读取本地档案…</p>;
  return (
    <Editor
      key={epoch + ':' + target.id}
      target={target}
      draft={value?.drafts.find((row) => row.documentId === target.id) ?? null}
      epoch={epoch}
      writable={ready}
      latestPass={
        !!state.snapshot?.progress.some(
          (p) => p.eventType === 'exercise.passed' && p.subjectRef.id === target.id,
        )
      }
    />
  );
}

function CourseTarget({
  order,
  section,
  exerciseId,
}: {
  order: number;
  section?: string;
  exerciseId?: string;
}) {
  const { value, failed, retry } = useJavaResource(order, loadJavaArticle);
  if (!value) return <JavaLoadState failed={failed} retry={retry} />;
  const node = value.nodes.find((item) =>
    exerciseId ? item.questionId === exerciseId : item.platformRef.id === section,
  );
  const example = value.examples.find((item) => item.id === node?.exampleId);
  const exercise = value.activities.find((item) => item.id === node?.activityId);
  if (
    !node ||
    example?.status !== 'runnable-required' ||
    (exerciseId && exercise?.kind !== 'rust-judge')
  )
    return <p role="alert">找不到该可运行示例或练习。</p>;
  return (
    <Session
      target={{
        id: exerciseId ?? node.platformRef.id,
        title: exerciseId && exercise?.kind === 'rust-judge' ? exercise.title : node.titleDisplay,
        initial: exerciseId
          ? 'public class Main {\n    public static void main(String[] args) {\n    }\n}\n'
          : example.source,
        ...(exerciseId && exercise?.kind === 'rust-judge' ? { exercise } : { example }),
        sourceUrl: node.sourceRef + (node.anchor ? '#' + encodeURIComponent(node.anchor) : ''),
        lessonId: node.platformRef.id,
        lessonPath: '/java/article/' + order + '/' + node.platformRef.id,
      }}
    />
  );
}

export default function JavaWorkbench() {
  const { exerciseId, order, section } = useParams();
  const exercise = exerciseId ? javaExercise(exerciseId) : null;
  return (
    <section className="python-screen java-screen">
      <JavaNavigation />
      {exerciseId && !exercise ? (
        <p role="alert">找不到这道 Java 练习。</p>
      ) : exercise || order ? (
        <CourseTarget
          order={exercise?.articleOrder ?? Number(order)}
          section={section}
          exerciseId={exerciseId}
        />
      ) : (
        <Session target={{ id: javaFreeDocument, title: 'Java 工作台', initial: freeSource }} />
      )}
    </section>
  );
}
