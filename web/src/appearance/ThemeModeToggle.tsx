import { useRef, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { useLearning } from '../learning/react';
import { useAppearance } from './react';
import { revealTheme } from './theme-reveal';
import './theme-reveal.css';

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
  const toggle = async (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled || !snapshot || pending.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const origin =
      event.detail === 0
        ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
        : { x: event.clientX, y: event.clientY };
    setFailed(false);
    const theme = dark ? 'light' : 'dark';
    pending.current = true;
    setSaving(true);
    const epoch = state.sessionEpoch;
    const sameSession = () => {
      const current = service.getState();
      return (
        current.sessionEpoch === epoch &&
        current.snapshot?.meta.generation === snapshot.meta.generation
      );
    };
    try {
      await revealTheme(theme, origin, async () => {
        if (!sameSession()) return false;
        if (appearance.draft) {
          flushSync(() => appearance.edit({ mode: theme }));
          return true;
        }
        const latest = service.getState().snapshot;
        if (!latest) return false;
        await service.saveDisplay(
          {
            theme,
            reducedMotion: latest.settings.reducedMotion,
            playbackRate: latest.settings.playbackRate,
          },
          latest.meta.revision,
        );
        if (!sameSession()) return false;
        const current = service.getState();
        const saved =
          current.lastSaved &&
          current.status === 'ready' &&
          current.snapshot?.settings.theme === theme;
        // Commit the confirmed storage update into the new view-transition snapshot.
        flushSync(() => {
          setFailed(!saved);
          setSaving(false);
        });
        return saved;
      });
    } catch {
      if (sameSession()) setFailed(true);
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
        onClick={(event) => void toggle(event)}
      >
        <span className="theme-mode-symbols" aria-hidden="true">
          <Icon name="moon" className="theme-mode-moon" />
          <Icon name="sun" className="theme-mode-sun" />
        </span>
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
