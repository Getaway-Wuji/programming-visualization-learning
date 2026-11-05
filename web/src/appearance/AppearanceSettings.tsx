import { useEffect, useRef, useState } from 'react';
import { useLearning } from '../learning/react';
import { THEME_IDS, type ThemeId } from '../storage/model';
import { useAppearance } from './react';

const labels: Record<ThemeId, string> = {
  minimal: '清爽 · 代码学园',
  cute: '粉晶 · 流体花园',
  glass: '珍珠 · 磨砂书桌',
  soft: '暖光 · 触感工坊',
  cool: '深蓝 · 流光空间',
  tech: '轻雾 · 灵感实验室',
};
const descriptions: Record<ThemeId, string> = {
  minimal: '清楚的纸面与课程层次',
  cute: '晶亮窗口与柔软回弹',
  glass: '珍珠磨砂与分层桌面',
  soft: '同色浮雕与按压触感',
  cool: '深蓝玻璃与局部流光',
  tech: '浅雾浮雕与安静轨道',
};
function ResetAppearanceDialog({ close }: { close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const { state, service } = useLearning();
  const { discard } = useAppearance();
  const [guard] = useState(() => ({
    revision: state.snapshot?.meta.revision,
    generation: state.snapshot?.meta.generation,
    epoch: state.sessionEpoch,
  }));
  const guardCurrent =
    guard.generation === state.snapshot?.meta.generation && guard.epoch === state.sessionEpoch;
  useEffect(() => {
    const opener = document.activeElement;
    ref.current?.showModal();
    cancel.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="appearance-reset-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-header">
        <h2 id="appearance-reset-title">恢复全部外观默认</h2>
      </div>
      <div className="modal-body">
        <p>将恢复清爽浅色、六套默认配色和默认布局。学习进度、积分与每日目标保留。</p>
        <div className="inline-actions">
          <button ref={cancel} className="button button-secondary" onClick={close}>
            取消
          </button>
          <button
            className="button button-primary"
            disabled={
              !state.snapshot ||
              !state.appearanceCanReset ||
              state.status === 'saving' ||
              !guardCurrent
            }
            onClick={async () => {
              const revision = guard.revision;
              if (revision === undefined || !guardCurrent) return;
              close();
              await service.resetAppearance(revision);
              if (service.getState().lastSaved) {
                discard();
              }
            }}
          >
            确认恢复全部外观
          </button>
        </div>
      </div>
    </dialog>
  );
}
export function AppearanceSettings() {
  const { state } = useLearning();
  const appearance = useAppearance();
  const [resetOpen, setResetOpen] = useState(false);
  const busy = state.status === 'loading' || state.status === 'saving';
  const writable =
    !!state.snapshot &&
    !busy &&
    state.status !== 'readonly' &&
    !state.appearanceReadOnly &&
    state.recovery?.writable !== false &&
    appearance.loaded?.status === 'ready';
  const id = appearance.appearance.preset;
  const choose = (themeId: ThemeId) => appearance.edit({ preset: themeId });
  return (
    <div className="appearance-settings" data-testid="appearance-settings">
      <div className="appearance-heading">
        <div>
          <h2>外观与主题</h2>
          <p className="muted">选择喜欢的界面风格，积木也会同步换肤。</p>
        </div>
        <span className="badge">
          {state.appearanceReadOnly
            ? '临时默认外观'
            : appearance.loaded?.status === 'fallback'
              ? '临时回退外观'
              : !state.snapshot
                ? '正在读取外观'
                : appearance.draft
                  ? '预览中，尚未保存'
                  : '当前已保存外观'}
        </span>
      </div>
      {appearance.loaded?.status === 'fallback' && (
        <div className="notice" role="alert">
          外观资源暂不可用，当前临时显示清爽界面。已保存的主题和颜色保留。
          <button
            type="button"
            className="text-link"
            onClick={() => void appearance.reloadConfiguration()}
          >
            重新加载主题资源
          </button>
        </div>
      )}
      {state.appearanceReadOnly && (
        <p className="notice" role="alert">
          外观记录需要修复，当前使用临时默认外观。学习档案保留，可以继续学习；恢复全部外观前不会覆盖原记录。
        </p>
      )}
      <div className="theme-options" role="group" aria-label="选择界面主题">
        {THEME_IDS.map((themeId) => (
          <button
            type="button"
            key={themeId}
            data-testid={`theme-${themeId}`}
            data-theme-choice={themeId}
            className={`theme-option mini-${themeId}`}
            aria-pressed={id === themeId}
            disabled={!writable}
            onClick={() => choose(themeId)}
          >
            <span className="theme-diagram" aria-hidden="true">
              <i />
              <b />
              <em />
            </span>
            <strong>{labels[themeId]}</strong>
            <small>{descriptions[themeId]}</small>
          </button>
        ))}
      </div>
      <div className="appearance-actions inline-actions">
        <button
          type="button"
          className="button button-primary"
          data-testid="save-appearance"
          disabled={!writable || !appearance.draft}
          onClick={() => void appearance.save()}
        >
          保存外观
        </button>
        {appearance.draft && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              appearance.discard();
            }}
          >
            采用已保存外观
          </button>
        )}
        <button
          type="button"
          className="text-link"
          disabled={!state.appearanceCanReset || busy}
          onClick={() => setResetOpen(true)}
        >
          恢复全部外观默认
        </button>
      </div>
      {appearance.draft && (
        <p className="muted" data-testid="appearance-unsaved">
          当前是临时预览，关闭或刷新会丢失未保存的外观更改。
        </p>
      )}
      {state.status === 'conflict' && appearance.draft && (
        <div className="notice" role="alert">
          其他页面已更新本地档案，本次外观未保存。
          <button type="button" className="text-link" onClick={() => void appearance.rebase()}>
            重新读取并保留这次选择
          </button>
          <p>重新读取后检查主题预览，再明确保存；不会自动覆盖其他页面的更改。</p>
        </div>
      )}
      {resetOpen && <ResetAppearanceDialog close={() => setResetOpen(false)} />}
    </div>
  );
}
