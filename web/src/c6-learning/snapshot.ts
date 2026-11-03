import judges from '../../../engine/c6/resources/judges-1.0.0.json';
import { acceptedC6Proof, acceptedC6Request } from '../engine/c6-client';
import { c6SourceHash } from '../engine/c6-protocol';
import { C6Player } from '../engine/c6-player';
import type { C6Response, C6Result, C6State, C6Step, C6Type } from '../engine/c6-types';
import type { Ref } from '../storage/model';
import { isSafeUint, isUtcTime, isUuid } from '../storage/validation';
import { createSourceIndex, type SourceRange } from '../player/source-location';
import { SNAPSHOT_LIMITS, SnapshotError } from '../snapshot-export/types';
import { c6LearningRelease } from './release.generated';
import { isC6SourceNode, type C6LearningIndex } from './index';

export interface C6SnapshotDocument {
  formatId: 'urn:c-viz:current-snapshot:2.0.0';
  formatVersion: '2.0.0';
  snapshotId: string;
  capturedAt: string;
  origin: {
    kind: 'c6-course';
    title: string;
    documentRef: Ref;
    nodeRef: Ref;
    exerciseRef: Ref | null;
    packageRef: Ref;
  };
  source: {
    text: string;
    encoding: 'UTF-8';
    sourceRevision: string;
    sha256: string;
    nodeMap: C6Result['nodeMap'];
  };
  input: { kind: 'stdin-ascii'; text: string; profileRef: Ref | null; caseKey: string | null };
  runtime: {
    domain: 'c6';
    engine: C6Result['engine'];
    identity: C6Result['identity'];
    versions: {
      execution: '1.5.0';
      step: '1.4.0';
      diagnostic: '1.4.0';
      integerEncoding: '1.0.0';
      judge: '2.0.0' | null;
    };
    requestSha256: string;
    resultSha256: string;
  };
  position: {
    cursor: number;
    length: number;
    paused: true;
    completeness: 'complete' | 'prefix';
    executedRange: SourceRange | null;
    terminalRange: SourceRange | null;
  };
  virtualAddresses: 'educational-not-host-addresses';
  presentation: {
    scope: 'complete-current-state';
    image: 'reflowed-state-picture';
    selectionAndPaginationExcluded: true;
  };
  types: C6Type[];
  currentState: C6State;
  currentStep: C6Step | null;
  executionOutcome: C6Result['terminal'];
  terminalAtCursor: C6Result['terminal'] | null;
}
export interface C6SnapshotCapture {
  result: C6Response;
  caseIndex: number;
  cursor: number;
  title: string;
  documentId: string;
  nodeRef: Ref;
  exerciseId: string | null;
}
export function c6SnapshotKey(capture: C6SnapshotCapture | null): string {
  if (!capture) return 'unavailable';
  const request = acceptedC6Request(capture.result);
  return request
    ? JSON.stringify([
        capture.documentId,
        request.sourceRevision,
        request.sourceSha256,
        'runId' in request ? request.runId : request.documentId,
        capture.caseIndex,
        capture.cursor,
      ])
    : 'unavailable';
}
export async function captureC6Snapshot(
  capture: C6SnapshotCapture,
  index: C6LearningIndex,
  check: () => void,
): Promise<C6SnapshotDocument> {
  check();
  const request = acceptedC6Request(capture.result),
    proof = acceptedC6Proof(capture.result);
  if (
    !request ||
    !proof ||
    'editVersion' in request ||
    'editVersion' in capture.result ||
    proof.engineBuildSha256 !== c6LearningRelease.engineBuildSha256 ||
    !Object.isFrozen(capture.result) ||
    !isC6SourceNode(index, capture.nodeRef.id) ||
    capture.nodeRef.version !== '2.0.0'
  )
    throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
  let packet: C6Result;
  let input: C6SnapshotDocument['input'];
  if ('judgeVersion' in request) {
    if (!('cases' in capture.result) || !Number.isInteger(capture.caseIndex))
      throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
    const profile = judges.profiles.find((p) => p.ref.id === request.profileRef.id);
    const outcome = capture.result.cases[capture.caseIndex],
      test = profile?.testDomain[capture.caseIndex];
    const exercise = index.exercises.find((e) => e[0] === capture.exerciseId);
    if (
      !outcome ||
      !test ||
      outcome.caseKey !== test.caseKey ||
      !exercise ||
      exercise[3] !== profile?.ref.id ||
      exercise[1] !== capture.nodeRef.id ||
      capture.documentId !== exercise[0]
    )
      throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
    packet = outcome.packet;
    input = {
      kind: 'stdin-ascii',
      text: test.stdin,
      profileRef: { ...request.profileRef },
      caseKey: test.caseKey,
    };
  } else {
    if ('cases' in capture.result) throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
    packet = capture.result;
    input = { ...request.input, profileRef: null, caseKey: null };
  }
  if (
    !packet.trace ||
    !isSafeUint(capture.cursor) ||
    capture.cursor > packet.trace.steps.length ||
    (await c6SourceHash(request.source)) !== request.sourceSha256
  )
    throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
  check();
  const player = new C6Player(packet);
  player.seek(capture.cursor);
  check();
  const step = packet.trace.steps[capture.cursor - 1] ?? null;
  const position = createSourceIndex(request.source);
  const range = step ? packet.nodeMap.find((n) => n.nodeId === step.nodeId)?.byteRange : null;
  const document: C6SnapshotDocument = {
    formatId: 'urn:c-viz:current-snapshot:2.0.0',
    formatVersion: '2.0.0',
    snapshotId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    origin: {
      kind: 'c6-course',
      title: capture.title,
      documentRef: { id: capture.documentId, version: '2.0.0' },
      nodeRef: { ...capture.nodeRef },
      exerciseRef: capture.exerciseId ? { id: capture.exerciseId, version: '2.0.0' } : null,
      packageRef: { ...index.packageRef },
    },
    source: {
      text: request.source,
      encoding: 'UTF-8',
      sourceRevision: request.sourceRevision,
      sha256: request.sourceSha256,
      nodeMap: packet.nodeMap,
    },
    input,
    runtime: {
      domain: 'c6',
      engine: packet.engine,
      identity: packet.identity,
      versions: {
        execution: '1.5.0',
        step: '1.4.0',
        diagnostic: '1.4.0',
        integerEncoding: '1.0.0',
        judge: 'judgeVersion' in request ? '2.0.0' : null,
      },
      requestSha256: proof.requestSha256,
      resultSha256: proof.resultSha256,
    },
    position: {
      cursor: capture.cursor,
      length: packet.trace.steps.length,
      paused: true,
      completeness: packet.trace.completeness,
      executedRange: range ? position.range(range) : null,
      terminalRange: packet.terminal.byteRange ? position.range(packet.terminal.byteRange) : null,
    },
    virtualAddresses: 'educational-not-host-addresses',
    presentation: {
      scope: 'complete-current-state',
      image: 'reflowed-state-picture',
      selectionAndPaginationExcluded: true,
    },
    types: packet.types,
    currentState: player.state,
    currentStep: step,
    executionOutcome: packet.terminal,
    terminalAtCursor: capture.cursor === packet.trace.steps.length ? packet.terminal : null,
  };
  if (!isUuid(document.snapshotId) || !isUtcTime(document.capturedAt))
    throw new SnapshotError('SNAPSHOT_FAILED');
  encodeC6Snapshot(document);
  check();
  return structuredClone(document);
}
export function encodeC6Snapshot(document: C6SnapshotDocument): Uint8Array<ArrayBuffer> {
  if (
    document.formatId !== 'urn:c-viz:current-snapshot:2.0.0' ||
    document.formatVersion !== '2.0.0'
  )
    throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
  const bytes = new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
  if (bytes.length > SNAPSHOT_LIMITS.jsonBytes) throw new SnapshotError('SNAPSHOT_TOO_LARGE');
  return bytes;
}
