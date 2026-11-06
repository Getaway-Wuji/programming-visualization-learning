import { useLayoutEffect, useRef, useState } from 'react';
import { useLearning } from '../learning/react';
import type { PythonPacket, PythonResponse } from '../engine/python3-types';
import { currentPythonExecution } from '../engine/python3-client';
import { downloadSnapshot } from '../snapshot-export/browser';
import { capturePythonSnapshot, preparePythonSnapshot } from './snapshot';

type Format = 'json' | 'png' | 'md' | 'zip';
export function PythonSnapshotPanel({
  packet,
  response,
  cursor,
  caseIndex,
  origin,
  isCurrent,
  onPreview,
}: {
  packet: PythonPacket;
  response: PythonResponse;
  cursor: number;
  caseIndex: number;
  origin: Parameters<typeof capturePythonSnapshot>[4];
  isCurrent: () => boolean;
  onPreview: (value: boolean) => void;
}) {
  const { state, service } = useLearning();
  const [snapshot, setSnapshot] = useState<ReturnType<typeof capturePythonSnapshot>>();
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => () => active.current?.abort(), []);
  function preview() {
    try {
      if (!isCurrent()) throw Error('SNAPSHOT_STALE');
      setSnapshot(capturePythonSnapshot(response, packet, caseIndex, cursor, origin));
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
        !currentPythonExecution(response) ||
        current.sessionEpoch !== epoch ||
        current.snapshot?.meta.generation !== generation ||
        current.snapshot.meta.revision !== revision
      )
        throw Error('SNAPSHOT_STALE');
    };
    try {
      const blob = await preparePythonSnapshot(snapshot, format, controller.signal, check);
      await service.withSavedNotesRevision({ generation, revision, epoch }, () => {
        check();
        downloadSnapshot(
          blob,
          'Python-第' + cursor + '步-' + snapshot.snapshotId.slice(0, 8) + '.' + format,
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
        aria-label="Python 快照预览"
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
            <p>文件包含本次源码、实际输入和该步骤的变量、列表及输出。</p>
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
