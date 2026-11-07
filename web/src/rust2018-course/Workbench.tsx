import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { serialization } from 'blockly/core';
import { Rust2018Client } from '../engine/rust2018-client';
import type { RustResponse } from '../engine/rust2018-protocol';
import type { JavaDraft } from '../storage/java-course';
import { useLearning } from '../learning/react';
import { useJavaResource } from '../java/use-resource';
import { useUnsavedChanges } from '../workbench/use-unsaved-changes';
import { RustLoadState, RustNav, RustText } from './CoursePage';
import { rustExercise, rustFreeDocument } from './identities';
import { loadRustLesson, type RustCase } from './repository';
import { RustTrace } from './Trace';
import { rustSourcePositions } from './source';

const BlockPane = lazy(() => import('./BlockPane'));
const startSource =
  'fn main() {\n    let mut line = String::new();\n    std::io::stdin().read_line(&mut line).unwrap();\n    let n: i32 = line.trim().parse().unwrap();\n    println!("{}", n + 1);\n}\n';
interface Target {
  id: string;
  title: string;
  source: string;
  lesson?: string;
  prompt?: string;
  hint?: string;
  cases?: RustCase[];
  profile?: string;
  example?: boolean;
}
const free: Target = { id: rustFreeDocument, title: 'Rust 工作台', source: startSource };
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
  const [engine] = useState(() => new Rust2018Client());
  const [source, setSource] = useState(draft?.source ?? target.source);
  const [revision, setRevision] = useState<string>(() => crypto.randomUUID());
  const [input, setInput] = useState(target.cases?.[0].input ?? '4\n');
  const [saved, setSaved] = useState(draft);
  const [busy, setBusy] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<{ response: RustResponse; input: string } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [blocks, setBlocks] = useState<serialization.blocks.State | null>(null);
  const [blockDirty, setBlockDirty] = useState(false);
  const operation = useRef(0);
  const position = useRef(0);
  const editor = useRef<HTMLTextAreaElement>(null);
  const dirty = source !== (saved?.source ?? target.source);
  useUnsavedChanges(!target.example && (dirty || blockDirty));
  const abort = useCallback(() => {
    operation.current++;
    engine.invalidate();
  }, [engine]);
  const seek = useCallback((next: number) => {
    position.current = next;
    setCursor(next);
  }, []);
  useEffect(() => {
    const release = service.subscribeSessionInvalidation(() => {
      abort();
      setBusy('');
      setResult(null);
      seek(0);
      setBlocks(null);
      setBlockDirty(false);
      setNotice('');
      setError('');
    });
    return () => {
      release();
      abort();
    };
  }, [abort, seek, service]);

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
      const actual = mode === 'judge' ? target.cases![group].input : input;
      const response =
        mode === 'judge'
          ? await engine.judge(source, target.profile!, group, revision)
          : await engine.run(source, actual, revision);
      if (operation.current !== token) return;
      setResult({ response, input: actual });
      if (mode === 'judge' && persist && writable) {
        const fact = await service.recordRustJudge(target.profile!, response, epoch, revision);
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
        ? (await service.readRustCourse(epoch)).drafts.find((row) => row.documentId === target.id)
        : saved;
      const value = await service.saveRustDraft(
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

  async function map() {
    resetResult();
    const token = operation.current;
    setBusy('正在检查积木映射…');
    try {
      const response = await engine.analyze(source, revision);
      if (response.status !== 'completed' || response.analysis?.status !== 'mapped')
        throw new Error(
          response.diagnostic
            ? `原稿保留 · ${response.diagnostic.code}`
            : '原稿保留：当前积木只支持 fn main 中的 let、赋值、单值 println! 及整数、布尔算式。String、输入、函数和控制流请继续使用源码编辑器。',
        );
      const { rustToBlocks } = await import('./blocks');
      if (token !== operation.current) return;
      setBlocks(rustToBlocks(source, response.nodeMap, response.analysis));
      setBlockDirty(false);
    } catch (cause) {
      if (token === operation.current) setError(friendly(cause));
    } finally {
      if (token === operation.current) setBusy('');
    }
  }

  async function applyBlocks(text: string) {
    resetResult();
    const token = operation.current;
    setBusy('正在检查积木代码…');
    try {
      const response = await engine.analyze(text, revision);
      if (token !== operation.current) throw new Error('编辑内容已变化，请重新映射。');
      if (response.status !== 'completed' || response.analysis?.status !== 'mapped')
        throw new Error(`原稿保留 · ${response.diagnostic?.code ?? '无法应用'}`);
      changeSource(text);
      setNotice('积木已应用到当前源码。');
    } finally {
      if (token === operation.current) setBusy('');
    }
  }

  async function download(format: 'json' | 'md' | 'png' | 'zip') {
    if (!result || exporting) return;
    const token = operation.current;
    setExporting(true);
    setError('');
    try {
      const { exportRustSnapshot } = await import('./snapshot');
      await exportRustSnapshot(
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
  const diagnostic = response?.diagnostic ?? replay?.terminal.diagnostic;
  const positions = useMemo(() => rustSourcePositions(source), [source]);
  const where = diagnostic ? positions.get(diagnostic.byteRange.start) : null;
  const locate = () => {
    if (!diagnostic || !where) return;
    editor.current?.focus();
    editor.current?.setSelectionRange(
      where.utf16Offset,
      positions.get(diagnostic.byteRange.end)?.utf16Offset ?? where.utf16Offset,
    );
  };
  return (
    <>
      <header className="rust-title">
        <div>
          <h1>{target.title}</h1>
          <p>Rust 2018 教学子集 · 输入、变量与轨迹在当前浏览器中处理。</p>
        </div>
        {target.lesson && <Link to={'/rust/lesson/' + target.lesson}>返回小节</Link>}
      </header>
      {target.prompt && (
        <section className="rust-sheet" aria-label="题目要求">
          <h2>练习要求</h2>
          <p>
            <RustText text={target.prompt} /> 输出末尾换行。
          </p>
          <details>
            <summary>查看提示</summary>
            <p>
              <RustText text={target.hint ?? ''} />
            </p>
          </details>
        </section>
      )}
      <div className="rust-editor-grid">
        <section className="rust-sheet rust-editor-panel">
          <div className="rust-title">
            <h2>源码</h2>
            <span className="rust-muted">
              {dirty ? '有改动' : saved ? '已保存草稿' : '当前文档'}
            </span>
          </div>
          <textarea
            ref={editor}
            aria-label="Rust 源码"
            className="python-editor"
            value={source}
            onChange={(event) => changeSource(event.target.value)}
            spellCheck={false}
            rows={14}
          />
          {blocks && (
            <Suspense fallback={<p role="status">正在打开积木…</p>}>
              <BlockPane
                initial={blocks}
                disabled={!!busy}
                apply={applyBlocks}
                onDirty={(value) => {
                  if (value) resetResult();
                  setBlockDirty(value);
                }}
              />
            </Suspense>
          )}
          <div className="python-actions rust-actions">
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
        <aside className="rust-sheet rust-input-panel">
          <h2>本次输入</h2>
          <p className="rust-muted">按原样读取文本与换行，可使用 UTF-8 字符。</p>
          <textarea
            aria-label="Rust 输入"
            className="python-editor"
            value={input}
            onChange={(event) => {
              resetResult();
              setInput(event.target.value);
            }}
            rows={4}
          />
          {target.cases && (
            <div className="python-actions rust-actions">
              {target.cases.map((group, at) => (
                <button
                  key={at}
                  onClick={() => {
                    resetResult();
                    setInput(group.input);
                  }}
                >
                  样例 {at + 1}
                </button>
              ))}
            </div>
          )}
          <p className="rust-muted">运行使用这里的输入。判题使用题目的四组固定输入。</p>
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
        <section className="rust-sheet" aria-label="运行结果">
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
            <div className="python-actions rust-actions">
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
              <Link to="/rust/review">查看本地复盘</Link>
            </div>
          )}
        </section>
      )}
      {replay && (
        <RustTrace
          key={response!.identity.runId}
          response={response!}
          source={source}
          cursor={cursor}
          seek={seek}
          playbackRate={state.snapshot?.settings.playbackRate ?? 1}
        />
      )}
      {replay?.trace && (
        <section className="rust-sheet">
          <h2>导出当前步骤</h2>
          <div className="python-actions rust-actions">
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
  if (key === rustFreeDocument) return free;
  const profile = rustExercise(key);
  const { lesson } = await loadRustLesson(profile?.lesson ?? key, signal);
  if (lesson.example?.mode !== 'wasm' || lesson.activity?.mode !== 'judge')
    throw new Error('E_RUST_LESSON_UNKNOWN');
  return profile
    ? {
        id: key,
        title: lesson.title + '练习',
        source: lesson.activity.starter,
        lesson: lesson.id,
        prompt: lesson.activity.prompt,
        hint: lesson.activity.hints.join(' '),
        cases: lesson.example.cases ?? [],
        profile: key,
      }
    : {
        id: key,
        title: lesson.title + '示例',
        source: lesson.example.source,
        lesson: lesson.id,
        cases: lesson.example.cases ?? [],
        example: true,
      };
};

function LoadedEditor({ target }: { target: Target }) {
  const { service, state } = useLearning();
  const epoch = state.sessionEpoch;
  const writable = state.snapshot?.meta.dbVersion === 14 && state.recovery?.writable !== false;
  const load = useCallback(
    async (id: string) => {
      if (!writable || target.example) return { draft: null };
      const rows = await service.readRustCourse(epoch);
      return { draft: rows.drafts.find((row) => row.documentId === id) ?? null };
    },
    [writable, service, epoch, target.example],
  );
  const drafts = useJavaResource(target.id, load);
  if (!drafts.value) return <RustLoadState failed={drafts.failed} retry={drafts.retry} />;
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

export default function RustWorkbench() {
  const { lessonId, profileId } = useParams();
  const target = useJavaResource(profileId ?? lessonId ?? rustFreeDocument, loadTarget);
  return (
    <div className="python-screen rust-screen">
      <RustNav />
      {target.value ? (
        <LoadedEditor target={target.value} />
      ) : (
        <RustLoadState failed={target.failed} retry={target.retry} />
      )}
    </div>
  );
}
