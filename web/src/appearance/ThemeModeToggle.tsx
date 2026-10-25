import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { useLearning } from '../learning/react';
import { useAppearance } from './react';

export function ThemeModeToggle() {
  const { state, service } = useLearning();
  const appearance = useAppearance();
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const snapshot = state.snapshot;
  const dark = appearance.resolvedMode === 'dark';
  const label = dark ? '切换为浅色' : '切换为深色';
  const disabled =
    saving ||
    !snapshot ||
    ['loading', 'saving', 'readonly', 'conflict'].includes(state.status) ||
    state.recovery?.writable === false ||
    state.recovery?.resettable.includes('settings');
  const toggle = async () => {
    if (disabled || !snapshot || pending.current) return;
    setFailed(false);
    const theme = dark ? 'light' : 'dark';
    if (appearance.draft) {
      appearance.edit({ mode: theme });
      return;
    }
    pending.current = true;
    setSaving(true);
    const epoch = state.sessionEpoch;
    try {
      await service.saveDisplay(
        {
          theme,
          reducedMotion: snapshot.settings.reducedMotion,
          playbackRate: snapshot.settings.playbackRate,
        },
        snapshot.meta.revision,
      );
      const current = service.getState();
      if (
        current.sessionEpoch === epoch &&
        current.snapshot?.meta.generation === snapshot.meta.generation
      )
        setFailed(
          !current.lastSaved ||
            current.status !== 'ready' ||
            current.snapshot.settings.theme !== theme,
        );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="button theme-mode-toggle"
        data-testid="theme-mode-toggle"
        aria-label={label}
        aria-pressed={dark}
        title={appearance.draft ? `${label}，随主题预览一同保存` : label}
        disabled={disabled}
        onClick={() => void toggle()}
      >
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
      {failed && (
        <span className="theme-mode-error notice" role="alert">
          明暗更改未保存。
          <Link to="/settings?panel=display">前往显示设置检查</Link>
        </span>
      )}
    </>
  );
}
