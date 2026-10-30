import { useState, useSyncExternalStore } from 'react';
import type { PracticeSession } from './session';
import './editor-history.css';

const time = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
const reasons = {
  initial: '练习起点',
  code: '代码编辑',
  blocks: '积木编辑',
  move: '积木布局',
  restore: '恢复历史',
};
const states = {
  pending: '待检查',
  synced: '已同步',
  invalid: '尚未完成',
  unmapped: '未映射',
  error: '检查未完成',
};
export function EditorHistory({ session, busy }: { session: PracticeSession; busy: boolean }) {
  const state = useSyncExternalStore(session.history.subscribe, session.history.getSnapshot);
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState(false);
  const chosen = state.items.find((item) => item.record.entryId === selected) ?? state.items[0];
  const caption =
    state.status === 'loading'
      ? '正在读取'
      : state.status === 'saving'
        ? '正在保存'
        : state.status === 'unavailable'
          ? '尚未保存'
          : state.status === 'unsaved'
            ? '有未保存内容'
            : `${state.items.filter((item) => item.saved).length} 条已保存`;
  return (
    <details
      className="editor-history"
      data-testid="editor-history"
      data-save-state={state.status}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>编辑历史 · {caption}</summary>
      {expanded && (
        <div className="editor-history-body">
          <p>
            当前题目与练习模式的编辑记录。全站保留最近100条、合计8
            MiB，超出后自动淘汰最旧记录。恢复会清除当前运行，并重新检查代码、积木和当前权限。
          </p>
          <label>
            历史版本
            <select
              aria-label="历史版本"
              value={chosen?.record.entryId ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {!chosen && <option value="">本题暂无历史版本</option>}
              {state.items.map((item) => (
                <option
                  key={item.record.entryId}
                  value={item.record.entryId}
                  data-reason={item.record.reason}
                  data-sync={item.record.state}
                  data-saved={item.saved ? 'yes' : 'no'}
                >
                  {time.format(new Date(item.record.createdAt))} · {reasons[item.record.reason]} ·
                  版本{item.record.documentRevision} · {states[item.record.state]} ·{' '}
                  {item.saved ? '已保存' : '未保存'}
                </option>
              ))}
            </select>
          </label>
          <div className="editor-history-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || !chosen}
              onClick={() => chosen && void session.restoreHistory(chosen.record.entryId)}
            >
              恢复所选版本
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void session.history.reload()}
            >
              重新读取编辑历史
            </button>
            {(state.status === 'unsaved' || state.status === 'unavailable') && (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => void session.history.retry()}
              >
                重试保存历史
              </button>
            )}
          </div>
          {chosen && (
            <>
              <p>历史状态：{states[chosen.record.state]}。恢复后以重新检查结果为准。</p>
              <pre aria-label="所选历史源码">{chosen.record.codeText}</pre>
            </>
          )}
          {state.message && <p role="status">{state.message}</p>}
          {state.pending > 0 && (
            <p role="status">还有 {state.pending} 条历史未保存；刷新或关闭页面可能丢失这些版本。</p>
          )}
          {state.pruned > 0 && (
            <p role="status">
              本次页面已按容量规则淘汰 {state.pruned} 条最旧历史，保留了较新的版本。
            </p>
          )}
        </div>
      )}
    </details>
  );
}
