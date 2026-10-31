import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ExecuteResult } from '../engine/protocol';
import { useLearning } from '../learning/react';
import type { PlayerController, PlayerControllerSnapshot } from '../player/controller';
import { readChallengeFact, type ChallengeFact, type ChallengeSession } from './authority';
import { challengeSource, kindLabels, type AnswerKind } from './content';
import { explainStep, stepPosition } from './explanation';
import { keyStepCursors, nextStepCursor } from '../player/key-steps';
import './challenges.css';

interface AnswerState {
  fact: ChallengeFact;
  status: 'saving' | 'saved' | 'unsaved';
  firstAnswer?: boolean;
}
export function ChallengePanel({
  session,
  source,
  result,
  player,
  snapshot,
}: {
  session: ChallengeSession | null;
  source: string;
  result?: ExecuteResult;
  player: PlayerController;
  snapshot: PlayerControllerSnapshot;
}) {
  const { service, state } = useLearning();
  const [mode, setMode] = useState<'teaching' | 'challenge'>('teaching');
  const [answers, setAnswers] = useState<Map<string, AnswerState>>(() => new Map());
  const current = useRef(session);
  useLayoutEffect(() => {
    current.current = session;
    return () => {
      current.current = null;
    };
  }, [session]);
  const { view } = snapshot;
  const cursor = view.cursor;
  const questions = session?.questions ?? [];
  const item = questions.find((q) => q.cursor === cursor);
  // Keying this component by the run discards only its ephemeral answer state.
  useEffect(() => {
    player.setAdvanceGuard(
      mode === 'challenge' && session
        ? (v) => {
            const question = session.questions.find((q) => q.cursor === v.cursor);
            return !question || answers.has(question.question.ref.id);
          }
        : undefined,
    );
    return () => player.setAdvanceGuard(undefined);
  }, [player, mode, session, answers]);
  const savedReceipts =
    state.snapshot?.receipts.filter((r) => r.eventType === 'challenge.answered') ?? [];
  const first = item
    ? [...savedReceipts]
        .filter((r) => r.subjectRef.id === item.question.ref.id)
        .sort((a, b) => a.committedRevision - b.committedRevision)[0]
    : undefined;
  const answer = item ? answers.get(item.question.ref.id) : undefined;
  const event = answer ? readChallengeFact(answer.fact) : null;
  const nextCursor =
    cursor !== null && result && mode === 'teaching' && snapshot.detail === 'key'
      ? nextStepCursor(keyStepCursors(result), cursor, 1) - 1
      : cursor;
  const next = nextCursor !== null ? result?.trace?.steps[nextCursor] : undefined;
  const completed = cursor !== null && cursor > 0 ? result?.trace?.steps[cursor - 1] : undefined;
  async function saveAnswer(fact: ChallengeFact, id: string) {
    const run = session,
      epoch = state.sessionEpoch;
    setAnswers((a) => new Map(a).set(id, { fact, status: 'saving' }));
    try {
      const saved = await service.recordChallengeAnswer(fact, epoch);
      if (current.current === run && service.getState().sessionEpoch === epoch)
        setAnswers((a) =>
          new Map(a).set(id, { fact, status: 'saved', firstAnswer: saved.firstAnswer }),
        );
    } catch {
      if (current.current === run && service.getState().sessionEpoch === epoch)
        setAnswers((a) => new Map(a).set(id, { fact, status: 'unsaved' }));
    }
  }
  function choose(kind: AnswerKind) {
    if (!session || !item || answer) return;
    try {
      const fact = session.answer(view, kind);
      void saveAnswer(fact, item.question.ref.id);
    } catch {
      /* A stale run never turns into a score or an answer. */
    }
  }
  return (
    <section
      className="step-teaching"
      data-testid="step-teaching"
      data-mode={mode}
      aria-label="步骤讲解与挑战"
    >
      <div className="step-teaching-heading">
        <h4>步骤学习</h4>
        <div className="step-mode" role="group" aria-label="学习模式">
          {(['teaching', 'challenge'] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              className="button button-secondary"
              onClick={() => {
                player.pause();
                setMode(value);
              }}
            >
              {value === 'teaching' ? '教学讲解' : '预测挑战'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'teaching' ? (
        <div aria-live="polite" data-testid="step-explanation">
          <p>
            <strong>
              {cursor === null
                ? '等待真实运行'
                : cursor === 0
                  ? '当前为执行前的初始状态'
                  : `刚完成第 ${cursor} 步`}
            </strong>
          </p>
          {completed && result && (
            <ul>
              {explainStep(completed, result, source).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {next && result && (
            <p>
              下一步{snapshot.detail === 'key' ? '（关键步骤）' : ''}：{kindLabels[next.kind]} ·{' '}
              {stepPosition(next, result, source)}。
            </p>
          )}
          {!result?.trace && <p>运行后可逐步查看说明，并在预测挑战中选择下一步。</p>}
        </div>
      ) : (
        <>
          <p className="challenge-rule">
            每例 3 题。同一本地档案每题只记首次答案：答对 +2 分，答错 −1 分；重复作答 0
            分。可随时回到教学讲解。
          </p>
          {!session ? (
            <p role="status">等待本次真实运行完成检查后开放挑战。</p>
          ) : (
            <>
              <div className="challenge-checkpoints" role="group" aria-label="本次挑战题目">
                {questions.map(({ question, cursor: at }, index) => (
                  <button
                    type="button"
                    className="button button-secondary"
                    key={question.ref.id}
                    aria-pressed={item?.question.ref.id === question.ref.id}
                    onClick={() => player.seek(at)}
                  >
                    {index + 1}. {question.title.split(' · ')[1]}
                    {savedReceipts.some((r) => r.subjectRef.id === question.ref.id)
                      ? '（已记分）'
                      : ''}
                  </button>
                ))}
              </div>
              {item && next && result ? (
                <div
                  data-testid="challenge-question"
                  data-question-id={item.question.ref.id}
                  data-cursor={item.cursor}
                >
                  <p>
                    <strong>{item.question.title}</strong>
                  </p>
                  <p>
                    当前已完成 {item.cursor} 步。第 {item.cursor + 1} 步将执行哪种操作？位置：
                    {stepPosition(next, result, source)}。
                  </p>
                  <div className="challenge-choices" role="group" aria-label="下一步选项">
                    {item.question.choices.map((kind) => (
                      <button
                        type="button"
                        className="button button-secondary"
                        key={kind}
                        data-answer-kind={kind}
                        disabled={
                          !!answer || state.status === 'readonly' || !state.capabilities.learning
                        }
                        onClick={() => choose(kind)}
                      >
                        {kindLabels[kind]}
                      </button>
                    ))}
                  </div>
                  {!state.capabilities.learning && (
                    <p>学习档案尚未就绪，暂不能保存挑战答案；可使用教学讲解。</p>
                  )}
                  {event && (
                    <div
                      className="challenge-feedback"
                      data-testid="challenge-feedback"
                      data-answer-result={event.result}
                      aria-live="polite"
                    >
                      <p>
                        <strong>
                          {event.result === 'correct' ? '预测正确' : '这次预测不正确'}
                        </strong>
                        ：你选择了“{kindLabels[event.answerKind]}”；实际下一步是“
                        {kindLabels[next.kind]}”。这些步骤类别互斥，其他选项不符合本步真实动作。
                      </p>
                      <ul>
                        {explainStep(next, result, source).map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                      {answer?.status === 'saving' && <p role="status">正在保存原答案……</p>}
                      {answer?.status === 'unsaved' && (
                        <>
                          <p role="alert">
                            本次答案未保存，积分未确认。重试会使用同一答案和发生时间。
                          </p>
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => void saveAnswer(answer.fact, item.question.ref.id)}
                          >
                            重试保存原答案
                          </button>
                        </>
                      )}
                      {answer?.status === 'saved' && (
                        <p role="status">
                          本次答案已保存。
                          {answer.firstAnswer ? '本题首次记分' : '本题已有首次答案，本次不再加扣分'}
                          ；账本保留{' '}
                          {state.snapshot?.ledger.find(
                            (e) =>
                              e.sourceId === challengeSource &&
                              e.subjectId === item.question.ref.id,
                          )?.points ?? '—'}{' '}
                          分。
                        </p>
                      )}
                    </div>
                  )}
                  {first && !answer && (
                    <p>
                      本题已有{first.result === 'correct' ? '正确' : '错误'}
                      首次答案；这次仅练习，不再加扣分。
                    </p>
                  )}
                </div>
              ) : (
                <p>此位置没有预测题。选择上方题目，或继续查看真实步骤。</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
