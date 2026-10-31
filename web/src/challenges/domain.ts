import type { ReceiptSummary, StorageMutation } from '../storage/client';
import type { StorageSnapshot } from '../storage/model';
import { assertRecord } from '../storage/validation';
import { challengePolicy, challengeSource, challengePoints } from './content';

export type ChallengeReceiptSummary = Extract<ReceiptSummary, { eventType: 'challenge.answered' }>;
/** This recipe runs inside the existing overlapping meta transaction, after fact authorization. */
export function prepareChallengeAnswer(
  snapshot: StorageSnapshot,
  receipt: ChallengeReceiptSummary,
): StorageMutation[] {
  assertRecord('receipts', { ...receipt, committedRevision: snapshot.meta.revision + 1 });
  if (
    snapshot.ledger.some(
      (e) => e.sourceId === challengeSource && e.subjectId === receipt.subjectRef.id,
    )
  )
    return [];
  return [
    {
      store: 'ledger',
      mode: 'add',
      value: {
        sourceId: challengeSource,
        subjectId: receipt.subjectRef.id,
        localDate: receipt.localDate,
        occurredAt: receipt.occurredAt,
        status: 'posted',
        points: challengePoints(receipt.result),
        policyRef: { ...challengePolicy },
      },
    },
  ];
}
