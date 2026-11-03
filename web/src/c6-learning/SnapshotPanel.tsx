import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useLearning } from '../learning/react';
import { useC6NoteSnapshots } from '../study-notes/session';
import { downloadSnapshot, waitFor } from '../snapshot-export/browser';
import { SNAPSHOT_LIMITS, SnapshotError } from '../snapshot-export/types';
import {
  captureC6Snapshot,
  c6SnapshotKey,
  encodeC6Snapshot,
  type C6SnapshotCapture,
} from './snapshot';
import { renderC6SnapshotPng } from './snapshot-picture';

export function C6SnapshotPanel({
  capture,
  disabled,
}: {
  capture: C6SnapshotCapture;
  disabled: boolean;
}) {
  const { state, service } = useLearning();
  const { tray } = useC6NoteSnapshots();
  const [status, setStatus] = useState({ busy: false, text: '', failed: false });
  const operation = useRef<AbortController | null>(null);
  const key = c6SnapshotKey(capture);
  const latest = useRef({
    key,
    generation: state.snapshot?.meta.generation,
    epoch: state.sessionEpoch,
  });
  useLayoutEffect(() => {
    latest.current = {
      key,
      generation: state.snapshot?.meta.generation,
      epoch: state.sessionEpoch,
    };
  }, [key, state.snapshot?.meta.generation, state.sessionEpoch]);
  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    [key, state.sessionEpoch, state.snapshot?.meta.generation],
  );
  const start = async (format: 'json' | 'png' | 'note') => {
    operation.current?.abort();
    const abort = new AbortController();
    operation.current = abort;
    const started = performance.now(),
      snapshot = state.snapshot;
    const stamp = snapshot
      ? {
          generation: snapshot.meta.generation,
          revision: snapshot.meta.revision,
          epoch: state.sessionEpoch,
        }
      : null;
    const timer = setTimeout(() => abort.abort(), SNAPSHOT_LIMITS.timeoutMs);
    const check = () => {
      if (performance.now() - started >= SNAPSHOT_LIMITS.timeoutMs)
        throw new SnapshotError('SNAPSHOT_TIMEOUT');
      if (operation.current !== abort || abort.signal.aborted)
        throw new SnapshotError('SNAPSHOT_CANCELLED');
      if (
        !stamp ||
        latest.current.key !== key ||
        latest.current.generation !== stamp.generation ||
        latest.current.epoch !== stamp.epoch
      )
        throw new SnapshotError('SNAPSHOT_CHANGED');
    };
    setStatus({ busy: true, text: '正在生成完整当前状态……', failed: false });
    try {
      check();
      const document = await captureC6Snapshot(capture, state.c6!.index!, check);
      const json = encodeC6Snapshot(document);
      const blob =
        format === 'png'
          ? await renderC6SnapshotPng(document, json, abort.signal, check)
          : new Blob([json], { type: 'application/json' });
      check();
      await waitFor(
        service.withSavedNotesRevision(stamp!, () => {
          check();
          if (format === 'note') tray.add(document);
          else
            downloadSnapshot(
              blob,
              `c6-snapshot-${document.capturedAt.replace(/[:.]/gu, '-')}-${document.snapshotId.slice(0, 8)}.${format}`,
            );
        }),
        abort.signal,
      );
      check();
      setStatus({
        busy: false,
        text:
          format === 'note' ? '当前快照已加入本次笔记。' : '已发起下载，请在浏览器下载列表确认。',
        failed: false,
      });
    } catch (error) {
      if (operation.current === abort)
        setStatus({
          busy: false,
          failed: !abort.signal.aborted,
          text:
            error instanceof SnapshotError &&
            (error.code === 'SNAPSHOT_PICTURE_LIMIT' || error.code === 'SNAPSHOT_TOO_LARGE')
              ? '完整快照超过当前上限，本次没有截断或发起下载。图片超限时可单独尝试 JSON。'
              : abort.signal.aborted
                ? '本次生成已取消或超时，未发起下载。'
                : '状态已变化或生成未完成，请在当前步骤重试。',
        });
    } finally {
      clearTimeout(timer);
      if (operation.current === abort) operation.current = null;
    }
  };
  return (
    <section className="snapshot-export" aria-label="C6 当前快照导出">
      <h3>保存当前快照</h3>
      <p>包含完整源码、实际输入和当前游标的完整状态。图片不受界面分页影响，JSON 不包含整条轨迹。</p>
      <div className="c6-action-row">
        <button
          className="button button-secondary"
          disabled={disabled || status.busy || !state.snapshot}
          onClick={() => void start('json')}
        >
          下载状态文件（JSON）
        </button>
        <button
          className="button button-secondary"
          disabled={disabled || status.busy || !state.snapshot}
          onClick={() => void start('png')}
        >
          下载快照图片（PNG）
        </button>
        <button
          className="button button-secondary"
          disabled={disabled || status.busy || !state.snapshot}
          onClick={() => void start('note')}
        >
          加入本次笔记
        </button>
        {status.busy && (
          <button className="button button-secondary" onClick={() => operation.current?.abort()}>
            取消导出
          </button>
        )}
        <Link className="text-link" to="/study-notes">
          查看学习笔记
        </Link>
      </div>
      {status.text && <p role={status.failed ? 'alert' : 'status'}>{status.text}</p>}
    </section>
  );
}
