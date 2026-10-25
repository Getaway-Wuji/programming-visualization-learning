import { useEffect, useState, type FormEvent } from 'react';
import { StatePanel } from '../components/Ui';
import type { GoalTargets } from '../storage/model';
import { localDateAt } from '../storage/validation';
import { useLearning } from './react';
import './goals.css';

const kinds = ['exercise', 'lesson', 'case'] as const;
const labels = { exercise: '练习', lesson: '小节', case: '案例' };
const units = { exercise: '道', lesson: '个', case: '个' };

export function targetText(targets: GoalTargets) {
  return `${targets.exercise} 道练习 · ${targets.lesson} 个小节 · ${targets.case} 个案例`;
}

/** Calendar labels follow the archive's fixed zone, including after a suspended tab resumes. */
export function useLocalLearningDate(timeZone: string | undefined) {
  const read = () => (timeZone ? localDateAt(new Date().toISOString(), timeZone) : null);
  const [observed, setObserved] = useState(read);
  useEffect(() => {
    const update = () => setObserved(read());
    update();
    const timer = window.setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
    // The only external input to the calendar is the archive's zone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeZone]);
  return timeZone ? (observed ?? read()) : null;
}

export function DailyGoalSummary() {
  const { state } = useLearning();
  const today = useLocalLearningDate(state.snapshot?.meta.timeZone);
  const snapshot = state.snapshot;
  const goal = snapshot?.goals.find((row) => row.localDate === today);
  const targets = goal
    ? goal.targets
    : state.goalStatus === 'ready'
      ? snapshot?.settings.goalTemplate?.targets
      : undefined;
  const counts = { exercise: 0, lesson: 0, case: 0 };
  for (const fact of snapshot?.dailyFacts ?? []) {
    if (fact.localDate === today) counts[fact.eventType.split('.')[0] as keyof GoalTargets]++;
  }
  const dailyReward = snapshot?.ledger.find(
    (row) => row.sourceId === 'reward.daily-goal.once' && row.localDate === today,
  );
  const projected = state.projection?.goals.find((row) => row.localDate === today);
  const status = goal?.achievedAt
    ? 'achieved'
    : goal?.targets === null
      ? 'legacy'
      : targets
        ? goal
          ? 'active'
          : 'preview'
        : 'unavailable';
  return (
    <section
      className="daily-goal-summary"
      data-testid="daily-goal-summary"
      data-local-date={today ?? ''}
      data-goal-state={status}
      aria-label="今日目标进度"
    >
      <p className="muted goal-date">
        {today ?? '正在读取日期'} · {snapshot?.meta.timeZone ?? '—'}
      </p>
      <h3>
        {status === 'achieved'
          ? '今日已打卡'
          : status === 'preview'
            ? '今日目标待开始'
            : '今日目标'}
      </h3>
      {targets ? (
        <>
          <ul className="goal-progress-list">
            {kinds.map((kind) => (
              <li key={kind} data-testid={`goal-progress-${kind}`}>
                <span>{labels[kind]}</span>
                <span className="goal-count">
                  {targets[kind]
                    ? `${counts[kind]} / ${targets[kind]} ${units[kind]}`
                    : `不设要求 · 已记录 ${counts[kind]}`}
                </span>
                {targets[kind] > 0 && (
                  <progress
                    aria-label={`${labels[kind]}今日进度`}
                    max={targets[kind]}
                    value={Math.min(counts[kind], targets[kind])}
                  />
                )}
              </li>
            ))}
          </ul>
          <p className="muted">
            {status === 'preview'
              ? '这是待开始的目标。首次主动学习时固定今天的目标；刷新不会产生进度或打卡。'
              : status === 'achieved'
                ? dailyReward?.status === 'posted'
                  ? `打卡已保存，${dailyReward.points} 分已入账。`
                  : '打卡已保存，奖励待入账。'
                : '今天的目标已固定。完成新的学习活动后自动记录打卡，每日只奖励一次。'}
          </p>
          {projected?.reachable === false && !goal?.achievedAt && (
            <p className="notice">当前可用内容不足以达到这份目标。原目标保留，请恢复内容后继续。</p>
          )}
        </>
      ) : (
        <p className="muted">
          {status === 'legacy'
            ? '这份旧日期记录没有配置目标，今天不补记打卡。已保存的目标将用于下一个尚未开始的日期。'
            : state.goalStatus === 'failed'
              ? '目标配置暂不可用，请在每日目标中重试。'
              : '正在准备每日目标。'}
        </p>
      )}
      {state.clockStatus === 'rollback' && (
        <p className="notice" role="alert">
          本地时间出现倒退，请校准设备时间。原日期记录和奖励会保留。
        </p>
      )}
      {state.temporary && (
        <p className="notice">这里只显示已保存的目标进度，未保存的学习尚未计入打卡。</p>
      )}
    </section>
  );
}

function GoalEditor() {
  const { state, service } = useLearning();
  const template = state.snapshot!.settings.goalTemplate!;
  const config = state.goalConfiguration!;
  const strings = (value: Readonly<GoalTargets>) =>
    Object.fromEntries(kinds.map((key) => [key, String(value[key])])) as Record<
      keyof GoalTargets,
      string
    >;
  const [edit, setEdit] = useState<{
    value: Record<keyof GoalTargets, string>;
    revision: number;
  } | null>(null);
  const draft = edit?.value ?? strings(template.targets);
  const baseRevision = edit?.revision ?? state.snapshot!.meta.revision;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const targets = Object.fromEntries(
    kinds.map((kind) => [kind, Number(draft[kind])]),
  ) as unknown as GoalTargets;
  const valid =
    kinds.every(
      (kind) =>
        draft[kind].trim() !== '' &&
        Number.isSafeInteger(targets[kind]) &&
        targets[kind] >= 0 &&
        targets[kind] <= config.limits[kind],
    ) && kinds.some((kind) => targets[kind] > 0);
  const disabled =
    busy ||
    state.status === 'saving' ||
    state.status === 'readonly' ||
    state.pendingCount > 0 ||
    !state.capabilities.goalsConfigurable;
  const save = async (value: GoalTargets) => {
    setBusy(true);
    setMessage('');
    setEdit({ value: strings(value), revision: baseRevision });
    const generation = state.snapshot!.meta.generation;
    const epoch = state.sessionEpoch;
    await service.saveGoalTemplate(value, baseRevision);
    const result = service.getState();
    if (
      result.status === 'ready' &&
      result.lastSaved &&
      result.snapshot?.meta.generation === generation &&
      result.sessionEpoch === epoch &&
      kinds.every((kind) => result.snapshot!.settings.goalTemplate?.targets[kind] === value[kind])
    ) {
      setEdit(null);
      setMessage('目标已保存。已固定的日期保持原目标，新目标用于后续尚未开始的日期。');
    } else {
      setMessage(
        result.status === 'conflict'
          ? '其他页面已更新档案，这份目标尚未保存。请重新读取后再提交。'
          : '目标尚未保存，输入已保留。恢复后请重新提交。',
      );
    }
    setBusy(false);
  };
  return (
    <form
      className="goal-settings"
      data-testid="daily-goal-settings"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (valid && !disabled) void save(targets);
      }}
    >
      <h3>安排后续日期</h3>
      <p className="muted">
        每天每项内容只计一次。重复学习可计新一天的进度，内容首次奖励仍只发一次。
      </p>
      <p>已保存：{targetText(template.targets)}</p>
      <fieldset disabled={disabled}>
        <legend>自定义目标，至少选择一项</legend>
        <div className="goal-fields">
          {kinds.map((kind) => (
            <label key={kind}>
              <span>每日{labels[kind]}数</span>
              <input
                type="number"
                aria-label={`每日${labels[kind]}数`}
                aria-describedby={`goal-range-${kind}`}
                min="0"
                max={config.limits[kind]}
                step="1"
                required
                value={draft[kind]}
                onChange={(event) => {
                  setEdit({
                    value: { ...draft, [kind]: event.target.value },
                    revision: baseRevision,
                  });
                  setMessage('');
                }}
              />
              <span className="muted" id={`goal-range-${kind}`}>
                0—{config.limits[kind]}，0 表示不设要求
              </span>
            </label>
          ))}
        </div>
        {!valid && <p role="alert">请填写范围内的整数，且至少一项大于 0。</p>}
        <div className="inline-actions">
          <button type="submit" className="button button-primary" disabled={!valid}>
            保存自定义目标
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              void save(config.recommended);
            }}
          >
            使用推荐目标
          </button>
        </div>
      </fieldset>
      <p className="muted">
        推荐：{targetText(config.recommended)}。后续日期生效，已固定的今日目标不变。
      </p>
      {message && (
        <p data-testid="goal-template-saved" role={state.status === 'ready' ? 'status' : 'alert'}>
          {message}
        </p>
      )}
      {edit && (state.status === 'conflict' || state.status === 'unsaved') && (
        <button
          type="button"
          className="button button-secondary"
          onClick={async () => {
            const generation = state.snapshot!.meta.generation;
            await service.refresh();
            const result = service.getState();
            if (result.status === 'ready' && result.snapshot?.meta.generation === generation) {
              setEdit(null);
              setMessage('已重新读取，请核对目标后再保存。');
            } else {
              setMessage('重新读取失败，输入已保留。请恢复存储后重试。');
            }
          }}
        >
          重新读取目标
        </button>
      )}
    </form>
  );
}

