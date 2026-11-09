import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { serialization } from 'blockly/core';
import { CppCourseClient } from '../engine/cpp-course-client';
import type { CppCourseResponse, CppInput } from '../engine/cpp-course-protocol';
import type { JavaDraft } from '../storage/java-course';
import { useLearning } from '../learning/react';
import { useJavaResource } from '../java/use-resource';
import { useUnsavedChanges } from '../workbench/use-unsaved-changes';
import { CodeEditor, type CodeEditorHandle } from '../components/CodeEditor';
import { CppLoadState, CppNav, CppText } from './CoursePage';
import { cppExercise, cppFreeDocument } from './identities';
import { loadCppLesson, type CppCase } from './repository';
import { CppTrace } from './Trace';
import { cppSourcePositions } from './source';

const BlockPane = lazy(() => import('./BlockPane'));
const startSource =
  '#include <iostream>\n\nint main() {\n    int total = 0;\n    int i = 1;\n    while (i <= 4) {\n        total = total + i;\n        i = i + 1;\n    }\n    std::cout << total << std::endl;\n}\n';
const emptyInput: CppInput = { kind: 'integers', values: [] };
interface Target {
  id: string;
  title: string;
  source: string;
  lesson?: string;
  prompt?: string;
  hint?: string;
  cases?: CppCase[];
  profile?: string;
  example?: boolean;
}
const free: Target = { id: cppFreeDocument, title: 'C++ 工作台', source: startSource };
function inputText(input: CppInput) {
  return input.values.join(input.kind === 'lines' ? '\n' : ' ');
}
function parseInput(text: string, kind: CppInput['kind']): CppInput {
  if (kind === 'lines') {
    const values = text === '' ? [] : text.split(/\r\n|\n|\r/u);
    if (
      values.length > 2 ||
      values.some((line) => line.length > 30 || !/^[\x20-\x7e]*$/u.test(line))
    )
      throw new Error('行输入最多两行，每行最多 30 个可打印 ASCII 字符。');
    return { kind, values };
  }
  const tokens = text.trim() ? text.trim().split(/\s+/u) : [];
  const values = tokens.map(Number);
  if (
    values.length > 30 ||
    tokens.some((token, index) => !/^[+-]?\d+$/u.test(token) || Math.abs(values[index]) > 999)
  )
    throw new Error('请输入最多 30 个 -999 到 999 的整数，以空格分隔。');
  return { kind, values };
}
function friendly(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'S_REVISION_CONFLICT')
    return '另一页面更新了草稿。当前编辑内容已保留，请核对后再保存。';
  if (code === 'E_CANCELLED') return '已取消当前操作。';
  if (code === 'E_DEADLINE') return '操作超过运行时限，可以缩小输入后重试。';
  if (code === 'S_GENERATION_STALE') return '本地档案已经变化，请重新打开工作台。';
  return code || '操作未完成。';
}

