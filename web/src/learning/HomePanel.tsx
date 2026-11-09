import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { StatePanel } from '../components/Ui';
import { lessons, cases } from '../navigation';
import { useLearning } from './react';
import { memoryBugQuestions } from '../memory-bugs/content';
import type { LedgerEntry } from '../storage/model';
import { challengeQuestion } from '../challenges/content';
import { DailyGoalSettings, GoalHistory } from './goal-components';
import { savedCourseProjection } from './profile-components';
import { bugQuestions } from '../bugs/content';
import './rewards.css';
import { languages, loadLanguageNavigation, subjectLanguage, type TextLanguage } from './languages';

export const homePanels = {
  points: {
    title: '积分明细',
  },
  goals: {
    title: '每日目标',
  },
  history: {
    title: '打卡历史',
  },
} as const;

function contentTitle(id: string) {
  return (
    lessons.find((item) => item.id === id)?.title ??
    lessons.find((item) => item.exerciseId === id)?.exerciseTitle ??
    cases.find((item) => item.id === id)?.title ??
    bugQuestions.find((item) => item.exerciseRef.id === id)?.title ??
    memoryBugQuestions.find((item) => item.exerciseRef.id === id)?.title ??
    challengeQuestion(id)?.title ??
    (id.startsWith('local-goal.') ? `${id.slice('local-goal.'.length)} 每日目标` : '旧版本学习内容')
  );
}

function rewardTitle(entry: LedgerEntry) {
  return {
    'reward.exercise.first-pass': '练习首次通过',
    'reward.lesson.first-completion': '小节首次完成',
    'reward.case.first-view': '案例首次观看',
    'reward.daily-goal.once': '每日目标达成',
    'reward.challenge.first-answer': '挑战首次作答',
  }[entry.sourceId];
}

export function HomePanel({
  panel,
  dismiss,
}: {
  panel: keyof typeof homePanels;
  dismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { state, service } = useLearning();
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (panel !== 'points') return;
    let current = true;
    const needed = [
      ...new Set(
        state.snapshot?.ledger
          .map((row) => subjectLanguage(row.subjectId))
          .filter((language): language is TextLanguage => !!language && language !== 'c'),
      ),
    ];
    void Promise.allSettled(needed.map((language) => loadLanguageNavigation(language))).then(
      (results) => {
        if (!current) return;
        const next: Record<string, string> = {};
        for (const result of results)
          if (result.status === 'fulfilled')
            for (const [id, title] of result.value.subjects)
              next[id] =
                `${languages.find((language) => language.id === result.value.language)!.label} · ${title}`;
        setTitles(next);
      },
    );
    return () => {
      current = false;
    };
  }, [panel, state.snapshot?.ledger]);
  const projection = savedCourseProjection(state);
  const subjectTitle = (entry: LedgerEntry) => {
    const group = state.c6?.index?.rewardGroups.find(
      (g) =>
        (entry.sourceId === 'reward.lesson.first-completion' &&
          g.lessonReward.subjectId === entry.subjectId) ||
        (entry.sourceId === 'reward.exercise.first-pass' &&
          g.exerciseReward.subjectId === entry.subjectId),
    );
    if (!group) {
      const language = subjectLanguage(entry.subjectId);
      return language && language !== 'c'
        ? (titles[entry.subjectId] ??
            `${languages.find((item) => item.id === language)!.label} 学习内容`)
        : contentTitle(entry.subjectId);
    }
    return (
      group.lessonRefs
        .map((ref) => {
          const lesson = state.c6!.index!.lessons.find((l) => l[0] === ref.id);
          return state.c6?.manifest?.nodes.find((n) => `node.${n.id}` === lesson?.[1])
            ?.titleDisplay;
        })
        .filter(Boolean)
        .join('、') || '新书教学组'
    );
  };
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const value = homePanels[panel];
  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-labelledby="home-panel-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div className="modal-header">
        <h2 id="home-panel-title">{value.title}</h2>
        <button className="modal-close" onClick={dismiss} aria-label="关闭面板">
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">
        {panel === 'points' && (
          <section className="reward-rules" aria-label="首次奖励规则">
            <h3>首次学习奖励</h3>
            <p>练习首次通过 10 分 · 阅读首次完成 20 分 · 案例首次观看 5 分</p>
            <p className="muted">
              C 课程按同源教学组结算阅读奖励，其他语言按小节结算；同一奖励只发一次。
            </p>
            <p>每日目标达成另奖 5 分，每个日期只奖励一次。</p>
            <p className="muted">
              每项内容的首次奖励只发一次。新日期的真实复习可计入每日目标。案例需逐步看完并主动确认。
            </p>
            {state.rewardStatus === 'loading' && <p role="status">正在检查奖励规则……</p>}
            {state.rewardStatus === 'failed' && (
              <p role="alert">奖励暂未入账，已保存的待入账权利会保留。</p>
            )}
            {(state.rewardStatus === 'failed' || !!projection?.ledger.pending.length) && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void service.settleRewards()}
                disabled={state.status === 'saving' || state.status === 'readonly'}
              >
                重试奖励入账
              </button>
            )}
          </section>
        )}
        {state.temporary && (
          <p className="notice">当前仅临时使用。这里的未保存记录会在关闭或刷新页面后丢失。</p>
        )}
        {panel === 'points' &&
          (state.recovery?.ledgerUncertain ? (
            <StatePanel
              kind="error"
              title="积分暂不可确认"
              description="积分账本中有损坏或无法确认的记录。原账本已保留，相关写入已暂停，不会跳过这些记录显示缩水总分。请在本地设置中查看恢复选项。"
            />
          ) : projection?.ledger.history.length ? (
            <>
              <p className="muted">
                已入账{' '}
                {state.snapshot?.ledger
                  .filter((row) => row.status === 'posted')
                  .reduce((sum, row) => sum + BigInt(row.points), 0n)
                  .toString() ?? '0'}{' '}
                分，另有 {projection.ledger.pending.length} 条待入账奖励。
              </p>
              <ul className="learning-history-list reward-ledger">
                {[...projection.ledger.history]
                  .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
                  .map((entry) => (
                    <li key={`${entry.sourceId}:${entry.subjectId}:${entry.localDate}`}>
                      <strong>{subjectTitle(entry)}</strong>
                      <span>
                        {entry.sourceId === 'reward.lesson.first-completion' &&
                        state.c6?.index?.rewardGroups.some(
                          (group) => group.lessonReward.subjectId === entry.subjectId,
                        )
                          ? '教学组首次完成'
                          : rewardTitle(entry)}{' '}
                        · {entry.localDate}
                      </span>
                      <span className="reward-entry-value">
                        {entry.status === 'posted'
                          ? `${entry.points} 分 · 已入账`
                          : '待入账，暂不计入总分'}
                      </span>
                      {entry.policyRef && (
                        <span className="muted">奖励规则 {entry.policyRef.version}</span>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <StatePanel
              title="暂无积分记录"
              description="通过练习、完成小节或逐步看完案例后确认，即可获得首次奖励。每笔奖励入账后都会显示在这里。"
            />
          ))}
        {panel === 'goals' && <DailyGoalSettings />}
        {panel === 'history' && <GoalHistory />}
      </div>
    </dialog>
  );
}
