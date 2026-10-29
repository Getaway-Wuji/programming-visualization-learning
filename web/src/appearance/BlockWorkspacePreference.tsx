import { useId, useRef, useState } from 'react';
import { useLearning } from '../learning/react';
import { defaultAppearance, type Appearance } from '../storage/model';
import './block-workspace-preference.css';

export type BlockWorkspaceChoice = Appearance['blockWorkspace'];
type PreferenceDraft = {
  value: BlockWorkspaceChoice;
  revision: number;
  generation: string;
  epoch: number;
};

/** A display choice is independent of the current exercise document or execution. */
export function useBlockWorkspacePreference() {
  const { state, service } = useLearning();
  const [draft, setDraft] = useState<PreferenceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmation, setConfirmation] = useState<PreferenceDraft | null>(null);
  const pending = useRef(false);
  const active =
    draft?.generation === state.snapshot?.meta.generation && draft?.epoch === state.sessionEpoch
      ? draft
      : null;
  const value =
    active?.value ??
    state.snapshot?.appearance.blockWorkspace ??
    defaultAppearance().blockWorkspace;
  const disabled =
    saving ||
    state.status === 'saving' ||
    state.status === 'loading' ||
    !state.snapshot ||
    state.status === 'readonly' ||
    state.appearanceReadOnly === true ||
    state.recovery?.writable === false;

  async function commit(submitted: PreferenceDraft) {
    const current = service.getState();
    if (
      !current.snapshot ||
      current.sessionEpoch !== submitted.epoch ||
      current.snapshot.meta.generation !== submitted.generation ||
      pending.current
    )
      return;
    pending.current = true;
    setSaving(true);
    setConfirmation(null);
    try {
      // Capture only the intended field. Neither a theme preview nor an earlier
      // full appearance row may overwrite the current saved preferences.
      await service.saveAppearance(
        { ...current.snapshot.appearance, blockWorkspace: submitted.value },
        submitted.revision,
      );
      const result = service.getState();
      if (
        result.sessionEpoch !== submitted.epoch ||
        result.snapshot?.meta.generation !== submitted.generation
      )
        return;
      if (
        result.status === 'ready' &&
        result.lastSaved &&
        result.snapshot.appearance.blockWorkspace === submitted.value
      ) {
        setDraft((previous) => (previous === submitted ? null : previous));
        setFailed(false);
        setConfirmation(submitted);
      } else setFailed(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  async function choose(next: BlockWorkspaceChoice) {
    if (disabled || pending.current || !state.snapshot) return;
    const submitted: PreferenceDraft = {
      value: next,
      revision: active?.revision ?? state.snapshot.meta.revision,
      generation: state.snapshot.meta.generation,
      epoch: state.sessionEpoch,
    };
    setDraft(submitted);
    setConfirmation(null);
    // A failed write remains a temporary choice until an explicit retry.
    if (!active || !failed) await commit(submitted);
  }

  async function retry() {
    if (!active || disabled || pending.current) return;
    const previous = active;
    pending.current = true;
    setSaving(true);
    try {
      await service.refresh();
    } finally {
      pending.current = false;
      setSaving(false);
    }
    const current = service.getState();
    if (
      current.status !== 'ready' ||
      !current.snapshot ||
      current.sessionEpoch !== previous.epoch ||
      current.snapshot.meta.generation !== previous.generation
    )
      return;
    const submitted = { ...previous, revision: current.snapshot.meta.revision };
    setDraft(submitted);
    await commit(submitted);
  }

  function discard() {
    if (pending.current) return;
    setDraft(null);
    setFailed(false);
    setConfirmation(null);
    void service.refresh();
  }

  return {
    value,
    choose,
    saving,
    failed: !!active && failed,
    dirty: !!active,
    disabled,
    confirmed:
      !active &&
      confirmation?.generation === state.snapshot?.meta.generation &&
      confirmation?.epoch === state.sessionEpoch &&
      confirmation?.value === state.snapshot?.appearance.blockWorkspace,
    errorCode: state.appearanceError ?? state.errorCode,
    retry,
    discard,
  };
}

export function BlockWorkspacePreference({
  control,
  recommendation,
}: {
  control: ReturnType<typeof useBlockWorkspacePreference>;
  recommendation?: 'code' | 'blocks';
}) {
  const id = useId();
  const status = control.saving
    ? 'saving'
    : control.dirty
      ? 'temporary'
      : control.confirmed
        ? 'saved'
        : 'ready';
  return (
    <section className="block-workspace-preference" data-testid="block-workspace-preference">
      <div className="block-preference-heading">
        <label htmlFor={id}>积木显示</label>
        <select
          id={id}
          aria-label="积木显示"
          aria-describedby={`${id}-description ${id}-status`}
          value={control.value}
          disabled={control.disabled}
          onChange={(event) => void control.choose(event.target.value as BlockWorkspaceChoice)}
        >
          <option value="auto">自动（按课程推荐）</option>
          <option value="show">始终显示</option>
          <option value="hide">隐藏</option>
        </select>
      </div>
      <p id={`${id}-description`} className="muted">
        {recommendation
          ? `本节推荐${recommendation === 'blocks' ? '显示积木' : '代码作答'}。`
          : '自动会跟随当前课程推荐。'}
        隐藏积木后仍可写代码、运行和提交；切换显示不会修改解答。
      </p>
      <p
        id={`${id}-status`}
        data-testid="block-preference-save-status"
        data-save-state={status}
        role={control.failed ? 'alert' : 'status'}
      >
        {control.saving
          ? '正在保存积木显示偏好……'
          : control.failed
            ? control.errorCode === 'S_REVISION_CONFLICT'
              ? '其他页面已更新档案，这次选择仅临时使用，尚未保存。'
              : control.errorCode === 'S_QUOTA'
                ? '浏览器存储空间不足，这次选择仅临时使用，尚未保存。'
                : '这次选择仅临时使用，尚未保存。恢复存储后可以重试。'
            : control.dirty
              ? '这次选择仅临时使用，尚未保存。'
              : control.confirmed
                ? '积木显示偏好已保存到当前浏览器。'
                : '正在使用当前浏览器的积木显示偏好。'}
      </p>
      {control.failed && (
        <div className="inline-actions block-preference-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={control.disabled}
            onClick={() => void control.retry()}
          >
            重新读取并保存选择
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={control.saving}
            onClick={control.discard}
          >
            采用已保存选择
          </button>
        </div>
      )}
    </section>
  );
}

export function SavedBlockWorkspacePreference() {
  const control = useBlockWorkspacePreference();
  return <BlockWorkspacePreference control={control} />;
}
