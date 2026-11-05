import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createLearningService, type LearningServiceState } from './service';
import { defaultSettings } from '../storage/model';
import { StatePanel } from '../components/Ui';
import { caseLearningCatalog } from '../content/case-learning';
import { isCompatibleLearningHistory } from './domain';

const LearningContext = createContext<{
  service: ReturnType<typeof createLearningService>;
  state: LearningServiceState;
} | null>(null);

export function LearningProvider({ children }: { children: ReactNode }) {
  const [service] = useState(createLearningService);
  const lifecycle = useRef({ token: 0 });
  const subscribe = useCallback((listener: () => void) => service.subscribe(listener), [service]);
  const getState = useCallback(() => service.getState(), [service]);
  const state = useSyncExternalStore(subscribe, getState);
  const settings = state.snapshot?.settings ?? defaultSettings();

  useEffect(() => {
    const lease = lifecycle.current;
    const token = ++lease.token;
    void service.start();
    const refresh = () => void service.refresh({ preserveOutcome: true });
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
      // StrictMode repeats setup immediately; a real unmount closes the shared connection.
      queueMicrotask(() => {
        if (lease.token === token) service.dispose();
      });
    };
  }, [service]);

  useEffect(() => {
    const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const element = document.documentElement;
      element.dataset.motionPreference = settings.reducedMotion;
      element.dataset.reducedMotion =
        settings.reducedMotion === 'system'
          ? motionMedia.matches
            ? 'on'
            : 'off'
          : settings.reducedMotion;
    };
    apply();
    motionMedia.addEventListener('change', apply);
    return () => {
      motionMedia.removeEventListener('change', apply);
    };
  }, [settings.reducedMotion]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--avatar-accent',
      state.snapshot?.avatar.accentColor ?? '#168A72',
    );
  }, [state.snapshot?.avatar.accentColor]);

  return <LearningContext.Provider value={{ service, state }}>{children}</LearningContext.Provider>;
}

export function useLearning() {
  const value = useContext(LearningContext);
  if (!value) throw new Error('LearningProvider is required.');
  return value;
}

function savingMessage(state: LearningServiceState, dirty: boolean) {
  if (state.status === 'loading')
    return { title: '正在读取本地档案', description: '显示默认外观，读取完成后应用可用的设置。' };
  if (state.status === 'saving')
    return { title: '正在保存', description: '保存确认完成后，这次更改才会显示为已保存。' };
  if (state.status === 'conflict')
    return {
      title: '设置发生冲突',
      description: '其他页面已更新本地档案。这次更改未保存，请重新读取后再选择设置。',
    };
  if (state.errorCode === 'S_GENERATION_STALE')
    return {
      title: '本地档案已变化',
      description: '其他页面已清除或替换档案。旧的临时内容和待保存操作已失效，请重新读取后继续。',
    };
  if (state.errorCode === 'S_CONTENT_INCOMPATIBLE')
    return {
      title: '课程更新尚未就绪',
      description:
        '当前课程版本尚未完成发布，暂不能保存新的学习结果。原学习档案已保留，无需清除数据或修改存储权限；更新可用后重新读取即可继续。',
    };
  if (state.errorCode === 'S_VERSION_UNKNOWN' || state.errorCode === 'S_MIGRATION_UNSUPPORTED')
    return {
      title: '存档版本暂不支持',
      description:
        '原档案已保留，当前版本不能安全修改或清除。请使用匹配版本，或前往浏览器的网站数据管理。',
    };
  if (state.recovery?.issues.length || state.errorCode === 'S_RECORD_INVALID')
    return {
      title: '本地档案含有损坏记录',
      description: state.recovery?.ledgerUncertain
        ? '原记录已保留，可确认的合法记录仍可查看。积分暂不可确认，相关学习和奖励写入已暂停。'
        : '原记录已保留，可确认的合法记录仍可查看。受影响的数据暂不能保存，请在本地数据中查看恢复选项。',
    };
  if (state.errorCode === 'S_QUOTA')
    return {
      title: '浏览器存储空间不足',
      description: '这次更改未保存，已有记录不会为腾出空间而被删除。请释放空间后重试。',
    };
  if (state.errorCode === 'S_STORAGE_UNAVAILABLE')
    return {
      title: '浏览器存储暂不可用',
      description: '请检查网站存储权限。隐私浏览或浏览器限制也可能影响保存，恢复可用后可以重试。',
    };
  if (state.errorCode === 'S_UPGRADE_BLOCKED')
    return {
      title: '等待其他页面关闭',
      description: '请关闭使用本网站的其他页面后重新读取。现有档案会保留。',
    };
  if (state.status === 'readonly')
    return {
      title: '本地档案暂不可写',
      description: '现有数据会保留。请重新打开页面或在本地数据中查看恢复选项。',
    };
  if (state.cleared && !dirty)
    return {
      title: '本地数据已清除',
      description: '学习档案与待保存操作已清除，显示设置已恢复默认。',
    };
  if (state.temporary)
    return {
      title: '正在临时使用，尚未保存',
      description: '当前更改仅在本次页面中使用。关闭或刷新页面会丢失未保存的内容。',
    };
  if (dirty && state.status === 'ready')
    return {
      title: '当前更改尚未保存',
      description: '保存后才会应用这次更改；也可以采用之前已保存的设置。',
    };
  if (state.status === 'unsaved')
    return {
      title: '本次更改未保存',
      description: '已保存记录保持原状。请检查浏览器存储状态后重新保存。',
    };
  return state.lastSaved
    ? { title: '已保存', description: '这次更改已保存到当前浏览器。' }
    : {
        title: '本地档案已读取',
        description: '正在显示当前浏览器中已保存的记录与设置。',
      };
}

