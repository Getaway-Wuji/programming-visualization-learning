import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { PageHeading } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import { KnowledgeMarksStatus, useKnowledgeMarks } from '../review-notebook/marks';
import { useC6NoteSnapshots, useNoteSnapshots } from '../study-notes/session';
import { NOTE_LIMITS, noteKinds, type NoteFilter } from '../study-notes/types';
import { SnapshotPreview } from '../study-notes/SnapshotPreview';
import { SNAPSHOT_LIMITS, SnapshotError } from '../snapshot-export/types';
import type { SnapshotDocument } from '../snapshot-export/types';
import { visibleText } from '../snapshot-export/layout';
import { waitFor } from '../snapshot-export/browser';
import { C6Boundary } from './CoursePages';
import {
  collectC6NoteEntries,
  createC6NotesPackage,
  filterC6Notes,
  savedC6NotesSnapshot,
  type C6NotesPackage,
} from './notes';
import { C6NotesDownloader } from './notes-download';
import { encodeC6Snapshot, type C6SnapshotDocument } from './snapshot';
import { renderC6SnapshotPng } from './snapshot-picture';
import '../study-notes/notes.css';

function SnapshotSource({ snapshot }: { snapshot: SnapshotDocument | C6SnapshotDocument }) {
  const range =
    snapshot.formatVersion === '2.0.0'
      ? snapshot.position.executedRange
      : snapshot.position.highlighted.range;
  return (
    <pre className="c6-source-read" aria-label="笔记源码">
      <code>
        {visibleText(snapshot.source.text)
          .split('\n')
          .map((line, i) => (
            <span
              key={i}
              className={
                range && i + 1 >= range.start.line && i + 1 <= range.end.line
                  ? 'note-code-line note-code-highlight'
                  : 'note-code-line'
              }
            >
              <span aria-hidden="true" className="note-line-number">
                {i + 1}
              </span>
              {line || ' '}
            </span>
          ))}
      </code>
    </pre>
  );
}

