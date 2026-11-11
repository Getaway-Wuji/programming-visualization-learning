import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Icon } from '../components/Icon';
import { Breadcrumbs, PageHeading, StatePanel } from '../components/Ui';
import { LearningSaveStatus, useLearning } from '../learning/react';
import type { Settings } from '../storage/model';
import { AppearanceSettings } from '../appearance/AppearanceSettings';
import { SavedBlockWorkspacePreference } from '../appearance/BlockWorkspacePreference';
import { AiSettings } from '../ai-debug/Settings';
import { BackupPanel } from '../storage/BackupPanel';

const tabs = [
  { id: 'appearance', label: '外观与主题' },
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
        '这会清除当前浏览器中的学习进度、练习记录、积分账本及防重记录、每日目标与打卡、显示设置、外观偏好与背景资源、编辑历史、C、Python、Java、C++、Rust 和 MySQL 工作台草稿与薄弱点依据，包含 MySQL 草稿中的教学数据，以及当前临时内容与待保存操作。清除后无法在本平台找回这些记录。',
      button: '确认清除',
    },
    settings: {
      title: '确认重置显示设置',
      description:
        '明暗模式、动画效果、默认播放速度和后续日期目标模板会恢复默认。已记录的每日目标、学习进度、积分账本和六套主题配色保持不变。',
      button: '确认重置显示设置',
    },
    avatar: {
      title: '确认重置旧偏好',
      description: '恢复损坏的旧版偏好，保留学习记录、积分和当前显示设置。',
      button: '确认重置旧偏好',
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
  const snapshot = state.snapshot;
  const display = displayDraft?.value ?? snapshot?.settings;
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
      void service.clearLocalData();
    } else if (
      (action === 'settings' || action === 'avatar') &&
      resettable.includes(action) &&
      !busy
    ) {
      const previousDisplay = displayDraft;
      void service.resetLocalPreference(action).then(() => {
        if (action === 'settings' && service.getState().lastSaved)
          setDisplayDraft((current) => (current === previousDisplay ? null : current));
      });
    }
  };
  const refresh = async () => {
    const generation = snapshot?.meta.generation;
    const epoch = state.sessionEpoch;
    const previousDisplay = displayDraft;
    await service.refresh();
    const current = service.getState();
    if (
      current.status === 'ready' &&
      current.snapshot?.meta.generation === generation &&
      current.sessionEpoch === epoch
    ) {
      setDisplayDraft((draft) => (draft === previousDisplay ? null : draft));
    }
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
      <Breadcrumbs items={[{ label: '学习首页', to: '/' }, { label: '设置' }]} />
      <PageHeading
        kicker="你的浏览器，你的学习空间"
        title="设置"
        description="学习档案保存在当前浏览器，不跨设备同步。存储不可用时仅临时使用，未保存内容会在关闭或刷新后丢失。"
      />
      <LearningSaveStatus onRefresh={() => void refresh()} dirty={displayDraft !== null} />
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
                  <dd>进度、积分、目标与设置保存在当前浏览器。</dd>
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
              <BackupPanel />
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
                            avatar: '旧偏好',
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
                    {resettable.includes('avatar') && (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => setConfirmation('avatar')}
                      >
                        重置旧偏好
                      </button>
                    )}
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
                  </div>
                </section>
              )}
              <h3>清除本地数据</h3>
              <p className="notice">
                清除会移除六语言学习进度、练习记录、积分账本及防重记录、每日目标与打卡、显示设置、外观偏好与背景图片、C、Python、Java、C++、Rust
                和 MySQL 工作台草稿与薄弱点依据（包含 MySQL
                教学数据库与事务），并丢弃当前临时内容与待保存操作。清除后只能从你此前下载的完整备份恢复。
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