function Editor({
  target,
  draft,
  writable,
  epoch,
}: {
  target: Target;
  draft: JavaDraft | null;
  writable: boolean;
  epoch: number;
}) {
  const { service, state } = useLearning();
  const [engine] = useState(() => new CppCourseClient());
  const [source, setSource] = useState(draft?.source ?? target.source);
  const [revision, setRevision] = useState<string>(() => crypto.randomUUID());
  const [kind, setKind] = useState<CppInput['kind']>(target.cases?.[0].input.kind ?? 'integers');
  const [input, setInput] = useState(inputText(target.cases?.[0].input ?? emptyInput));
  const [saved, setSaved] = useState(draft);
  const [busy, setBusy] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<{ response: CppCourseResponse; input: CppInput } | null>(
    null,
  );
  const [cursor, setCursor] = useState(0);
  const [blocks, setBlocks] = useState<serialization.blocks.State | null>(null);
  const [blockDirty, setBlockDirty] = useState(false);
  const operation = useRef(0);
  const position = useRef(0);
  const editor = useRef<CodeEditorHandle>(null);
  const dirty = source !== (saved?.source ?? target.source);
  useUnsavedChanges(dirty || blockDirty);
  const abort = useCallback(() => {
    operation.current++;
    engine.invalidate();
  }, [engine]);
  const seek = useCallback((next: number) => {
    position.current = next;
    setCursor(next);
  }, []);
  useEffect(() => {
    const release = service.subscribeSessionInvalidation(abort);
    return () => {
      release();
      abort();
    };
  }, [abort, service]);

  const resetResult = () => {
    abort();
    setBusy('');
    setResult(null);
    seek(0);
    setNotice('');
    setError('');
  };
  const changeSource = (text: string) => {
    resetResult();
    setSource(text);
    setRevision(crypto.randomUUID());
    setBlocks(null);
    setBlockDirty(false);
  };

  async function run(mode: 'run' | 'judge', group = 0, persist = true) {
    resetResult();
    const token = operation.current;
    setBusy(mode === 'judge' ? '正在提交判题…' : '正在运行…');
    try {
      const actual = mode === 'judge' ? target.cases![group].input : parseInput(input, kind);
      const response =
        mode === 'judge'
          ? await engine.judge(source, target.profile!, group, actual, revision)
          : await engine.run(source, actual, revision);
      if (operation.current !== token) return;
      setResult({ response, input: actual });
      if (mode === 'judge' && persist && writable) {
        const fact = await service.recordCppJudge(target.profile!, response, epoch, revision);
        if (operation.current === token && fact) setNotice('判题结果已记入本地复盘。');
      }
    } catch (cause) {
      if (operation.current === token) setError(friendly(cause));
    } finally {
      if (operation.current === token) setBusy('');
    }
  }

  async function save(replace = false) {
    setSaving(true);
    setError('');
    const token = operation.current;
    try {
      const previous = replace
        ? (await service.readCppCourse(epoch)).drafts.find((row) => row.documentId === target.id)
        : saved;
      const value = await service.saveCppDraft(
        target.id,
        source,
        previous?.revision ?? null,
        epoch,
      );
      setSaved(value);
      setConflict(false);
      if (token === operation.current) setNotice('草稿已保存到此浏览器。');
    } catch (cause) {
      setConflict(cause instanceof Error && cause.message === 'S_REVISION_CONFLICT');
      setError(friendly(cause));
    } finally {
      setSaving(false);
    }
  }

  async function copyExample() {
    if (!writable || saving || blockDirty) return;
    const copy = source;
    setSaving(true);
    setError('');
    try {
      const previous = (await service.readCppCourse(epoch)).drafts.find(
        (row) => row.documentId === cppFreeDocument,
      );
      if (
        previous &&
        previous.source !== copy &&
        !window.confirm('自由工作台已有草稿。用当前示例代码替换它？')
      )
        return;
      const value = await service.saveCppDraft(
        cppFreeDocument,
        copy,
        previous?.revision ?? null,
        epoch,
      );
      if (service.getState().sessionEpoch !== epoch) return;
      setSaved(value);
      setNotice('这份示例代码的副本已保存到 C++ 自由工作台。可打开自由工作台继续编辑。');
    } catch (cause) {
      if (service.getState().sessionEpoch === epoch) setError(friendly(cause));
    } finally {
      setSaving(false);
    }
  }

  async function map() {
    resetResult();
    const token = operation.current;
    setBusy('正在检查积木映射…');
    try {
      const response = await engine.analyze(source, revision);
      if (response.status !== 'completed')
        throw new Error(`原稿保留 · ${response.diagnostic?.code ?? '无法映射'}`);
      const { cppToBlocks } = await import('./blocks');
      if (token !== operation.current) return;
      setBlocks(cppToBlocks(source, response.nodeMap));
      setBlockDirty(false);
    } catch (cause) {
      if (token === operation.current) setError(friendly(cause));
    } finally {
      if (token === operation.current) setBusy('');
    }
  }

  async function applyBlocks(text: string) {
    const token = operation.current;
    const response = await engine.analyze(text, revision);
    if (token !== operation.current) throw new Error('编辑内容已变化，请重新映射。');
    if (response.status !== 'completed')
      throw new Error(`原稿保留 · ${response.diagnostic?.code ?? '无法应用'}`);
    changeSource(text);
    setNotice('积木已应用到当前源码。');
  }

  async function download(format: 'json' | 'md' | 'png' | 'zip') {
    if (!result || exporting) return;
    const token = operation.current;
    setExporting(true);
    setError('');
    try {
      const { exportCppSnapshot } = await import('./snapshot');
      await exportCppSnapshot(
        format,
        result.response,
        result.input,
        cursor,
        target.title,
        target.id,
        () => token === operation.current && position.current === cursor,
      );
      if (token === operation.current) setNotice('当前步骤已导出。');
    } catch (cause) {
      if (token === operation.current) setError(friendly(cause));
    } finally {
      setExporting(false);
    }
  }

  const response = result?.response;
  const replay = response?.replay;
  const diagnostic =
    response?.diagnostic ??
    (replay?.terminal.byteRange && replay.terminal.code
      ? { code: replay.terminal.code, byteRange: replay.terminal.byteRange }
      : null);
  const positions = useMemo(() => cppSourcePositions(source), [source]);
  const where = diagnostic ? positions.get(diagnostic.byteRange.start) : null;
  const locate = () => {
    if (!diagnostic || !where) return;
    editor.current?.focus();
    editor.current?.select(
      where.utf16Offset,
      positions.get(diagnostic.byteRange.end)?.utf16Offset ?? where.utf16Offset,
    );
  };
  return (
    <>
      <header className="cpp-title">
        <div>
          <h1 tabIndex={-1}>{target.title}</h1>
          <p>C++20 教学子集 · 输入、变量与轨迹在当前浏览器中处理。</p>
        </div>
        {target.lesson && <Link to={'/cpp/lesson/' + target.lesson}>返回小节</Link>}
      </header>
      {target.example && (
        <p className="muted">示例可临时修改和运行。需要保留修改时，请复制到自由工作台并保存。</p>
      )}
      {!writable && (
        <p className="muted">当前只能临时编辑和运行；草稿与判题记录需要可写的本地档案。</p>
      )}
      {target.prompt && (
        <section className="cpp-sheet" aria-label="题目要求">
          <h2>练习要求</h2>
          <p>
            <CppText text={target.prompt} /> 输出末尾换行。
          </p>
          <details>
            <summary>查看提示</summary>
            <p>
              <CppText text={target.hint ?? ''} />
            </p>
          </details>
        </section>
      )}
      <div className="cpp-editor-grid">
        <section className="cpp-sheet cpp-editor-panel">
          <div className="cpp-title">
            <h2>源码</h2>
            <span className="cpp-muted">
              {saving
                ? '正在保存草稿…'
                : dirty
                  ? '有未保存的修改'
                  : saved
                    ? '草稿已保存到此浏览器'
                    : '当前文档，修改后可保存草稿'}
            </span>
          </div>
          <CodeEditor
            ref={editor}
            label="C++ 源码"
            dialect="cpp"
            value={source}
            onChange={changeSource}
          />
          {blocks && (
            <Suspense fallback={<p role="status">正在打开积木…</p>}>
              <BlockPane
                initial={blocks}
                disabled={!!busy}
                apply={applyBlocks}
                onDirty={setBlockDirty}
              />
            </Suspense>
          )}
          <div className="python-actions cpp-actions">
            <button
              className="button button-primary"
              disabled={!!busy || blockDirty}
              onClick={() => void run('run')}
            >
              运行
            </button>
            {target.profile && (
              <button disabled={!!busy || blockDirty} onClick={() => void run('judge')}>
                提交判题
              </button>
            )}
            <button
              disabled={!busy}
              onClick={() => {
                resetResult();
                setNotice('已取消当前操作。');
              }}
            >
              取消
            </button>
            {!target.example && (
              <button
                disabled={!writable || saving || !dirty || blockDirty}
                onClick={() => void save()}
              >
                保存草稿
              </button>
            )}
            {target.example && (
              <>
                <button
                  disabled={!writable || saving || blockDirty || !!busy}
                  onClick={() => void copyExample()}
                >
                  复制到自由工作台并保存
                </button>
                {saved?.documentId === cppFreeDocument && (
                  <Link to="/cpp/workbench">打开已保存的自由工作台</Link>
                )}
              </>
            )}
            {blocks ? (
              <button
                onClick={() => {
                  setBlocks(null);
                  setBlockDirty(false);
                }}
              >
                关闭积木
              </button>
            ) : (
              <button disabled={!!busy} onClick={() => void map()}>
                切换到积木
              </button>
            )}
          </div>
        </section>
        <aside className="cpp-sheet cpp-input-panel">
          <h2>本次输入</h2>
          <label>
            输入方式{' '}
            <select
              value={kind}
              onChange={(event) => {
                resetResult();
                setKind(event.target.value as CppInput['kind']);
              }}
            >
              <option value="integers">整数序列</option>
              <option value="lines">文本行</option>
            </select>
          </label>
          <textarea
            aria-label="C++ 输入"
            className="python-editor"
            value={input}
            onChange={(event) => {
              resetResult();
              setInput(event.target.value);
            }}
            rows={4}
          />
          {target.cases && (
            <div className="python-actions cpp-actions">
              {target.cases.map((group, at) => (
                <button
                  key={group.id}
                  onClick={() => {
                    resetResult();
                    setKind(group.input.kind);
                    setInput(inputText(group.input));
                  }}
                >
                  样例 {at + 1}
                </button>
              ))}
            </div>
          )}
          <p className="cpp-muted">运行使用这里的输入。判题使用题目的四组固定输入。</p>
        </aside>
      </div>
      {busy && <p role="status">{busy}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {conflict && (
        <button
          className="button"
          disabled={!writable || saving || blockDirty}
          onClick={() => void save(true)}
        >
          以当前代码保存
        </button>
      )}
      {response && (
        <section className="cpp-sheet" aria-label="运行结果">
          <h2>{response.judgement ? '判题结果' : '运行结果'}</h2>
          <p role="status">
            {response.judgement
              ? response.judgement.passed
                ? '四组均通过'
                : '尚未全部通过'
              : response.status === 'completed'
                ? '执行完成'
                : response.status === 'limited'
                  ? '到达执行限额'
                  : '执行出错'}
            {diagnostic ? ` · ${diagnostic.code}` : ''}
          </p>
          {where && (
            <button onClick={locate}>
              定位第 {where.line} 行，第 {where.column} 列
            </button>
          )}
          {response.judgement && (
            <div className="python-actions cpp-actions">
              {response.judgement.cases.map((group) => (
                <button
                  key={group.index}
                  disabled={!!busy}
                  aria-pressed={response.judgement!.reviewCase === group.index}
                  onClick={() => void run('judge', group.index, false)}
                >
                  复盘第 {group.index + 1} 组 ·{' '}
                  {group.passed ? '通过' : group.status === 'limited' ? '超限' : '未通过'}
                </button>
              ))}
              <Link to="/cpp/review">查看本地复盘</Link>
            </div>
          )}
        </section>
      )}
      {replay && (
        <CppTrace
          key={replay.identity.runId}
          packet={replay}
          source={source}
          cursor={cursor}
          seek={seek}
          playbackRate={state.snapshot?.settings.playbackRate ?? 1}
        />
      )}
      {replay?.trace && (
        <section className="cpp-sheet">
          <h2>导出当前步骤</h2>
          <div className="python-actions cpp-actions">
            {(['json', 'md', 'png', 'zip'] as const).map((format) => (
              <button key={format} disabled={exporting} onClick={() => void download(format)}>
                导出 {format === 'md' ? 'Markdown' : format.toUpperCase()}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const loadTarget = async (key: string, signal: AbortSignal): Promise<Target> => {
  if (key === cppFreeDocument) return free;
  const profile = cppExercise(key);
  const { lesson } = await loadCppLesson(profile?.lesson ?? key, signal);
  if (lesson.example?.mode !== 'wasm' || lesson.activity?.mode !== 'judge')
    throw new Error('E_CPP_LESSON_UNKNOWN');
  return profile
    ? {
        id: key,
        title: lesson.title + '练习',
        source: lesson.activity.starter,
        lesson: lesson.id,
        prompt: lesson.activity.prompt,
        hint: lesson.activity.hint,
        cases: lesson.example.cases,
        profile: key,
      }
    : {
        id: key,
        title: lesson.title + '示例',
        source: lesson.example.source,
        lesson: lesson.id,
        cases: lesson.example.cases,
        example: true,
      };
};

function LoadedEditor({ target }: { target: Target }) {
  const { service, state } = useLearning();
  const epoch = state.sessionEpoch;
  const writable =
    (state.snapshot?.meta.dbVersion ?? 0) >= 13 && state.recovery?.writable !== false;
  const load = useCallback(
    async (id: string) => {
      if (!writable || target.example) return { draft: null };
      const rows = await service.readCppCourse(epoch);
      return { draft: rows.drafts.find((row) => row.documentId === id) ?? null };
    },
    [writable, service, epoch, target.example],
  );
  const drafts = useJavaResource(target.id, load);
  if (!drafts.value) return <CppLoadState failed={drafts.failed} retry={drafts.retry} />;
  return (
    <Editor
      key={`${target.id}:${epoch}`}
      target={target}
      draft={drafts.value.draft}
      writable={writable}
      epoch={epoch}
    />
  );
}

export default function CppWorkbench() {
  const { lessonId, profileId } = useParams();
  const target = useJavaResource(profileId ?? lessonId ?? cppFreeDocument, loadTarget);
  return (
    <div className="python-screen cpp-screen">
      <CppNav />
      {target.value ? (
        <LoadedEditor target={target.value} />
      ) : (
        <CppLoadState failed={target.failed} retry={target.retry} />
      )}
    </div>
  );
}
