import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { loadCoursePractice, type CoursePractice } from '../content/practice';
import { visibleText } from '../snapshot-export/layout';
import { collectNoteEntries, createNotesPackage, filterNoteEntries, noteChapters } from './model';
import { noteKinds, type NoteEntry, type NoteFilter, type NotesPackage } from './types';
import { useNoteSnapshots } from './session';
import { SnapshotPreview } from './SnapshotPreview';
import { DownloadPanel } from './DownloadPanel';
import './notes.css';

const emptyFilter: NoteFilter = { chapterId: '', from: '', to: '', types: [] };
const lang = (value: NoteEntry['language']) =>
  value === 'cpp' ? 'C++' : value === 'c' ? 'C' : '语言未确认';
function EntryPreview({ entry }: { entry: NoteEntry }) {
  const snapshot = entry.snapshot,
    reference = entry.reference;
  const source = snapshot?.source.text ?? reference?.source;
  const range = snapshot?.position.highlighted.range;
  return (
    <article className="note-preview-entry" data-note-preview-id={entry.id}>
      <h3>{entry.title}</h3>
      <p className="muted">
        {noteKinds[entry.kind]} · {entry.date} · {lang(entry.language)}
        {entry.timeMeaning === 'legacy-summary' ? ' · 旧聚合摘要' : ''}
      </p>
      <p className="note-prose">{entry.text}</p>
      {entry.warnings.map((w) => (
        <p className="notice" key={w}>
          {w}
        </p>
      ))}
      <details>
        <summary>版本与来源</summary>
        <p>
          原内容：
          {entry.origin.packageRef
            ? `${entry.origin.packageRef.id}@${entry.origin.packageRef.version}`
            : '无课程包引用'}{' '}
          /{' '}
          {entry.origin.subjectRef
            ? `${entry.origin.subjectRef.id}@${entry.origin.subjectRef.version}`
            : '内置观察'}{' '}
          · 学习修订 {entry.origin.learningRevision ?? '不适用'}
        </p>
        {entry.currentRef && (
          <p>
            当前核对引用：{entry.currentRef.id}@{entry.currentRef.version}
          </p>
        )}
        {reference && (
          <>
            <p>
              当前教材：{reference.document} · {reference.locator}
            </p>
            <p>
              内容摘要：{reference.contentSha256 ?? '按独立注册表版本核对'}
              {reference.registryRef &&
                ` · ${reference.registryRef.id}@${reference.registryRef.version}`}
            </p>
            {reference.programRef && (
              <p>
                示例程序：{reference.programRef.id}@{reference.programRef.version}
              </p>
            )}
          </>
        )}
        {snapshot && (
          <>
            <p>
              捕获时间 {snapshot.capturedAt} · 运行 {snapshot.runtime.identity.runId} · 源码版本{' '}
              {snapshot.source.sourceRevision}
            </p>
            <p>源码 SHA-256：{snapshot.source.sha256}</p>
            <p>运行协议：{JSON.stringify(snapshot.runtime)}</p>
          </>
        )}
      </details>
      {entry.href && (
        <Link className="text-link" to={entry.href}>
          打开已核对的来源
        </Link>
      )}
      {source && (
        <div className="note-source">
          <h4>
            {snapshot
              ? `捕获源码 · ${lang(entry.language)}`
              : `当前教材示例 · ${lang(entry.language)}（非历史作答）`}
          </h4>
          {snapshot && (
            <p>
              执行位置：{snapshot.position.executed.description} · 高亮原因：
              {snapshot.position.highlighted.reason}
            </p>
          )}
          <pre aria-label="笔记源码">
            <code>
              {visibleText(source)
                .split('\n')
                .map((line, i) => (
                  <span
                    className={
                      range && i + 1 >= range.start.line && i + 1 <= range.end.line
                        ? 'note-code-line note-code-highlight'
                        : 'note-code-line'
                    }
                    key={i}
                  >
                    <span aria-hidden="true" className="note-line-number">
                      {i + 1}
                    </span>
                    {line || ' '}
                  </span>
                ))}
            </code>
          </pre>
        </div>
      )}
      {snapshot && (
        <>
          <SnapshotPreview document={snapshot} />
          <details>
            <summary>完整捕获状态与输入（只读）</summary>
            <pre>
              {visibleText(
                JSON.stringify(
                  {
                    input: snapshot.input,
                    position: snapshot.position,
                    currentState: snapshot.currentState,
                    currentStep: snapshot.currentStep,
                    types: snapshot.types,
                    executionOutcome: snapshot.executionOutcome,
                    terminalAtCursor: snapshot.terminalAtCursor,
                  },
                  null,
                  2,
                ),
              )}
            </pre>
          </details>
        </>
      )}
    </article>
  );
}
function Selection({
  lease,
  entries,
  chapters,
  timeZone,
  stamp,
}: {
  lease: string;
  entries: NoteEntry[];
  chapters: { id: string; title: string }[];
  timeZone: string;
  stamp: { generation: string; revision: number; epoch: number };
}) {
  const [filter, setFilter] = useState<NoteFilter>(emptyFilter);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<NotesPackage | null>(null);
  const [message, setMessage] = useState('');
  let candidates: NoteEntry[] = [],
    filterError = '';
  try {
    candidates = filterNoteEntries(entries, filter);
  } catch {
    filterError = '日期范围无效，请检查起止日期。';
  }
  const change = (next: NoteFilter) => {
    setFilter(next);
    setSelected([]);
    setPreview(null);
    setMessage('');
  };
  return (
    <>
      <section className="card section-card note-filter" aria-labelledby="note-range">
        <h2 id="note-range">选择范围</h2>
        <div className="note-filter-fields">
          <label>
            章节
            <select
              value={filter.chapterId}
              onChange={(e) => change({ ...filter, chapterId: e.target.value })}
            >
              <option value="">全部章节（仍需逐条选择）</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
              <option value="unlinked">未关联或旧内容</option>
            </select>
          </label>
          <label>
            开始日期
            <input
              type="date"
              value={filter.from}
              onChange={(e) => change({ ...filter, from: e.target.value })}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={filter.to}
              onChange={(e) => change({ ...filter, to: e.target.value })}
            />
          </label>
        </div>
        <fieldset>
          <legend>内容类型</legend>
          <div className="note-types">
            {Object.entries(noteKinds).map(([kind, title]) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={filter.types.includes(kind as keyof typeof noteKinds)}
                  onChange={(e) =>
                    change({
                      ...filter,
                      types: e.target.checked
                        ? [...filter.types, kind as keyof typeof noteKinds]
                        : filter.types.filter((t) => t !== kind),
                    })
                  }
                />
                {title}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="muted">
          日期按档案时区 {timeZone}；解析沿关联记录日期。改变范围会清空已选内容和旧预览。
        </p>
      </section>
      <div className="note-workspace">
        <section className="card section-card note-candidates" aria-labelledby="note-candidates">
          <div className="module-title">
            <h2 id="note-candidates">候选内容 · {candidates.length} 条</h2>
            <span>已选 {selected.length} 条</span>
          </div>
          {filterError ? (
            <p role="alert">{filterError}</p>
          ) : !filter.types.length ? (
            <p>先选择内容类型，再勾选要整理的记录。默认没有选择任何个人记录。</p>
          ) : !candidates.length ? (
            <p data-testid="notes-empty">
              这个范围没有可整理的内容。可调整日期或章节；快照需要先从真实运行中加入。
            </p>
          ) : (
            <ul className="note-candidate-list">
              {candidates.map((e) => (
                <li key={e.id} data-note-id={e.id} data-note-kind={e.kind}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${noteKinds[e.kind]} ${e.title} ${e.occurredAt}`}
                      checked={selected.includes(e.id)}
                      onChange={(event) => {
                        setSelected((ids) =>
                          event.target.checked ? [...ids, e.id] : ids.filter((id) => id !== e.id),
                        );
                        setPreview(null);
                        setMessage('');
                      }}
                    />
                    <span>
                      <strong>{e.title}</strong>
                      <small>
                        {noteKinds[e.kind]} · {e.date} · {lang(e.language)}
                        {e.timeMeaning === 'legacy-summary' ? ' · 旧摘要' : ''}
                      </small>
                      <span>{e.text.split('\n')[0]}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="inline-actions">
            <button
              className="button button-primary"
              disabled={!selected.length || !!filterError}
              onClick={() => {
                try {
                  setPreview(
                    createNotesPackage(
                      entries,
                      selected,
                      filter,
                      lease,
                      timeZone,
                      new Date().toISOString(),
                    ),
                  );
                  setMessage('');
                } catch (e) {
                  setPreview(null);
                  setMessage(e instanceof Error ? e.message : '预览失败，请重试。');
                }
              }}
            >
              生成笔记预览
            </button>
            <button
              className="button"
              disabled={!selected.length}
              onClick={() => {
                setSelected([]);
                setPreview(null);
                setMessage('');
              }}
            >
              清空选择
            </button>
          </div>
          {message && <p role="alert">{message}</p>}
        </section>
        <section className="card section-card note-preview" aria-labelledby="note-preview">
          <h2 id="note-preview">笔记预览{preview ? ` · ${preview.entries.length} 条` : ''}</h2>
          {preview ? (
            <div data-testid="notes-preview" data-count={preview.entries.length}>
              <p className="muted">仅含本次勾选内容。来源版本、缺失项和捕获位置随各条保留。</p>
              {preview.entries.map((e) => (
                <EntryPreview key={e.id} entry={e} />
              ))}
              <DownloadPanel pack={preview} stamp={stamp} />
            </div>
          ) : (
            <p>勾选后生成预览，可在这里核对正文、源码位置、快照和来源。</p>
          )}
        </section>
      </div>
    </>
  );
}
export default function NotesPage() {
  const { state } = useLearning();
  const { tray, documents } = useNoteSnapshots();
  const [practiceState, setPractice] = useState<{
    status: 'loading' | 'ready' | 'failed';
    value: CoursePractice | null;
  }>({ status: 'loading', value: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void loadCoursePractice()
      .then((value) => {
        if (active) setPractice({ status: 'ready', value });
      })
      .catch(() => {
        if (active) setPractice({ status: 'failed', value: null });
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const snapshot = state.snapshot,
    reading = state.reading,
    catalog = state.practiceCatalog ?? reading?.catalog;
  const uncertain = state.recovery?.issues.some((i) =>
    ['meta', 'progress', 'receipts', 'aliases'].includes(i.store),
  );
  const usable =
    snapshot &&
    reading &&
    catalog &&
    !uncertain &&
    !state.temporary &&
    state.status === 'ready' &&
    !state.pendingCount;
  const entries = usable
    ? collectNoteEntries(snapshot, reading, practiceState.value, catalog, documents)
    : [];
  const lease = `${state.sessionEpoch}:${snapshot?.meta.generation}:${snapshot?.meta.revision}:${practiceState.status}:${documents.map((d) => d.snapshotId).join(',')}`;
  return (
    <div className="study-notes-page" data-page-id="PAGE-20-1">
      <PageHeading
        kicker="本地整理"
        title="学习笔记"
        description="把选中的学习记录、错题、解析与运行快照整理在一起。"
      />
      <LearningSaveStatus />
      <p className="notice">
        只在当前标签页整理，不上传。刷新会清空本次选择与临时快照；已下载的Markdown压缩包由你自行管理。
      </p>
      <div className="inline-actions">
        <Link className="text-link" to="/notebook">
          查看错题与陌生点
        </Link>
        <Link className="text-link" to="/cases">
          从算法与演示加入快照
        </Link>
        <Link className="text-link" to="/memory">
          从内存观察加入快照
        </Link>
      </div>
      <section className="note-tray" aria-labelledby="note-tray">
        <h2 id="note-tray">本次快照 · {documents.length}/8 份</h2>
        <p className="muted">
          在真实运行的“保存当前快照”中加入；当前源码、输入和完整状态随快照保留。已有下载文件由你自行管理。
        </p>
        {!!documents.length && (
          <ul>
            {documents.map((d) => (
              <li key={d.snapshotId}>
                <span>
                  {d.origin.title} · 步骤 {d.position.cursor}/{d.position.length}
                </span>
                <button className="button button-small" onClick={() => tray.remove(d.snapshotId)}>
                  移除 {d.origin.title} 步骤 {d.position.cursor}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {practiceState.status === 'failed' && (
        <p role="alert">
          练习资源加载失败，暂不附练习示例源码；记录摘要和课程正文仍可核对。
          <button
            className="button button-small"
            onClick={() => {
              setPractice({ status: 'loading', value: null });
              setRetry((n) => n + 1);
            }}
          >
            重试加载解析资源
          </button>
        </p>
      )}
      {usable ? (
        <Selection
          key={lease}
          lease={lease}
          entries={entries}
          chapters={noteChapters(reading)}
          timeZone={snapshot.meta.timeZone}
          stamp={{
            generation: snapshot.meta.generation,
            revision: snapshot.meta.revision,
            epoch: state.sessionEpoch,
          }}
        />
      ) : (
        <p role="status">
          {state.status === 'loading'
            ? '正在读取本地记录…'
            : '当前记录尚未确认保存或有受影响的数据，请先使用上方恢复/重试入口；旧预览已撤销。'}
        </p>
      )}
    </div>
  );
}
