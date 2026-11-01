import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLearning } from '../learning/react';
import type { NotesPackage } from './types';
import { NotesDownloader } from './download';
export function DownloadPanel({
  pack,
  stamp,
}: {
  pack: NotesPackage;
  stamp: { generation: string; revision: number; epoch: number };
}) {
  const { service } = useLearning();
  const [title, setTitle] = useState('学习笔记');
  const [downloader] = useState(() => new NotesDownloader());
  const status = useSyncExternalStore(downloader.subscribe, downloader.getSnapshot);
  const current = useRef({ pack, title, stamp });
  useLayoutEffect(() => {
    current.current = { pack, title, stamp };
    downloader.cancel('changed');
  }, [downloader, pack, title, stamp]);
  useLayoutEffect(() => () => downloader.cancel('changed'), [downloader]);
  return (
    <section
      className="note-download"
      aria-label="Markdown笔记下载"
      data-testid="notes-download"
      data-phase={status.phase}
    >
      <h3>下载 Markdown 笔记</h3>
      <label>
        笔记标题
        <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <p>
        只打包当前预览的 {pack.entries.length}{' '}
        条内容。ZIP包含Markdown及所选快照图片/状态，全程在浏览器内生成；请完整解压后打开“笔记.md”。
      </p>
      <div className="inline-actions">
        <button
          className="button"
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
          <button className="button" onClick={() => downloader.cancel()}>
            取消笔记打包
          </button>
        )}
      </div>
      <p className="muted">
        图片与状态包含源码和输入，分享前请核对。已下载文件由你管理，清档不会删除它们。
      </p>
      {status.message && (
        <p
          role={status.phase === 'failed' ? 'alert' : 'status'}
          data-testid="notes-download-status"
        >
          {status.message}
        </p>
      )}
    </section>
  );
}
