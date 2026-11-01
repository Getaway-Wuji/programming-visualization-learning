import { useEffect, useState } from 'react';
import { renderSnapshotPng } from '../snapshot-export/browser';
import { encodeSnapshot } from '../snapshot-export/document';
import { SnapshotError, type SnapshotDocument } from '../snapshot-export/types';

export function SnapshotPreview({ document: record }: { document: SnapshotDocument }) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ attempt: number; url?: string; error?: boolean }>({
    attempt: 0,
  });
  useEffect(() => {
    if (!attempt) return;
    const abort = new AbortController();
    const check = () => {
      if (abort.signal.aborted) throw new SnapshotError('SNAPSHOT_CANCELLED');
    };
    const timer = setTimeout(() => abort.abort(), 5000);
    void renderSnapshotPng(record, encodeSnapshot(record), abort.signal, check)
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(Error('picture'));
            reader.readAsDataURL(blob);
          }),
      )
      .then((url) => {
        check();
        setStatus({ attempt, url });
      })
      .catch(() => {
        if (!disposed) setStatus({ attempt, error: true });
      })
      .finally(() => clearTimeout(timer));
    let disposed = false;
    return () => {
      disposed = true;
      clearTimeout(timer);
      abort.abort();
    };
  }, [attempt, record]);
  return (
    <div className="note-picture">
      <button
        className="button button-small"
        onClick={() => setAttempt((n) => n + 1)}
        disabled={attempt > 0 && status.attempt !== attempt}
      >
        {!attempt ? '预览完整状态图片' : status.error ? '重试状态图片' : '重新生成状态图片'}
      </button>
      {attempt > 0 && status.attempt !== attempt && (
        <p role="status">正在生成同一快照的完整状态图片…</p>
      )}
      {status.error && status.attempt === attempt && (
        <p role="alert">
          完整图片生成失败或超过5秒/尺寸预算，未截断状态；可重试或查看下面的完整状态数据。
        </p>
      )}
      {status.url && status.attempt === attempt && (
        <img
          src={status.url}
          alt={`${record.origin.title}，步骤${record.position.cursor}的完整状态排版`}
        />
      )}
    </div>
  );
}
