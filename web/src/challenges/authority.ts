import { acceptedCaseRequest, type ExecutionCatalog } from '../engine/execution-client';
import type { ExecuteResult } from '../engine/protocol';
import { createCaseViewSession } from '../learning/case-authority';
import type { PlayerSnapshot } from '../player/model';
import { StorageError } from '../storage/errors';
import { challengePackage, questionsForTrace, type AnswerKind } from './content';

export interface ChallengeEvent {
  eventContractVersion: '1.1.0';
  eventType: 'challenge.answered';
  subjectRef: { id: string; version: string };
  packageRef: { id: string; version: string };
  learningRevision: 1;
  result: 'correct' | 'incorrect';
  answerKind: AnswerKind;
}
declare const factBrand: unique symbol;
export interface ChallengeFact {
  readonly [factBrand]: true;
}
const facts = new WeakMap<
  ChallengeFact,
  { event: ChallengeEvent; current: () => boolean; retained: boolean }
>();
export function readChallengeFact(fact: ChallengeFact, retain = false): ChallengeEvent {
  const entry = facts.get(fact);
  if (!entry || (!entry.retained && !entry.current()))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  if (retain) entry.retained = true;
  return structuredClone(entry.event);
}
export function createChallengeSession(
  catalog: ExecutionCatalog,
  result: ExecuteResult,
  current: () => boolean,
) {
  const request = acceptedCaseRequest(result);
  if (!request) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  // Reuse the full published-template, input and real-result checks, without issuing a watch fact.
  createCaseViewSession(catalog, request, result, current);
  const questions = questionsForTrace(catalog.subject.id, result.trace!.steps);
  const answers = new Map<string, ChallengeFact>();
  return {
    result,
    questions,
    answer(view: PlayerSnapshot, answerKind: AnswerKind): ChallengeFact {
      const item = questions.find((q) => q.cursor === view.cursor);
      if (
        !current() ||
        !item ||
        view.identity?.runId !== result.identity.runId ||
        view.length !== result.trace!.steps.length ||
        !item.question.choices.includes(answerKind)
      )
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
      const prior = answers.get(item.question.ref.id);
      if (prior) return prior;
      const fact = Object.freeze({}) as ChallengeFact;
      const event: ChallengeEvent = {
        eventContractVersion: '1.1.0',
        eventType: 'challenge.answered',
        subjectRef: { ...item.question.ref },
        packageRef: { ...challengePackage },
        learningRevision: 1,
        result: result.trace!.steps[item.cursor].kind === answerKind ? 'correct' : 'incorrect',
        answerKind,
      };
      facts.set(fact, { event, current, retained: false });
      answers.set(item.question.ref.id, fact);
      return fact;
    },
  };
}
export type ChallengeSession = ReturnType<typeof createChallengeSession>;