export function DailyGoalSettings() {
  const { state, service } = useLearning();
  return (
    <>
      <DailyGoalSummary />
      {state.goalStatus === 'ready' &&
      state.goalConfiguration &&
      state.snapshot?.settings.goalTemplate ? (
        <GoalEditor key={state.snapshot.meta.generation} />
      ) : (
        <StatePanel
          title="每日目标暂不可配置"
          description="目标配置或本地存储暂不可用。已有日期记录保留，恢复后再开始新日期。"
        >
          <button
            type="button"
            className="button button-secondary"
            disabled={state.status === 'saving'}
            onClick={() => void service.reloadGoalConfiguration()}
          >
            重试目标配置
          </button>
        </StatePanel>
      )}
    </>
  );
}

export function GoalHistory() {
  const { state } = useLearning();
  const history = [...(state.snapshot?.goals ?? [])].sort((a, b) =>
    b.localDate.localeCompare(a.localDate),
  );
  const achieved = history.filter((goal) => goal.achievedAt);
  return (
    <section data-testid="goal-history">
      <p>
        已保存 {achieved.length} 天打卡 · 日期按 {state.snapshot?.meta.timeZone ?? '档案时区'} 归档
      </p>
      {history.length ? (
        <ul className="learning-history-list goal-history-list">
          {history.map((goal) => {
            const reward = state.snapshot?.ledger.find(
              (row) =>
                row.sourceId === 'reward.daily-goal.once' && row.localDate === goal.localDate,
            );
            return (
              <li key={goal.localDate} data-goal-date={goal.localDate}>
                <strong>
                  {goal.localDate} ·{' '}
                  {goal.achievedAt ? '已打卡' : goal.targets ? '未达成' : '旧记录未配置目标'}
                </strong>
                <span>{goal.targets ? targetText(goal.targets) : '原日期快照保持不变'}</span>
                {goal.achievedAt && (
                  <span>
                    {reward?.status === 'posted' ? `${reward.points} 分已入账` : '奖励待入账'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <StatePanel
          title="暂无打卡记录"
          description="通过练习、完成小节或看完案例后主动确认，达到当天目标即自动保存打卡。刷新不会产生进度。"
        />
      )}
    </section>
  );
}
