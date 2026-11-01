import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PageHeading } from '../components/Ui';
import { Workbench } from '../workbench/Workbench';
import { DebugSource } from '../debug/DebugSource';
import { sourceLines } from '../debug/breakpoints';
import { useLearning } from '../learning/react';
import { memoryDiagnostics, memoryStepLabels } from '../memory/presentation';
import { CustomCodeController } from './controller';
import { CustomViews } from './Views';
import type { CustomDraft } from '../storage/custom-draft';
import { useAi } from '../ai-debug/react';
import { AiPanel } from '../ai-debug/Panel';
import './custom-code.css';
const initial =
  '#include <stdio.h>\n\nint main() {\n  int number;\n  scanf("%d", &number);\n  printf("%d\\n", number * 2);\n  return 0;\n}\n';
export default function CustomCodePage() {
  const { service, state: learning } = useLearning();
  const { session: ai } = useAi();
  const [inputRevision, setInputRevision] = useState(() => crypto.randomUUID());
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const aiLease = useRef({ token: 0 });
  const [controller] = useState(() => new CustomCodeController());
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    const lease = aiLease.current;
    const token = ++lease.token;
    const identity = () => {
      const s = controller.getSnapshot();
      return `${s.runs}:${s.result?.identity.runId ?? ''}:${s.view.cursor}`;
    };
    let previous = identity();
    const unsubscribe = controller.subscribe(() => {
      const next = identity();
      if (next !== previous) {
        previous = next;
        ai.invalidateContext();
      }
    });
    return () => {
      unsubscribe();
      queueMicrotask(() => {
        if (lease.token === token) ai.clear();
      });
    };
  }, [ai, controller]);
  const [source, setSource] = useState(initial),
    [input, setInput] = useState('7'),
    [mode, setMode] = useState('basic'),
    [editing, setEditing] = useState(true);
  const [savedText, setSavedText] = useState<string | null>(null),
    [draft, setDraft] = useState<CustomDraft | null>(null),
    [saveStatus, setSaveStatus] = useState('loading'),
    [saveError, setSaveError] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const edits = useRef(0);
  const lease = useRef(0);
  const invalidateLease = useCallback(() => {
    lease.current++;
  }, []);
  const generation = learning.snapshot?.meta.generation;
  const epoch = learning.sessionEpoch;
  const packageKey = learning.snapshot
    ? `${learning.snapshot.meta.activePackageRef.id}@${learning.snapshot.meta.activePackageRef.version}`
    : '';
  const load = useCallback(
    async (replace = false) => {
      const token = ++lease.current;
      const context = service.editorHistoryContext();
      const before = edits.current;
      if (!context) {
        setSaveStatus('unavailable');
        return;
      }
      setSaveStatus('loading');
      setSaveError('');
      try {
        const record = await service.customDraft(context);
        if (token !== lease.current) return;
        setDraft(record);
        setSavedText(record?.source ?? null);
        setSaveStatus('ready');
        if (record && (replace || before === 0) && edits.current === before) {
          controller.setSource(record.source, 'c');
          setSource(record.source);
          setEditing(true);
        }
      } catch (e) {
        if (token === lease.current) {
          setSaveStatus('read-error');
          setSaveError(e instanceof Error ? e.message : 'S_STORAGE_UNAVAILABLE');
        }
      }
    },
    [service, controller],
  );
  useEffect(() => {
    let stopped = false;
    queueMicrotask(() => {
      if (!stopped) void load();
    });
    return () => {
      stopped = true;
      invalidateLease();
    };
  }, [load, generation, epoch, packageKey, invalidateLease]);
  useEffect(() => {
    controller.setSource(initial, 'c');
    const hidden = () => {
      if (document.visibilityState !== 'visible') controller.pause();
    };
    document.addEventListener('visibilitychange', hidden);
    const unsub = service.subscribeSessionInvalidation(() => {
      invalidateLease();
      controller.invalidate();
      setSaveStatus('unavailable');
      setDraft(null);
      setSavedText(null);
    });
    return () => {
      invalidateLease();
      controller.invalidate();
      unsub();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [controller, service, invalidateLease]);
  const parsed = input.trim() ? input.trim().split(/[\s,，]+/) : [];
  const values = parsed.map(Number);
  const inputValid =
    parsed.length <= 30 &&
    parsed.every((v) => /^[+-]?\d+$/.test(v)) &&
    values.every((v) => Number.isInteger(v) && v >= -999 && v <= 999);
  const sourceValid = new TextEncoder().encode(source).length <= 32768;
  const { result, view, status } = snap;
  const available = Boolean(view.state);
  const terminal = result?.terminal;
  const range =
    snap.hit?.byteRange ??
    (terminal?.status !== 'completed' && view.cursor === view.length
      ? terminal?.byteRange
      : null) ??
    view.byteRange;
  const errorRange = terminal?.byteRange;
  const at = errorRange
    ? new TextDecoder().decode(new TextEncoder().encode(source).slice(0, errorRange.start)).length
    : 0;
  const line = errorRange ? source.slice(0, at).split(/\r\n|\r|\n/).length : null;
  const column = errorRange
    ? Array.from(
        source.slice(
          Math.max(source.lastIndexOf('\n', at - 1), source.lastIndexOf('\r', at - 1)) + 1,
          at,
        ),
      ).length + 1
    : null;
  const save = async () => {
    const context = service.editorHistoryContext();
    if (!context || !sourceValid) return;
    const token = lease.current;
    const text = source;
    setSaveStatus('saving');
    setSaveError('');
    try {
      const record = await service.customDraft(context, {
        expectedRevision: draft?.revision ?? 0,
        source: text,
        updatedAt: new Date().toISOString(),
      });
      if (token !== lease.current) return;
      setDraft(record);
      setSavedText(text);
      setSaveStatus('ready');
    } catch (e) {
      if (token === lease.current) {
        setSaveStatus('save-error');
        setSaveError(e instanceof Error ? e.message : 'S_STORAGE_UNAVAILABLE');
      }
    }
  };
  const stop = useCallback(
    (visible: boolean) => {
      if (!visible) controller.pause();
    },
    [controller],
  );
  return (
    <div
      className="custom-code-page"
      data-testid="custom-code-page"
      data-status={status}
      data-cursor={view.cursor}
    >
      <PageHeading
        kicker="自由练习"
        title="C 代码工作台"
        description="粘贴教学 C 程序，用真实执行观察变量、内存和调用栈。"
      />
      <div className="custom-actions">
        <button
          className="button button-primary"
          disabled={!sourceValid || !inputValid || status === 'running'}
          onClick={() => {
            setEditing(false);
            void controller.execute(source, 'c', values);
          }}
        >
          运行代码
        </button>
        {status === 'running' && (
          <button className="button" onClick={() => controller.cancel()}>
            取消运行
          </button>
        )}
        <button
          className="button"
          disabled={!sourceValid || !['ready', 'save-error'].includes(saveStatus)}
          onClick={() => void save()}
        >
          保存草稿
        </button>
        <span role="status" data-testid="custom-save-status">
          {saveStatus === 'saving'
            ? '正在保存……'
            : saveStatus === 'loading'
              ? '正在读取本地草稿……'
              : saveStatus === 'unavailable'
                ? '草稿暂未连接本地存储，当前编辑仅临时保留。'
                : saveStatus === 'read-error'
                  ? '无法读取草稿，当前文本仍保留。'
                  : saveStatus === 'save-error'
                    ? '草稿未保存，当前文本仍保留。'
                    : source === savedText
                      ? '草稿已保存到当前浏览器。'
                      : '有未保存的修改。'}
        </span>
        {['save-error', 'read-error', 'unavailable'].includes(saveStatus) && (
          <button className="button button-small" onClick={() => void load(false)}>
            重新连接草稿
          </button>
        )}
        {(draft || saveError === 'S_REVISION_CONFLICT') && (
          <button className="button button-small" onClick={() => void load(true)}>
            载入已保存版本（替换当前文本）
          </button>
        )}
      </div>
      {saveError && (
        <p role="alert">
          {saveError === 'S_REVISION_CONFLICT'
            ? '另一页面已更新草稿。当前文本未覆盖，可复制保留后载入已保存版本。'
            : `本地保存暂不可用（${saveError}）。`}
        </p>
      )}
      <details className="custom-support">
        <summary>支持范围与本地数据</summary>
        <p>
          支持 int、条件和循环、固定一维数组、函数与递归、受限指针和简单结构体。scanf 每次只读取一个
          %d 整数；printf 支持 %d、%% 和换行。暂不支持完整 C、任意库、文件或网络操作。
        </p>
        <p>
          源码上限32 KiB，输入最多30个 −999
          至999的整数。代码与输入在浏览器内执行；草稿只保存原始源码，输入、断点和执行轨迹不保存。修改代码会清除旧断点，刷新后恢复最近成功保存的草稿。
        </p>
      </details>
      <Workbench
        kind="practice"
        firstLabel="代码与输入"
        secondLabel="执行观察"
        onSecondVisibility={stop}
        first={
          <section className="workbench-panel custom-editor-panel">
            <header className="panel-heading">
              <h2>C 源码</h2>
              <div className="inline-actions">
                <button
                  className="button button-small"
                  aria-pressed={editing}
                  onClick={() => setEditing(true)}
                >
                  编辑代码
                </button>
                <button
                  className="button button-small"
                  aria-pressed={!editing}
                  onClick={() => setEditing(false)}
                >
                  源码定位与断点
                </button>
              </div>
            </header>
            <div hidden={!editing}>
              <label htmlFor="custom-source">可粘贴或编辑原始 C 代码</label>
              <textarea
                ref={editor}
                id="custom-source"
                aria-label="C 代码"
                spellCheck={false}
                value={source}
                onChange={(e) => {
                  edits.current++;
                  ai.invalidateContext();
                  setSelection(null);
                  controller.setSource(e.target.value, 'c');
                  setSource(e.target.value);
                }}
                onSelect={(e) => {
                  const next = {
                    start: e.currentTarget.selectionStart,
                    end: e.currentTarget.selectionEnd,
                  };
                  if (next.start !== selection?.start || next.end !== selection?.end) {
                    ai.invalidateContext();
                    setSelection(next);
                  }
                }}
              />
              {!sourceValid && <p role="alert">代码超过32 KiB，原文已保留。请缩短后运行或保存。</p>}
            </div>
            <div hidden={editing}>
              <p>点击行号设置断点；自动播放在该行步骤完成后暂停。</p>
              <p>
                {snap.breakpoints.length
                  ? `断点：第 ${snap.breakpoints.join('、')} 行`
                  : '尚未设置断点。'}
                {snap.breakpoints.length > 0 && (
                  <button
                    className="button button-small"
                    onClick={() => controller.clearBreakpoints()}
                  >
                    清除断点
                  </button>
                )}
              </p>
              {snap.breakpointNotice && <p role="status">{snap.breakpointNotice}</p>}
              {available && snap.breakpoints.some((n) => !snap.visitedLines.includes(n)) && (
                <p>本次轨迹没有部分断点行的停靠步骤，不会移动到其他行。</p>
              )}
              <DebugSource
                source={source}
                byteRange={range ?? null}
                breakpoints={snap.breakpoints}
                visitedLines={snap.visitedLines}
                ready={available}
                onToggle={(n) => controller.toggleBreakpoint(n)}
              />
            </div>
            <label className="custom-input">
              整数输入{' '}
              <input
                aria-label="整数输入"
                value={input}
                onChange={(e) => {
                  controller.invalidate();
                  setInput(e.target.value);
                  setInputRevision(crypto.randomUUID());
                  ai.invalidateContext();
                }}
              />
            </label>
            <p className="muted">按读取顺序提供，使用空格或逗号分隔。输入仅用于本次运行。</p>
            {!inputValid && <p role="alert">请输入最多30个 −999 至999的整数。</p>}
          </section>
        }
        second={
          <section
            className="workbench-panel custom-stage"
            tabIndex={0}
            aria-label="执行观察"
            onKeyDown={(e) => {
              if (
                (e.target as HTMLElement).closest('button,input,select,textarea,a') ||
                e.ctrlKey ||
                e.altKey ||
                e.metaKey
              )
                return;
              if (e.code === 'Space') {
                e.preventDefault();
                controller.toggle();
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                controller.step(e.key === 'ArrowLeft' ? -1 : 1);
              }
            }}
          >
            <header className="panel-heading">
              <h2>执行观察</h2>
              <span>
                {view.stepKind ? (memoryStepLabels[view.stepKind] ?? '执行步骤') : '等待运行'}
              </span>
            </header>
            <p role="status" data-testid="custom-run-status">
              {status === 'running'
                ? '正在执行并检查轨迹……'
                : status === 'failed'
                  ? `运行未完成：${snap.error}。可修改后重新运行。`
                  : result
                    ? terminal?.status === 'completed'
                      ? '执行完成'
                      : terminal?.status === 'limited'
                        ? '达到运行预算上限'
                        : '程序停止，查看下方诊断'
                    : '运行后，从初始状态逐步查看。'}
            </p>
            {terminal?.code && (
              <div className="custom-diagnostic" role="alert" data-testid="custom-diagnostic">
                <strong>{terminal.code}</strong>
                <p>
                  {memoryDiagnostics[terminal.code] ?? '程序未能继续，请核对当前代码与支持范围。'}
                  {line ? ` 第 ${line} 行，第 ${column} 列。` : ''}
                </p>
                {errorRange && (
                  <button
                    className="button button-small"
                    onClick={() => {
                      controller.seek(view.length);
                      setEditing(true);
                      requestAnimationFrame(() => {
                        editor.current?.focus();
                        editor.current?.setSelectionRange(
                          at,
                          at +
                            new TextDecoder().decode(
                              new TextEncoder()
                                .encode(source)
                                .slice(errorRange.start, errorRange.end),
                            ).length,
                        );
                      });
                    }}
                  >
                    定位错误源码
                  </button>
                )}
              </div>
            )}
            <div className="custom-playback">
              <button
                className="button button-small"
                disabled={!available || view.cursor === 0}
                onClick={() => controller.step(-1)}
              >
                后退
              </button>
              <button
                className="button button-small"
                disabled={!available || view.cursor === view.length}
                onClick={() => controller.step(1)}
              >
                前进
              </button>
              <button
                className="button button-small"
                disabled={!available || (!view.playing && view.cursor === view.length)}
                onClick={() => controller.toggle()}
              >
                {view.playing ? '暂停' : snap.hit ? '继续' : '播放'}
              </button>
              <button
                className="button button-small"
                disabled={!available}
                onClick={() => controller.seek(0)}
              >
                回到开头
              </button>
              <label>
                速度{' '}
                <select
                  aria-label="播放速度"
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
            </div>
            <label className="custom-cursor">
              步骤 {view.cursor} / {view.length}
              <input
                type="range"
                aria-label="执行步骤"
                min={0}
                max={Math.max(1, view.length)}
                value={view.cursor}
                disabled={!available}
                onChange={(e) => controller.seek(Number(e.target.value))}
              />
            </label>
            {snap.hit && (
              <p role="status" data-testid="debug-hit">
                已命中第 {snap.hit.line} 行断点 · 第 {snap.hit.cursor} 步。
              </p>
            )}
            {range && (
              <p>
                当前定位：第{' '}
                {sourceLines(source).findLast((l) => l.byteStart <= range.start)?.number ?? 1} 行。
              </p>
            )}
            <div className="memory-tabs" role="group" aria-label="选择执行视图">
              {[
                ['basic', '基础视图'],
                ['memory', '内存视图'],
                ['stack', '调用栈视图'],
              ].map(([key, label]) => (
                <button
                  className="button button-small"
                  key={key}
                  aria-pressed={mode === key}
                  onClick={() => setMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {view.state && result ? (
              <CustomViews
                key={result.identity.runId}
                state={view.state}
                result={result}
                mode={mode}
              />
            ) : (
              <p className="custom-empty">暂无执行状态。运行支持范围内的程序后查看。</p>
            )}
            <AiPanel
              input={{
                source,
                result,
                state: view.state,
                cursor: view.cursor,
                inputRevision,
                selection,
              }}
              pause={() => controller.pause()}
              locate={(fact) => {
                const range = fact.kind === 'state' ? null : fact.byteRange;
                if (fact.kind !== 'diagnostic') {
                  controller.seek(fact.kind === 'step' ? fact.step : fact.atCursor);
                  setMode(fact.kind === 'state' ? 'memory' : 'basic');
                  setEditing(false);
                } else if (range) {
                  setEditing(true);
                  const start = new TextDecoder().decode(
                    new TextEncoder().encode(source).slice(0, range.start),
                  ).length;
                  const end = new TextDecoder().decode(
                    new TextEncoder().encode(source).slice(0, range.end),
                  ).length;
                  requestAnimationFrame(() => {
                    editor.current?.focus();
                    editor.current?.setSelectionRange(start, end);
                  });
                }
              }}
            />
          </section>
        }
      />
    </div>
  );
}
