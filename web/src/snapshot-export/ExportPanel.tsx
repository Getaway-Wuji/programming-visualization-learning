import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { SnapshotExporter } from './controller';
import type { SnapshotPort } from './types';
import { useNoteSnapshots } from '../study-notes/session';
import { Link } from 'react-router';
import './snapshot-export.css';
export function ExportPanel({ port, available }: { port: SnapshotPort; available: boolean }) {
  const { tray } = useNoteSnapshots();
  const subscribe = port.subscribe;
  const [exporter] = useState(() => new SnapshotExporter(port));
  const status = useSyncExternalStore(exporter.subscribe, exporter.getSnapshot);
  useLayoutEffect(() => {
    exporter.setPort(port);
  });
  useLayoutEffect(() => {
    const unsubscribe = subscribe(exporter.observe);
    return () => {
      unsubscribe();
      exporter.cancel();
    };
  }, [subscribe, exporter]);
  const busy = status.phase === 'capturing';
  return (
    <section
      className="snapshot-export"
      aria-label="当前快照导出"
      data-testid="snapshot-export"
      data-phase={status.phase}
    >
      <div className="snapshot-export-heading">
        <h4>保存当前快照</h4>
        <span>仅下载到你的设备</span>
      </div>
      <p>文件包含当前源码、输入和完整运行状态，请自行管理。PNG也附带同一状态数据，分享前请确认。</p>
      <div className="inline-actions">
        <button
          className="button button-small"
          disabled={!available || busy}
          onClick={() => void exporter.export('json')}
        >
          下载状态文件（JSON）
        </button>
        <button
          className="button button-small"
          disabled={!available || busy}
          onClick={() => void exporter.export('png')}
        >
          下载快照图片（PNG）
        </button>
        <button
          className="button button-small"
          disabled={!available || busy}
          onClick={() => void exporter.export('json', tray.add)}
        >
          加入本次笔记
        </button>
        <Link className="text-link" to="/study-notes">
          查看学习笔记
        </Link>
        {busy && (
          <button className="button button-small" onClick={exporter.cancel}>
            取消导出
          </button>
        )}
      </div>
      {!available && <p className="muted">运行结束并选择步骤后可导出。</p>}
      <details>
        <summary>文件包含范围</summary>
        <p>
          点击后先暂停，捕获完整当前状态，不受选中帧和分页影响。图片由同一状态重新排版，含源码、当前位置、对象与调用栈；不是整个网页截图。两种按钮各次独立捕获，不包含整条轨迹或学习档案，不上传。内容超限会明确拒绝，不截断。
        </p>
        <p>
          生成中切步、继续播放、更改输入或运行会取消；已发起的下载请到浏览器下载列表确认。已下载文件不随清除学习数据自动删除。
        </p>
      </details>
      {status.message && (
        <p
          role={status.phase === 'failed' ? 'alert' : 'status'}
          data-testid="snapshot-export-status"
        >
          {status.message}
        </p>
      )}
    </section>
  );
}
