import { acceptedC6Proof, acceptedC6Request, c6RunRequest } from '../engine/c6-client';
import type { C6JudgeRequest, C6Response } from '../engine/c6-types';
import { canonicalC6Json } from '../engine/c6-protocol';
import { StorageError } from '../storage/errors';
import type { C6LearningIndex } from './index';
import { isLoadedC6LearningIndex } from './index';
import { c6LearningRelease } from './release.generated';
import { assertC6Attempt, type C6Attempt } from './model';

declare const leaseBrand: unique symbol;
declare const factBrand: unique symbol;
export type C6RunLease = { readonly [leaseBrand]: true };
export type C6CourseFact = { readonly [factBrand]: true };
export interface C6Session {
  generation: string;
  epoch: number;
}
export function createC6CourseAuthority(index: C6LearningIndex, current: () => C6Session | null) {
  if (!isLoadedC6LearningIndex(index)) throw new StorageError('S_CONTENT_INCOMPATIBLE');
  const leases = new WeakMap<
    C6RunLease,
    {
      session: C6Session;
      exerciseId: string;
      request: C6JudgeRequest;
      valid: boolean;
      accepted: boolean;
    }
  >();
  const facts = new WeakMap<
    C6CourseFact,
    { session: C6Session; exerciseId: string; attempt: C6Attempt; lease: C6RunLease }
  >();
  const check = (session: C6Session) => {
    const now = current();
    if (!now || now.generation !== session.generation || now.epoch !== session.epoch)
      throw new StorageError('S_GENERATION_STALE');
  };
  return {
    async begin(
      exerciseId: string,
      source: string,
      sourceRevision: string,
    ): Promise<{ lease: C6RunLease; request: C6JudgeRequest }> {
      const session = current();
      const exercise = index.exercises.find((e) => e[0] === exerciseId);
      if (!session || !exercise) throw new StorageError('S_CONTENT_INCOMPATIBLE');
      const { input, ...base } = await c6RunRequest(source, '', sourceRevision);
      void input;
      check(session);
      const request: C6JudgeRequest = {
        ...base,
        judgeVersion: '2.0.0',
        packageRef: { ...index.judgeOwnerPackageRef },
        profileRef: { id: exercise[3], version: '1.0.0' },
      };
      const lease = Object.freeze({}) as C6RunLease;
      leases.set(lease, { session, exerciseId, request, valid: true, accepted: false });
      return { lease, request: structuredClone(request) };
    },
    invalidate(lease: C6RunLease) {
      const data = leases.get(lease);
      if (data) data.valid = false;
    },
    accept(lease: C6RunLease, result: C6Response, at: string): C6CourseFact {
      const data = leases.get(lease);
      if (!data?.valid || data.accepted) throw new StorageError('S_GENERATION_STALE');
      check(data.session);
      const request = acceptedC6Request(result),
        proof = acceptedC6Proof(result);
      if (
        !request ||
        canonicalC6Json(request) !== canonicalC6Json(data.request) ||
        proof?.engineBuildSha256 !== c6LearningRelease.engineBuildSha256 ||
        !proof.judge ||
        proof.judge.profileId !== data.request.profileRef.id
      )
        throw new StorageError('S_CONTENT_INCOMPATIBLE');
      const attempt: C6Attempt = {
        eventId: crypto.randomUUID(),
        at,
        sourceRevision: data.request.sourceRevision,
        sourceSha256: data.request.sourceSha256,
        requestSha256: proof.requestSha256,
        resultSha256: proof.resultSha256,
        engineBuildSha256: proof.engineBuildSha256,
        profileRef: { ...data.request.profileRef },
        status: proof.judge.status,
        caseKeys: proof.judge.caseKeys,
        failedCaseKey: proof.judge.failedCaseKey,
        failure: proof.judge.failure,
      };
      assertC6Attempt(attempt, data.request.profileRef.id);
      data.accepted = true;
      const fact = Object.freeze({}) as C6CourseFact;
      facts.set(fact, { session: data.session, exerciseId: data.exerciseId, attempt, lease });
      return fact;
    },
    read(fact: C6CourseFact) {
      const data = facts.get(fact);
      if (!data) throw new StorageError('S_CONTENT_INCOMPATIBLE');
      if (!leases.get(data.lease)?.valid) throw new StorageError('S_GENERATION_STALE');
      check(data.session);
      return structuredClone({
        session: data.session,
        exerciseId: data.exerciseId,
        attempt: data.attempt,
      });
    },
  };
}
export type C6CourseAuthority = ReturnType<typeof createC6CourseAuthority>;