export function LearningSaveStatus({
  onRefresh,
  onRetry,
  dirty = false,
}: {
  onRefresh?: () => void;
  onRetry?: () => Promise<void>;
  dirty?: boolean;
}) {
  const { state, service } = useLearning();
  const status = state.status === 'ready' && (dirty || state.temporary) ? 'unsaved' : state.status;
  const display = savingMessage(state, dirty);
  if (
    (state.status === 'ready' || state.status === 'saving') &&
    !state.temporary &&
    (state.status === 'saving' || !state.pendingCount) &&
    !state.recovery?.issues.length &&
    !state.errorCode &&
    !state.timeZoneFallback
  )
    return null;
  return (
    <div data-testid="learning-save-status" data-save-status={status}>
      <StatePanel
        kind={
          status === 'loading' || status === 'saving'
            ? 'loading'
            : state.status === 'unsaved' ||
                status === 'conflict' ||
                status === 'readonly' ||
                !!state.recovery?.issues.length
              ? 'error'
              : 'empty'
        }
        title={display.title}
        description={display.description}
      >
        {(state.status === 'unsaved' || status === 'conflict' || status === 'readonly') && (
          <button
            type="button"
            className="button button-secondary"
            onClick={onRefresh ?? (() => void service.refresh())}
          >
            重新读取档案
          </button>
        )}
        {state.pendingCount > 0 && (
          <button
            type="button"
            className="button button-secondary"
            disabled={
              state.status === 'loading' || state.status === 'saving' || state.status === 'readonly'
            }
            onClick={() => void (onRetry ?? service.retryPending)()}
          >
            重试未保存操作
          </button>
        )}
      </StatePanel>
      {(state.temporary || state.pendingCount > 0) && (
        <p className="notice" data-testid="learning-temporary-status">
          {state.temporary ? '当前处于临时模式。' : ''}
          {state.pendingCount > 0 ? `有 ${state.pendingCount} 条操作尚未保存。` : ''}
          {state.errorCode === 'S_CONTENT_INCOMPATIBLE'
            ? '已保存的档案仍保留。请等待课程版本更新后再重试。'
            : '关闭或刷新页面会丢失未保存的内容；恢复存储后可重试。'}
        </p>
      )}
      {state.timeZoneFallback && (
        <p className="notice">未能识别浏览器时区，当前档案使用 UTC 日期记录学习。</p>
      )}
    </div>
  );
}

export function subjectLearningText(
  state: LearningServiceState,
  kind: 'lesson' | 'exercise' | 'case',
  id: string,
): string {
  if (!state.projection) return '学习记录尚未读取';
  if (state.temporary) return '当前临时学习记录尚未保存，关闭或刷新页面后会丢失。';
  if (kind === 'lesson') {
    const item = state.projection.lessons.find((value) => value.id === id);
    if (item?.completed) return '当前内容兼容的历史记录：小节已完成';
    if (item?.studyConfirmed) return '当前内容兼容的历史记录：已确认学习';
    if (item?.started) return '当前内容兼容的历史记录：已开始';
  } else if (kind === 'exercise') {
    const item = state.projection.exercises.find((value) => value.id === id);
    if (item?.passed) return '当前内容兼容的历史记录：练习已通过';
    if (item?.latestAttempt) return '已有当前内容兼容的历史尝试记录';
  } else {
    const current = caseLearningCatalog().cases.find((value) => value.ref.id === id);
    if (
      current &&
      state.projection.history.some(
        (row) =>
          row.eventType === 'case.view-confirmed' &&
          isCompatibleLearningHistory(row, current, 'case', state.snapshot?.aliases ?? []),
      )
    )
      return '当前内容兼容的历史记录：已确认观看';
  }
  const entity =
    kind === 'lesson'
      ? state.projection.lessons.find((value) => value.id === id)
      : kind === 'exercise'
        ? state.projection.exercises.find((value) => value.id === id)
        : state.projection.cases.find((value) => value.id === id);
  const history =
    entity?.history ?? state.projection.history.filter((row) => row.subjectRef.id === id);
  return history.length ? '保留旧版本历史记录，当前内容尚无兼容记录' : '尚无已保存的学习记录';
}

export function SubjectLearningStatus({
  kind,
  id,
}: {
  kind: 'lesson' | 'exercise' | 'case';
  id: string;
}) {
  const { state } = useLearning();
  return (
    <div className="learning-subject-status" data-learning-subject={id}>
      <p className="muted">{subjectLearningText(state, kind, id)}</p>
      {state.temporary && (
        <p className="notice">当前仅临时使用，未保存的内容会在关闭或刷新后丢失。</p>
      )}
      {kind !== 'case' &&
        (!state.capabilities.learning ||
          (kind !== 'lesson' &&
            state.reading?.catalog.purpose === 'lesson-reading' &&
            !(kind === 'exercise' && state.practiceStatus === 'ready'))) && (
          <p className="notice">正式学习未开放，预览不计进度。</p>
        )}
    </div>
  );
}
