import { useLayoutEffect, useRef, useState } from 'react';
import { useLearning } from '../learning/react';
import type { JavaPacket, JavaResponse } from '../engine/java-types';
import { currentJavaExecution } from '../engine/java-client';
import { downloadSnapshot } from '../snapshot-export/browser';
import { captureJavaSnapshot, prepareJavaSnapshot } from './snapshot';

type Format = 'json' | 'png' | 'md' | 'zip';
export function JavaSnapshotPanel({
  packet,
  response,
  cursor,
  caseIndex,
  origin,
  isCurrent,
  onPreview,
}: {
  packet: JavaPacket;
  response: JavaResponse;
  cursor: number;
  caseIndex: number;
  origin: Parameters<typeof captureJavaSnapshot>[4];
  isCurrent: () => boolean;
  onPreview: (value: boolean) => void;
}) {
  const { state, service } = useLearning();
  const [snapshot, setSnapshot] = useState<ReturnType<typeof captureJavaSnapshot>>();
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => () => active.current?.abort(), []);
  function preview() {
    try {
      if (!isCurrent()) throw Error('SNAPSHOT_STALE');
      setSnapshot(captureJavaSnapshot(response, packet, caseIndex, cursor, origin));
      setFailed(false);
      setStatus('');
      onPreview(true);
      dialog.current?.showModal();
    } catch {
      setFailed(true);
      setStatus('当前观察已失效，请重新运行。');
    }
  }
  async function save(format: Format) {
    if (!snapshot || !state.snapshot) return;
    const { generation, revision } = state.snapshot.meta;
    const epoch = state.sessionEpoch;
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    const timer = setTimeout(() => controller.abort(), 5000);
    setPending(true);
    setFailed(false);
    setStatus('');
    const check = () => {
      controller.signal.throwIfAborted();
      const current = service.getState();
      if (
        !isCurrent() ||
        !currentJavaExecution(response) ||
        current.sessionEpoch !== epoch ||
        current.snapshot?.meta.generation !== generation ||
        current.snapshot.meta.revision !== revision
      )
        throw Error('SNAPSHOT_STALE');
    };
    try {
      const blob = await prepareJavaSnapshot(snapshot, format, controller.signal, check);
      await service.withSavedNotesRevision({ generation, revision, epoch }, () => {
        check();
        downloadSnapshot(
          blob,
          'Java-第' + cursor + '步-' + snapshot.snapshotId.slice(0, 8) + '.' + format,
        );
      });
      setStatus('已交给浏览器下载。');
    } catch {
      setFailed(true);
      setStatus('文件未下载。当前档案或观察已变化，或超出文件额度。');
    } finally {
      clearTimeout(timer);
      if (active.current === controller) setPending(false);
    }
  }
  return (
    <section className="python-sheet">
      <h2>当前观察</h2>
      <button type="button" onClick={preview}>
        预览当前快照
      </button>
      {!snapshot && status && <p role="alert">{status}</p>}
      <dialog
        ref={dialog}
        aria-label="Java 快照预览"
        className="python-snapshot"
        onClose={() => {
          active.current?.abort();
          onPreview(false);
          setPending(false);
        }}
      >
        {snapshot && (
          <>
            <h2>第 {snapshot.position.cursor} 步快照</h2>
            <p>文件包含本次源码、实际输入和该步骤的变量、对象及输出。</p>
            <pre aria-label="快照当前输出">{snapshot.currentState.output || '（当前无输出）'}</pre>
            {snapshot.origin.sourceUrl && (
              <p>
                <a href={snapshot.origin.sourceUrl} rel="noreferrer">
                  来源引用
                </a>
              </p>
            )}
            <div className="python-actions">
              {(['json', 'png', 'md', 'zip'] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  disabled={pending || state.status !== 'ready'}
                  onClick={() => void save(format)}
                >
                  下载 {format.toUpperCase()}
                </button>
              ))}
              <button type="button" onClick={() => dialog.current?.close()}>
                关闭预览
              </button>
            </div>
            {status && <p role={failed ? 'alert' : 'status'}>{status}</p>}
          </>
        )}
      </dialog>
    </section>
  );
}
