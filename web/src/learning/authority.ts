import type { ReceiptSummary } from '../storage/client';
import { StorageError } from '../storage/errors';
import { assertRecord } from '../storage/validation';
import type { LearningCatalog } from './types';

type InputSummary = Exclude<
  ReceiptSummary,
  { eventType: 'lesson.completed' | 'daily-goal.achieved' }
>;
type EventFields<T> = T extends unknown
  ? Omit<T, 'eventId' | 'goalVersion' | 'occurredAt' | 'localDate'> & {
      eventContractVersion: '1.0.0';
    }
  : never;
export type LearningEvent = EventFields<InputSummary>;
declare const verifiedFact: unique symbol;
export interface VerifiedFact {
  readonly [verifiedFact]: true;
}

interface FactData {
  event: LearningEvent;
  catalog: LearningCatalog;
  current: () => boolean;
  retainable: boolean;
  retained: boolean;
  retainedGeneration?: string;
}
const facts = new WeakMap<object, FactData>();

function equalRef(a: { id: string; version: string }, b: { id: string; version: string }) {
  return a.id === b.id && a.version === b.version;
}

export function checkLearningEvent(event: LearningEvent, catalog: LearningCatalog): void {
  if (
    catalog.purpose !== 'publishable' &&
    !(
      catalog.purpose === 'lesson-reading' &&
      ['lesson.started', 'lesson.study-confirmed'].includes(event?.eventType)
    ) &&
    !(
      catalog.purpose === 'course-practice' &&
      ['lesson.started', 'lesson.study-confirmed', 'exercise.passed'].includes(event?.eventType)
    ) &&
    !(catalog.purpose === 'case-view' && event?.eventType === 'case.view-confirmed')
  )
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  if (
    !event ||
    typeof event !== 'object' ||
    Object.getPrototypeOf(event) !== Object.prototype ||
    Reflect.ownKeys(event).some(
      (key) =>
        typeof key !== 'string' ||
        ![
          'eventContractVersion',
          'eventType',
          'subjectRef',
          'packageRef',
          'learningRevision',
          'result',
          'resultCategory',
          'failedCaseKey',
        ].includes(key),
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(event)).some((d) => !('value' in d))
  ) {
    throw new StorageError('S_RECORD_INVALID');
  }
  if (
    event.eventContractVersion !== '1.0.0' ||
    event.eventType === ('lesson.completed' as string) ||
    event.eventType === ('daily-goal.achieved' as string)
  ) {
    throw new StorageError('S_RECORD_INVALID');
  }
  const summary: Partial<LearningEvent> = structuredClone(event);
  delete summary.eventContractVersion;
  assertRecord('receipts', {
    ...summary,
    eventId: '00000000-0000-4000-8000-000000000001',
    goalVersion: 1,
    occurredAt: '2000-01-01T00:00:00.000Z',
    localDate: '2000-01-01',
    committedRevision: 1,
  });
  if (!equalRef(event.packageRef, catalog.packageRef))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  const entities = event.eventType.startsWith('lesson.')
    ? catalog.lessons
    : event.eventType.startsWith('exercise.')
      ? catalog.exercises
      : catalog.cases;
  const subject = entities.find((entity) => equalRef(entity.ref, event.subjectRef));
  if (!subject || subject.learningRevision !== event.learningRevision) {
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  }
  if (event.eventType === 'exercise.attempt-evaluated' && event.failedCaseKey !== null) {
    const exercise = catalog.exercises.find((entity) => equalRef(entity.ref, event.subjectRef));
    if (!exercise?.caseKeys.includes(event.failedCaseKey))
      throw new StorageError('S_CONTENT_INCOMPATIBLE');
  }
}

// Private integration seam. Only the lesson/judge/player owners may install a
// verifier of current real facts; production pages have no issuer. Test harnesses
// explicitly use synthetic verifiers in their separate, unpublished bundle.
export function createLearningAuthority(
  catalog: LearningCatalog,
  verifier: (event: LearningEvent) => boolean,
  retainAccepted = false,
) {
  return {
    issue(event: LearningEvent): VerifiedFact {
      checkLearningEvent(event, catalog);
      const captured = structuredClone(event);
      if (verifier(captured) !== true) throw new StorageError('S_CONTENT_INCOMPATIBLE');
      const token = Object.freeze({}) as VerifiedFact;
      facts.set(token, {
        event: captured,
        catalog,
        current: () => verifier(structuredClone(captured)) === true,
        retainable:
          retainAccepted &&
          (captured.eventType === 'exercise.passed' ||
            captured.eventType === 'case.view-confirmed'),
        retained: false,
      });
      return token;
    },
  };
}

export function readVerifiedFact(token: VerifiedFact): FactData {
  const fact = token && typeof token === 'object' ? facts.get(token) : undefined;
  if (!fact || (!fact.retained && !fact.current()))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  return { ...fact, event: structuredClone(fact.event) };
}

/** Internal acceptance seam: the service has synchronously bound this fact to a generation. */
export function retainAcceptedFact(token: VerifiedFact, generation: string): void {
  const fact = facts.get(token);
  if (!fact || (!fact.retained && !fact.current()))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
  if (fact.retainable) {
    if (fact.retainedGeneration && fact.retainedGeneration !== generation)
      throw new StorageError('S_GENERATION_STALE');
    fact.retained = true;
    fact.retainedGeneration = generation;
  }
}