function C6SnapshotPreview({ record }: { record: C6SnapshotDocument }) {
  const [attempt, setAttempt] = useState(0),
    [preview, setPreview] = useState<{ attempt: number; url?: string; error?: boolean }>({
      attempt: 0,
    });
  useEffect(() => {
    if (!attempt) return;
    const abort = new AbortController(),
      started = performance.now();
    let disposed = false;
    const check = () => {
      if (abort.signal.aborted || performance.now() - started >= SNAPSHOT_LIMITS.timeoutMs)
        throw new SnapshotError('SNAPSHOT_TIMEOUT');
    };
    const timer = setTimeout(() => abort.abort(), SNAPSHOT_LIMITS.timeoutMs);
    void renderC6SnapshotPng(record, encodeC6Snapshot(record), abort.signal, check)
      .then((blob) =>
        waitFor(
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(Error('PREVIEW'));
            reader.readAsDataURL(blob);
          }),
          abort.signal,
        ),
      )
      .then((url) => {
        check();
        if (!disposed) setPreview({ attempt, url });
      })
      .catch(() => {
        if (!disposed) setPreview({ attempt, error: true });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      disposed = true;
      clearTimeout(timer);
      abort.abort();
    };
  }, [attempt, record]);
  return (
    <div className="note-picture">
      <button
        className="button button-secondary"
        disabled={attempt > preview.attempt}
        onClick={() => setAttempt((n) => n + 1)}
      >
        {preview.error ? '重试完整状态图片' : '预览完整状态图片'}
      </button>
      {attempt > preview.attempt && <p role="status">正在生成完整状态图片……</p>}
      {preview.error && (
        <p role="alert">完整图片生成失败或超限，请查看完整 JSON 状态；本次没有截断内容。</p>
      )}
      {preview.url && (
        <img
          src={preview.url}
          alt={`${record.origin.title}步骤${record.position.cursor}的完整当前状态`}
        />
      )}
    </div>
  );
}
function Download({
  pack,
  stamp,
}: {
  pack: C6NotesPackage;
  stamp: { generation: string; revision: number; epoch: number };
}) {
  const { service } = useLearning();
  const [title, setTitle] = useState('C 语言学习笔记'),
    [downloader] = useState(() => new C6NotesDownloader());
  const status = useSyncExternalStore(downloader.subscribe, downloader.getSnapshot);
  const current = useRef({ pack, title, stamp });
  useLayoutEffect(() => {
    current.current = { pack, title, stamp };
    downloader.cancel();
  }, [downloader, pack, title, stamp]);
  useLayoutEffect(() => () => downloader.cancel(), [downloader]);
  return (
    <section className="note-download" aria-label="Markdown笔记下载">
      <h3>下载 Markdown 笔记</h3>
      <label>
        笔记标题
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <p>
        只打包当前预览的 {pack.entries.length} 条内容。ZIP 包含 Markdown、所选快照的 PNG 和完整
        JSON，全程在此浏览器生成。
      </p>
      <div className="c6-action-row">
        <button
          className="button button-primary"
          disabled={!title.trim() || status.phase === 'building'}
          onClick={() => {
            const captured = current.current;
            void downloader.start(
              pack,
              title,
              () => current.current === captured,
              (action) => service.withSavedNotesRevision(stamp, action),
            );
          }}
        >
          下载 Markdown 压缩包
        </button>
        {status.phase === 'building' && (
          <button className="button button-secondary" onClick={downloader.cancel}>
            取消笔记打包
          </button>
        )}
      </div>
      {status.message && (
        <p role={status.phase === 'failed' ? 'alert' : 'status'}>{status.message}</p>
      )}
    </section>
  );
}
export default function C6NotesPage() {
  const { state } = useLearning(),
    marks = useKnowledgeMarks().state;
  const current = useC6NoteSnapshots(),
    legacy = useNoteSnapshots();
  const key = [
    state.sessionEpoch,
    state.snapshot?.meta.generation,
    state.snapshot?.meta.revision,
    ...current.documents.map((d) => d.snapshotId),
    ...legacy.documents.map((d) => d.snapshotId),
  ].join(':');
  return (
    <C6Boundary>
      <div className="c6-course-page">
        <PageHeading
          kicker="本地笔记"
          title="学习笔记"
          description="选择当前档案中的真实记录、保存草稿和运行快照，核对后下载。"
        />
        {!savedC6NotesSnapshot(state) || marks.status !== 'ready' ? (
          <>
            <LearningSaveStatus />
            <KnowledgeMarksStatus />
            <p>档案与来源记录准备好后可以选择笔记内容。</p>
          </>
        ) : (
          <NotesSession key={key} />
        )}
      </div>
    </C6Boundary>
  );
}
function NotesSession() {
  const { state } = useLearning(),
    marks = useKnowledgeMarks().state;
  const current = useC6NoteSnapshots(),
    legacy = useNoteSnapshots();
  const snapshot = state.snapshot!,
    index = state.c6!.index!,
    manifest = state.c6!.manifest!;
  const entries = collectC6NoteEntries(state, marks.rows, state.c6!.rows?.drafts ?? [], [
    ...current.documents,
    ...legacy.documents,
  ]);
  const [filter, setFilter] = useState<NoteFilter>({ chapterId: '', from: '', to: '', types: [] });
  const [selected, setSelected] = useState<string[]>([]),
    [pack, setPack] = useState<C6NotesPackage | null>(null),
    [message, setMessage] = useState(''),
    [page, setPage] = useState(0);
  let candidates = [] as typeof entries,
    filterError = '';
  try {
    candidates = filterC6Notes(entries, filter);
  } catch {
    filterError = '日期范围无效，请检查起止日期。';
  }
  const change = (filter: NoteFilter) => {
    setFilter(filter);
    setSelected([]);
    setPack(null);
    setMessage('');
    setPage(0);
  };
  const [stamp] = useState(() => ({
    generation: snapshot.meta.generation,
    revision: snapshot.meta.revision,
    epoch: state.sessionEpoch,
  }));
  const chapters = index.knowledge.filter((k) => k[2] === 'chapter');
  return (
    <>
      <section className="note-filter">
        <h2>选择范围</h2>
        <div className="note-filter-fields">
          <label>
            章节
            <select
              value={filter.chapterId}
              onChange={(e) => change({ ...filter, chapterId: e.target.value })}
            >
              <option value="">全部章节（仍需逐条选择）</option>
              {chapters.map((c) => (
                <option key={c[0]} value={c[1]}>
                  {manifest.nodes.find((n) => `node.${n.id}` === c[1])!.titleDisplay}
                </option>
              ))}
              <option value="unlinked">独立观察或未关联记录</option>
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
            {Object.entries(noteKinds).map(([kind, label]) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  checked={filter.types.includes(kind as keyof typeof noteKinds)}
                  onChange={(e) =>
                    change({
                      ...filter,
                      types: e.target.checked
                        ? [...filter.types, kind as keyof typeof noteKinds]
                        : filter.types.filter((k) => k !== kind),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="muted">
          日期按 {snapshot.meta.timeZone}。改变范围、选择或档案会使旧预览失效。
        </p>
      </section>
      <div className="note-workspace">
        <section className="note-candidates">
          <h2>候选内容 · {candidates.length} 条</h2>
          <p>
            已选 {selected.length} / {NOTE_LIMITS.entries} 条
          </p>
          {filterError ? (
            <p role="alert">{filterError}</p>
          ) : !filter.types.length ? (
            <p>先选择内容类型，再逐条勾选要整理的记录。</p>
          ) : !candidates.length ? (
            <p>这个范围没有可整理的记录。快照需先从真实运行中加入。</p>
          ) : (
            <ul className="note-candidate-list">
              {candidates.slice(page * 40, (page + 1) * 40).map((entry) => (
                <li key={entry.id} data-note-id={entry.id} data-note-kind={entry.kind}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${noteKinds[entry.kind]} ${entry.title} ${entry.occurredAt}`}
                      checked={selected.includes(entry.id)}
                      disabled={
                        !selected.includes(entry.id) && selected.length >= NOTE_LIMITS.entries
                      }
                      onChange={(e) => {
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, entry.id]
                            : ids.filter((id) => id !== entry.id),
                        );
                        setPack(null);
                        setMessage('');
                      }}
                    />
                    <span>
                      <strong>{entry.title}</strong>
                      <small>
                        {noteKinds[entry.kind]} · {entry.date} ·{' '}
                        {entry.language === 'cpp' ? 'C++' : 'C'}
                      </small>
                      <span>{entry.text}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 40 && (
            <div className="c6-action-row">
              <button
                className="button button-secondary"
                disabled={!page}
                onClick={() => setPage((n) => n - 1)}
              >
                上一页记录
              </button>
              <span>
                第 {page + 1} / {Math.ceil(candidates.length / 40)} 页
              </span>
              <button
                className="button button-secondary"
                disabled={(page + 1) * 40 >= candidates.length}
                onClick={() => setPage((n) => n + 1)}
              >
                下一页记录
              </button>
            </div>
          )}
          <button
            className="button button-primary"
            disabled={!selected.length || !!filterError}
            onClick={() => {
              try {
                setPack(createC6NotesPackage(entries, selected, filter, snapshot.meta.timeZone));
                setMessage('');
              } catch {
                setMessage('所选笔记或快照超过当前预算，或来源已变化；请减少选择并重新核对。');
                setPack(null);
              }
            }}
          >
            生成所选内容预览
          </button>
          {message && <p role="alert">{message}</p>}
          {(current.documents.length > 0 || legacy.documents.length > 0) && (
            <details>
              <summary>
                本次临时快照 · {current.documents.length + legacy.documents.length} / 8
              </summary>
              {[...current.documents, ...legacy.documents].map((d) => (
                <p key={d.snapshotId}>
                  {d.origin.title} · 步骤 {d.position.cursor}
                  <button
                    className="text-link"
                    onClick={() =>
                      d.formatVersion === '2.0.0'
                        ? current.tray.remove(d.snapshotId)
                        : legacy.tray.remove(d.snapshotId)
                    }
                  >
                    移除此快照
                  </button>
                </p>
              ))}
            </details>
          )}
        </section>
        <section className="note-preview">
          <h2>所选内容预览</h2>
          {!pack ? (
            <p>勾选记录并生成预览后，可以核对和下载。</p>
          ) : (
            <>
              {pack.entries.map((entry) => (
                <article className="note-preview-entry" key={entry.id}>
                  <h3>{entry.title}</h3>
                  <p className="muted">
                    {noteKinds[entry.kind]} · {entry.date} ·{' '}
                    {entry.language === 'cpp' ? 'C++' : 'C'}
                  </p>
                  <p>{entry.text}</p>
                  {entry.reference && (
                    <p>
                      教材：{entry.reference.document} · 书页 {entry.reference.physicalPage}
                    </p>
                  )}
                  {entry.href && (
                    <Link className="text-link" to={entry.href}>
                      打开来源
                    </Link>
                  )}
                  <details>
                    <summary>版本与来源引用</summary>
                    <pre>
                      {JSON.stringify(
                        { origin: entry.origin, reference: entry.reference },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                  {entry.source && (
                    <>
                      <h4>当前已保存草稿</h4>
                      <pre className="c6-source-read">
                        <code>{entry.source.text}</code>
                      </pre>
                      <h4>当前已保存输入</h4>
                      <pre className="c6-source-read">
                        <code>{entry.source.input}</code>
                      </pre>
                    </>
                  )}
                  {entry.snapshot && (
                    <>
                      <h4>捕获时的完整源码</h4>
                      <SnapshotSource snapshot={entry.snapshot} />
                      {entry.snapshot.formatVersion === '2.0.0' ? (
                        <C6SnapshotPreview record={entry.snapshot} />
                      ) : (
                        <SnapshotPreview document={entry.snapshot} />
                      )}
                      <details>
                        <summary>完整捕获输入和状态 JSON</summary>
                        <pre className="c6-source-read">
                          {JSON.stringify(entry.snapshot, null, 2)}
                        </pre>
                      </details>
                    </>
                  )}
                </article>
              ))}
              <Download pack={pack} stamp={stamp} />
            </>
          )}
        </section>
      </div>
    </>
  );
}
