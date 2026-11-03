import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Breadcrumbs, PageHeading, StatePanel } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import type { Avatar, Settings } from '../storage/model';
import { AvatarPicture } from '../learning/profile-components';
import { AppearanceSettings } from '../appearance/AppearanceSettings';
import { SavedBlockWorkspacePreference } from '../appearance/BlockWorkspacePreference';
import { AiSettings } from '../ai-debug/Settings';

const tabs = [
  { id: 'appearance', label: '外观与主题' },
  { id: 'avatar', label: '基础形象' },
  { id: 'display', label: '显示设置' },
  { id: 'ai', label: 'AI解释（可选）' },
  { id: 'data', label: '本地数据' },
] as const;

type LocalAction = 'clear' | 'settings' | 'avatar';

function LocalDataConfirmation({
  action,
  allowed,
  cancel,
  confirm,
}: {
  action: LocalAction;
  allowed: boolean;
  cancel: () => void;
  confirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const details = {
    clear: {
      title: '确认清除本地数据',
      description:
        '这会清除当前浏览器中的学习进度、练习记录、积分账本及防重记录、每日目标与打卡、形象、显示设置、外观偏好与背景资源、编辑历史、C工作台草稿与薄弱点依据，以及当前临时内容与待保存操作。清除后无法在本平台找回这些记录。',
      button: '确认清除',
    },
    settings: {
      title: '确认重置显示设置',
      description:
        '明暗模式、动画效果、默认播放速度和后续日期目标模板会恢复默认。已记录的每日目标、学习进度、积分账本、形象和六套主题配色保持不变。',
      button: '确认重置显示设置',
    },
    avatar: {
      title: '确认重置基础形象',
      description: '基础形象与强调色会恢复默认。学习进度、积分账本、目标和显示设置保持不变。',
      button: '确认重置基础形象',
    },
  }[action];
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="local-action-title"
      aria-describedby="local-action-description"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div className="modal-header">
        <h2 id="local-action-title">{details.title}</h2>
      </div>
      <div className="modal-body">
        <p id="local-action-description" className="notice">
          {details.description}
        </p>
        <div className="inline-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button-secondary"
            onClick={cancel}
          >
            取消
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={!allowed}
            onClick={confirm}
          >
            {details.button}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default function SettingsPage() {
  const { state } = useLearning();
  return <SettingsContent key={state.sessionEpoch} />;
}

function SettingsContent() {
  const [search, setSearch] = useSearchParams();
  const selected = tabs.find((tab) => tab.id === search.get('panel'))?.id ?? 'appearance';
  const { state, service } = useLearning();
  const [confirmation, setConfirmation] = useState<LocalAction | null>(null);
  const [displayDraft, setDisplayDraft] = useState<{
    value: Pick<Settings, 'theme' | 'reducedMotion' | 'playbackRate'>;
    revision: number;
    generation: string;
    epoch: number;
  } | null>(null);
  const [avatarDraft, setAvatarDraft] = useState<{
    value: Avatar;
    revision: number;
    generation: string;
    epoch: number;
  } | null>(null);
  const snapshot = state.snapshot;
  const display = displayDraft?.value ?? snapshot?.settings;
  const avatar = avatarDraft?.value ?? snapshot?.avatar;
  const avatarChoices = state.profileConfiguration?.avatars ?? [
    { presetId: 'avatar.basic.01', label: '嫩叶', shapeId: 'leaf' as const },
  ];
  const avatarColorValid = !!avatar && /^#[0-9A-Fa-f]{6}$/.test(avatar.accentColor);
  const busy = state.status === 'loading' || state.status === 'saving';
  const writable =
    !!snapshot && !busy && state.status !== 'readonly' && state.recovery?.writable !== false;
  const canClear = state.recovery?.canClear === true && !busy;
  const resettable = state.recovery?.resettable ?? [];
  const confirmAction = () => {
    const action = confirmation;
    setConfirmation(null);
    if (action === 'clear' && canClear) {
      setDisplayDraft(null);
      setAvatarDraft(null);
      void service.clearLocalData();
    } else if (
      (action === 'settings' || action === 'avatar') &&
      resettable.includes(action) &&
      !busy
    ) {
      const previousDisplay = displayDraft;
      const previousAvatar = avatarDraft;
      void service.resetLocalPreference(action).then(() => {
        if (!service.getState().lastSaved) return;
        if (action === 'settings')
          setDisplayDraft((current) => (current === previousDisplay ? null : current));
        else setAvatarDraft((current) => (current === previousAvatar ? null : current));
      });
    }
  };
  const refresh = async () => {
    const generation = snapshot?.meta.generation;
    const epoch = state.sessionEpoch;
    const previousDisplay = displayDraft;
    const previousAvatar = avatarDraft;
    await service.refresh();
    const current = service.getState();
    if (
      current.status === 'ready' &&
      current.snapshot?.meta.generation === generation &&
      current.sessionEpoch === epoch
    ) {
      setDisplayDraft((draft) => (draft === previousDisplay ? null : draft));
      setAvatarDraft((draft) => (draft === previousAvatar ? null : draft));
    }
  };
  const editAvatar = (value: Avatar) => {
    if (!snapshot) return;
    setAvatarDraft({
      value,
      revision: avatarDraft?.revision ?? snapshot.meta.revision,
      generation: avatarDraft?.generation ?? snapshot.meta.generation,
      epoch: avatarDraft?.epoch ?? state.sessionEpoch,
    });
  };
  const editDisplay = <K extends 'theme' | 'reducedMotion' | 'playbackRate'>(
    key: K,
    value: Settings[K],
  ) => {
    if (!snapshot || !display) return;
    setDisplayDraft({
      value: {
        theme: display.theme,
        reducedMotion: display.reducedMotion,
        playbackRate: display.playbackRate,
        [key]: value,
      },
      revision: displayDraft?.revision ?? snapshot.meta.revision,
      generation: displayDraft?.generation ?? snapshot.meta.generation,
      epoch: displayDraft?.epoch ?? state.sessionEpoch,
    });
  };
  return (
    <div data-page-id="PAGE-07">
      <Breadcrumbs items={[{ label: '学习首页', to: '/' }, { label: '本地设置' }]} />
      <PageHeading
        kicker="你的浏览器，你的学习空间"
        title="本地设置"
        description="学习档案保存在当前浏览器，不跨设备同步。存储不可用时仅临时使用，未保存内容会在关闭或刷新后丢失。"
      />
      <LearningSaveStatus
        onRefresh={() => void refresh()}
        dirty={displayDraft !== null || avatarDraft !== null}
      />
      <div className="settings-layout">
        <div className="settings-nav" role="tablist" aria-label="设置分类">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={selected === tab.id}
              aria-controls="settings-panel"
              tabIndex={selected === tab.id ? 0 : -1}
              className={`settings-tab${selected === tab.id ? ' active' : ''}`}
              onClick={() => setSearch({ panel: tab.id })}
              onKeyDown={(event) => {
                const directions: Record<string, number> = {
                  ArrowLeft: -1,
                  ArrowUp: -1,
                  ArrowRight: 1,
                  ArrowDown: 1,
                };
                const delta = directions[event.key];
                let target: number;
                if (delta !== undefined) {
                  target = (index + delta + tabs.length) % tabs.length;
                } else if (event.key === 'Home') {
                  target = 0;
                } else if (event.key === 'End') {
                  target = tabs.length - 1;
                } else {
                  return;
                }
                event.preventDefault();
                setSearch({ panel: tabs[target].id });
                document.getElementById(`tab-${tabs[target].id}`)?.focus();
              }}
            >
              {tab.label}
              <Icon name="chevron" />
            </button>
          ))}
        </div>
        <section
          className="card settings-panel"
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`tab-${selected}`}
          tabIndex={0}
        >
          {selected === 'appearance' && <AppearanceSettings />}
          {selected === 'avatar' && (
            <>
              <h2>基础形象</h2>
              <div className="profile-avatar-standalone">
                {avatar && (
                  <AvatarPicture
                    avatar={avatar}
                    configuration={state.profileConfiguration}
                    testId="avatar-preview"
                    label={avatarDraft ? '基础形象更改预览，尚未保存' : '当前基础形象'}
                  />
                )}
              </div>
              <p className="muted">
                选择一个基础图案和喜欢的强调色。保存后会显示在学习首页，无需账号。
              </p>
              {state.profileStatus === 'failed' && (
                <p className="notice">
                  形象配置暂不可用，当前只可选择默认嫩叶。已有形象记录保留。
                  <button
                    type="button"
                    className="text-link profile-retry"
                    onClick={() => void service.reloadProfileConfiguration()}
                  >
                    重试形象与等级规则
                  </button>
                </p>
              )}
              {avatar && !avatarChoices.some((item) => item.presetId === avatar.presetId) && (
                <p className="notice">
                  已保存的形象资源暂不可用，原选择和强调色已保留。你可以重试配置，或明确选择一个可用形象后保存。
                </p>
              )}
              {resettable.includes('avatar') && (
                <p className="notice">
                  形象记录损坏，当前使用临时默认形象，尚未覆盖原记录。请在本地数据中确认重置。
                </p>
              )}
              {avatar && snapshot ? (
                <form
                  className="settings-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (
                      !avatarDraft ||
                      !avatarColorValid ||
                      avatarDraft.generation !== snapshot.meta.generation ||
                      avatarDraft.epoch !== state.sessionEpoch
                    )
                      return;
                    const submitted = avatarDraft;
                    await service.saveAvatar(submitted.value, submitted.revision);
                    const current = service.getState();
                    if (
                      current.lastSaved &&
                      current.status === 'ready' &&
                      current.sessionEpoch === submitted.epoch &&
                      current.snapshot?.meta.generation === submitted.generation &&
                      current.snapshot.avatar.presetId === submitted.value.presetId &&
                      current.snapshot.avatar.accentColor === submitted.value.accentColor
                    ) {
                      setAvatarDraft((current) => (current === submitted ? null : current));
                    }
                  }}
                >
                  <fieldset
                    className="avatar-choice-group"
                    role="radiogroup"
                    aria-label="选择基础形象"
                    disabled={!writable}
                  >
                    <legend>选择基础形象</legend>
                    <div className="avatar-options">
                      {avatarChoices.map((item) => (
                        <label key={item.presetId}>
                          <AvatarPicture
                            avatar={{
                              presetId: item.presetId,
                              accentColor: avatarColorValid ? avatar.accentColor : '#168A72',
                            }}
                            configuration={state.profileConfiguration}
                            label={item.label}
                          />
                          <span>{item.label}</span>
                          <input
                            type="radio"
                            name="avatar-preset"
                            aria-label={item.label}
                            checked={avatar.presetId === item.presetId}
                            onChange={() => editAvatar({ ...avatar, presetId: item.presetId })}
                          />
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="settings-field">
                    <span>形象强调色</span>
                    <input
                      type="color"
                      value={avatarColorValid ? avatar.accentColor : '#168A72'}
                      disabled={!writable}
                      onChange={(event) =>
                        editAvatar({ ...avatar, accentColor: event.target.value.toUpperCase() })
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span>强调色十六进制</span>
                    <input
                      type="text"
                      aria-label="强调色十六进制"
                      pattern="#[0-9A-Fa-f]{6}"
                      maxLength={7}
                      required
                      value={avatar.accentColor}
                      disabled={!writable}
                      spellCheck={false}
                      onChange={(event) =>
                        editAvatar({ ...avatar, accentColor: event.target.value.toUpperCase() })
                      }
                    />
                  </label>
                  {!avatarColorValid && (
                    <p role="alert">请输入 # 加六位十六进制颜色，例如 #168A72。</p>
                  )}
                  <div className="inline-actions">
                    <button
                      className="button button-primary"
                      disabled={
                        !writable ||
                        !avatarColorValid ||
                        !avatarChoices.some((item) => item.presetId === avatar.presetId) ||
                        !avatarDraft ||
                        avatarDraft.generation !== snapshot.meta.generation ||
                        avatarDraft.epoch !== state.sessionEpoch
                      }
                    >
                      保存基础形象
                    </button>
                    {avatarDraft && (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => setAvatarDraft(null)}
                      >
                        {state.temporary || resettable.includes('avatar')
                          ? '放弃这次形象更改'
                          : '采用已保存形象'}
                      </button>
                    )}
                  </div>
                  {avatarDraft && <p className="muted">形象预览尚未保存。</p>}
                </form>
              ) : (
                <p className="muted">读取本地档案后可以调整基础形象。</p>
              )}
            </>
          )}
          {selected === 'display' && (
            <>
              <h2>显示设置</h2>
              <SavedBlockWorkspacePreference />
              {resettable.includes('settings') && (
                <p className="notice">
                  显示设置记录损坏，当前使用临时默认设置，尚未覆盖原记录。请在本地数据中确认重置。
                </p>
              )}
              {display && snapshot ? (
                <form
                  className="settings-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (
                      !displayDraft ||
                      displayDraft.generation !== snapshot.meta.generation ||
                      displayDraft.epoch !== state.sessionEpoch
                    )
                      return;
                    const submitted = displayDraft;
                    await service.saveDisplay(submitted.value, submitted.revision);
                    if (service.getState().lastSaved) {
                      setDisplayDraft((current) => (current === submitted ? null : current));
                    }
                  }}
                >
                  <label className="settings-field">
                    <span>主题</span>
                    <select
                      value={display.theme}
                      disabled={!writable}
                      onChange={(event) =>
                        editDisplay('theme', event.target.value as Settings['theme'])
                      }
                    >
                      <option value="system">跟随系统</option>
                      <option value="light">浅色</option>
                      <option value="dark">深色</option>
                    </select>
                  </label>
                  <label className="settings-field">
                    <span>动画效果</span>
                    <select
                      value={display.reducedMotion}
                      disabled={!writable}
                      onChange={(event) =>
                        editDisplay(
                          'reducedMotion',
                          event.target.value as Settings['reducedMotion'],
                        )
                      }
                    >
                      <option value="system">跟随系统</option>
                      <option value="on">减少动画</option>
                      <option value="off">允许动画</option>
                    </select>
                  </label>
                  <label className="settings-field">
                    <span>默认播放速度</span>
                    <select
                      value={display.playbackRate}
                      disabled={!writable}
                      onChange={(event) =>
                        editDisplay(
                          'playbackRate',
                          Number(event.target.value) as Settings['playbackRate'],
                        )
                      }
                    >
                      {[0.25, 0.5, 1, 1.5, 2, 4].map((rate) => (
                        <option key={rate} value={rate}>
                          {rate}×
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted">
                    {state.temporary
                      ? '临时设置只在本次页面中使用，关闭或刷新后丢失。'
                      : '保存后应用外观。'}
                    播放速度用于后续真实轨迹播放，不改变程序执行结果。
                  </p>
                  <div className="inline-actions">
                    <button
                      className="button button-primary"
                      disabled={
                        !writable ||
                        !displayDraft ||
                        displayDraft.generation !== snapshot.meta.generation ||
                        displayDraft.epoch !== state.sessionEpoch
                      }
                    >
                      保存显示设置
                    </button>
                    {displayDraft && (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => setDisplayDraft(null)}
                      >
                        {state.temporary || resettable.includes('settings')
                          ? '放弃这次设置更改'
                          : '采用已保存设置'}
                      </button>
                    )}
                  </div>
                  {displayDraft && <p className="muted">这次显示设置更改尚未保存。</p>}
                </form>
              ) : (
                <p className="muted">读取本地档案后可以调整显示设置。</p>
              )}
            </>
          )}
          {selected === 'ai' && <AiSettings />}
          {selected === 'data' && (
            <>
              <h2>本地数据与保存</h2>
              <StatePanel
                title={state.temporary ? '当前正在临时使用' : '学习档案保存在当前浏览器'}
                description={
                  state.temporary
                    ? '当前未保存的内容仅在本次页面中使用，关闭或刷新后会丢失；已保存的历史记录会保留。'
                    : '课程进度、真实通过记录、积分账本、每日目标、打卡和设置使用同一本地档案。'
                }
              />
              <dl className="info-list">
                <div className="info-item">
                  <dt>学习记录</dt>
                  <dd>进度、积分、目标、形象与设置保存在当前浏览器。</dd>
                </div>
                <div className="info-item">
                  <dt>保存边界</dt>
                  <dd>更换浏览器、域名或端口，或清除网站数据后，记录不能自动找回。</dd>
                </div>
                <div className="info-item">
                  <dt>代码处理</dt>
                  <dd>
                    代码由当前浏览器的 Rust/WASM
                    执行，不调用远程执行服务。静态资源加载仍需网络，不承诺完整离线。
                  </dd>
                </div>
              </dl>
              {!!state.recovery?.issues.length && (
                <section aria-labelledby="recovery-options-title">
                  <h3 id="recovery-options-title">数据恢复</h3>
                  <p className="notice">
                    原损坏记录仍保留在本地。合法记录可以查看，受影响的数据暂停保存；本平台不会自动删除记录或猜测补发积分。
                  </p>
                  <ul className="learning-history-list">
                    {state.recovery.issues.map((issue) => (
                      <li key={issue.store}>
                        {(
                          {
                            settings: '显示设置',
                            avatar: '基础形象',
                            progress: '学习进度',
                            dailyFacts: '每日学习记录',
                            goals: '每日目标',
                            ledger: '积分账本',
                            receipts: '保存确认记录',
                            aliases: '内容关联',
                            meta: '档案信息',
                            appearance: '外观偏好',
                            appearanceAssets: '外观资源',
                            course: '新课程记录',
                          } as Record<string, string>
                        )[issue.store] ?? '档案记录'}
                        ：{issue.count} 条记录需要处理
                      </li>
                    ))}
                  </ul>
                  {state.recovery.ledgerUncertain && (
                    <p className="notice">积分暂不可确认。不会跳过损坏账目显示一个更少的总分。</p>
                  )}
                  <div className="inline-actions">
                    {resettable.includes('settings') && (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => setConfirmation('settings')}
                      >
                        重置显示设置
                      </button>
                    )}
                    {resettable.includes('avatar') && (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => setConfirmation('avatar')}
                      >
                        重置基础形象
                      </button>
                    )}
                  </div>
                </section>
              )}
              <h3>清除本地数据</h3>
              <p className="notice">
                清除会移除学习进度、练习记录、积分账本及防重记录、每日目标与打卡、形象、显示设置和C工作台草稿与薄弱点依据，并丢弃当前临时内容与待保存操作。清除后无法在本平台找回。
              </p>
              {!canClear && !busy && (
                <p className="muted">
                  {state.errorCode === 'S_VERSION_UNKNOWN' ||
                  state.errorCode === 'S_MIGRATION_UNSUPPORTED'
                    ? '当前版本无法安全清除这份档案。请使用匹配版本，或前往浏览器设置中的网站数据管理。'
                    : '当前无法安全清除这份档案。请先恢复浏览器存储权限并重新读取；本页面不会自动删除原数据。'}
                </p>
              )}
              <button
                className="button button-secondary"
                disabled={!canClear}
                onClick={() => setConfirmation('clear')}
              >
                清除本地数据
              </button>
            </>
          )}
        </section>
      </div>
      {confirmation && (
        <LocalDataConfirmation
          action={confirmation}
          allowed={
            !busy && (confirmation === 'clear' ? canClear : resettable.includes(confirmation))
          }
          cancel={() => setConfirmation(null)}
          confirm={confirmAction}
        />
      )}
    </div>
  );
}
