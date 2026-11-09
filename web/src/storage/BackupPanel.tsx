import { useEffect, useRef, useState } from 'react';
import { useLearning } from '../learning/react';
import { downloadSnapshot } from '../snapshot-export/browser';
import type { PreparedBackup } from './backup';

function backupMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  if (code === 'S_REVISION_CONFLICT' || code === 'S_GENERATION_STALE')
    return '当前档案已变化。原数据未被覆盖，请重新选择备份并核对预览。';
  if (code === 'S_VERSION_UNKNOWN' || code === 'S_CONTENT_INCOMPATIBLE')
    return '这份备份的版本或课程与当前网站不兼容，未改动当前档案。';
  if (code === 'S_QUOTA') return '备份或存储空间超过可用范围，未覆盖当前档案。';
  return '无法读取这份完整备份，或浏览器存储暂不可用。当前档案未被覆盖，请核对文件后重试。';
}
function RestoreConfirmation({ cancel, confirm }: { cancel(): void; confirm(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const current = dialog.current;
    const opener = document.activeElement;
    current?.showModal();
    cancelButton.current?.focus();
    return () => {
      current?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="backup-confirm-title"
      aria-describedby="backup-confirm-detail"
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      <div className="modal-header">
        <h2 id="backup-confirm-title">确认覆盖当前学习档案</h2>
      </div>
      <div className="modal-body">
        <p id="backup-confirm-detail">
          这会用已预览的备份替换当前浏览器的六语言学习记录、奖励、草稿、笔记来源和外观设置。请先下载当前档案的备份；覆盖完成后不能撤销，期间未保存的编辑与临时快照会失效。
        </p>
        <div className="inline-actions">
          <button
            ref={cancelButton}
            type="button"
            className="button button-secondary"
            onClick={cancel}
          >
            取消恢复
          </button>
          <button type="button" className="button button-primary" onClick={confirm}>
            确认用此备份覆盖当前档案
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function BackupPanel() {
  const { service, state } = useLearning();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState(false);
  const [preview, setPreview] = useState<{
    backup: PreparedBackup;
    generation: string;
    revision: number;
  } | null>(null);
  const lifetime = useRef(0);
  useEffect(
    () => () => {
      lifetime.current++;
    },
    [],
  );
  const available =
    !!state.snapshot &&
    state.snapshot.meta.dbVersion === 15 &&
    state.status !== 'loading' &&
    state.status !== 'saving';
  const changed =
    !!preview &&
    (state.snapshot?.meta.generation !== preview.generation ||
      state.snapshot.meta.revision !== preview.revision);
  const exportFile = async () => {
    const token = lifetime.current;
    setBusy(true);
    setMessage('');
    try {
      const file = await service.exportLocalBackup();
      if (token !== lifetime.current) return;
      downloadSnapshot(file, `编程学习档案-${new Date().toISOString().slice(0, 10)}.json`);
      setMessage('完整备份已开始下载。请将文件保存到可靠的位置。');
    } catch (error) {
      if (token === lifetime.current) setMessage(backupMessage(error));
    } finally {
      if (token === lifetime.current) setBusy(false);
    }
  };
  const selectFile = async (file: File) => {
    const meta = state.snapshot?.meta;
    if (!meta) return;
    const token = lifetime.current;
    setBusy(true);
    setPreview(null);
    setMessage('');
    try {
      const backup = await service.prepareLocalBackup(file);
      if (token === lifetime.current)
        setPreview({ backup, generation: meta.generation, revision: meta.revision });
    } catch (error) {
      if (token === lifetime.current) setMessage(backupMessage(error));
    } finally {
      if (token === lifetime.current) setBusy(false);
    }
  };
  const restore = async () => {
    if (!preview || changed) return;
    setConfirmation(false);
    setBusy(true);
    try {
      await service.restoreLocalBackup(preview.backup, preview.generation, preview.revision);
    } catch (error) {
      setMessage(backupMessage(error));
      setBusy(false);
    }
  };
  const summary = preview?.backup.summary;
  return (
    <section aria-labelledby="local-backup-title">
      <h3 id="local-backup-title">完整档案备份与恢复</h3>
      <p>
        备份当前浏览器已保存的 C、Python、Java、C++、Rust、MySQL
        记录、全部草稿、积分与奖励防重记录、错题、复习、笔记来源、偏好和背景图片。文件仅在本机处理，不上传服务器，不含
        AI Key。
      </p>
      <p className="muted">
        未保存的编辑和本次临时快照不在档案中，请先保存草稿或单独导出快照。备份包含你的源码与学习记录，请妥善保管。
      </p>
      <div className="inline-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={!available || busy}
          onClick={() => void exportFile()}
        >
          下载完整档案备份
        </button>
        <label className="settings-field">
          <span>选择本地备份文件（JSON，最大 48 MiB）</span>
          <input
            type="file"
            accept=".json,application/json"
            disabled={!available || busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void selectFile(file);
            }}
          />
        </label>
      </div>
      {busy && <p role="status">正在处理本地档案，请稍候…</p>}
      {state.backupRestored &&
        state.status === 'ready' &&
        state.lastSaved &&
        !state.temporary &&
        !preview && (
          <p role="status">
            备份已恢复。六语言记录、草稿与偏好已重新读取，旧的运行和待保存操作已失效。
          </p>
        )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {summary && (
        <div aria-label="备份恢复预览">
          <h4>恢复前核对</h4>
          <dl className="info-list">
            <div className="info-item">
              <dt>备份时间</dt>
              <dd>{new Date(summary.createdAt).toLocaleString()}</dd>
            </div>
            <div className="info-item">
              <dt>学习记录</dt>
              <dd>
                已读 {summary.lessons} 节，通过 {summary.passedExercises} 题
              </dd>
            </div>
            <div className="info-item">
              <dt>积分与背景</dt>
              <dd>
                {summary.points} 积分 · {summary.background ? '包含背景图片' : '无背景图片'}
              </dd>
            </div>
            <div className="info-item">
              <dt>完整范围</dt>
              <dd>
                六种语言、{Object.keys(summary.storeCounts).length} 类存储，共 {summary.records}{' '}
                条记录
              </dd>
            </div>
          </dl>
          <p className="notice">恢复将覆盖当前档案，不会与现有记录合并。建议先下载当前档案备份。</p>
          {changed && <p role="alert">当前档案已变化，请重新选择备份文件以更新预览。</p>}
          <div className="inline-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={!available || busy || changed}
              onClick={() => setConfirmation(true)}
            >
              恢复这份备份…
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              取消导入
            </button>
          </div>
        </div>
      )}
      {confirmation && (
        <RestoreConfirmation cancel={() => setConfirmation(false)} confirm={() => void restore()} />
      )}
    </section>
  );
}
