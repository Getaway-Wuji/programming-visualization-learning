import type {
  ExecuteRequest,
  ExecuteResult,
  TraceState,
  TraceStep,
  ByteRange,
} from '../engine/protocol';
import type {
  MemoryRequest,
  MemoryResult,
  MemoryState,
  MemoryStep,
} from '../engine/memory-protocol';
import type { PlayerSnapshot } from '../player/model';
import type { MemoryPlayer } from '../engine/memory-player';
import type { SourceRange } from '../player/source-location';

export const SNAPSHOT_LIMITS = Object.freeze({
  timeoutMs: 5000,
  jsonBytes: 2 * 1024 * 1024,
  pngBytes: 8 * 1024 * 1024,
  layoutBytes: 4 * 1024 * 1024,
  width: 1440,
  height: 8192,
  objects: 512,
  frames: 64,
  liveSlots: 2048,
});
export type SnapshotMode = 'basic' | 'memory' | 'stack';
export type SnapshotFormat = 'json' | 'png';
interface CaptureBase {
  title: string;
  observationId: string;
  mode: SnapshotMode;
}
export type CaptureContext =
  | (CaptureBase & {
      kind: 'case';
      request: ExecuteRequest;
      result: ExecuteResult;
      view: PlayerSnapshot;
      diagnosticFocus: ByteRange | null;
    })
  | (CaptureBase & {
      kind: 'memory-observation';
      request: MemoryRequest;
      result: MemoryResult;
      view: ReturnType<MemoryPlayer['snapshot']>;
      highlightedRange: ByteRange | null;
      highlightReason: 'executed-step' | 'breakpoint-call-site' | 'terminal' | 'initial';
    });
export interface SnapshotPort {
  read: () => CaptureContext | null;
  pause: () => void;
  subscribe: (listener: () => void) => () => void;
}
export interface SnapshotDocument {
  formatVersion: '1.0.0';
  formatId: 'urn:c-viz:current-snapshot:1.0.0';
  snapshotId: string;
  capturedAt: string;
  origin: {
    kind: CaptureContext['kind'];
    id: string;
    title: string;
    caseRef: ExecuteResult['subjectRef'];
    programRef: ExecuteResult['programRef'];
    packageRef: ExecuteResult['packageRef'] | null;
    definitionVersion:
      { scheme: 'content-ref'; value: string } | { scheme: 'source-sha256'; value: string };
  };
  source: {
    text: string;
    encoding: 'UTF-8';
    sourceRevision: number | string;
    sha256: string;
    nodeMap: ExecuteResult['nodeMap'] | MemoryResult['nodeMap'];
    blockMap: ExecuteRequest['source']['blockMap'];
    bindingMap: ExecuteRequest['source']['bindingMap'];
    resolvedBindings: ExecuteResult['resolvedBindings'];
  };
  input: ExecuteRequest['input'] | MemoryRequest['input'];
  position: {
    cursor: number;
    length: number;
    stepKind: string | null;
    paused: true;
    atTerminal: boolean;
    executed: {
      raw: PlayerSnapshot['location'] | ByteRange | null;
      range: SourceRange | null;
      description: string;
    };
    highlighted: { reason: string; range: SourceRange | null };
    terminalRange: SourceRange | null;
  };
  presentation: {
    mode: SnapshotMode;
    scope: 'complete-current-state';
    image: 'reflowed-state-picture';
    selectionAndPaginationExcluded: true;
  };
  virtualAddresses: 'educational-not-host-addresses';
  runtime:
    | {
        domain: 'p0-c';
        language: ExecuteResult['languageRef'];
        subset: ExecuteResult['subsetRef'];
        engine: ExecuteResult['engineRef'];
        identity: ExecuteResult['identity'];
        versions: {
          execution: string;
          step: string;
          diagnostic: string;
          integerEncoding: string;
          judge: string;
        };
      }
    | {
        domain: 'p1-memory';
        language: MemoryResult['language'];
        subset: null;
        engine: MemoryResult['engine'];
        identity: MemoryResult['identity'];
        versions: {
          execution: string;
          step: string;
          diagnostic: string;
          integerEncoding: string;
          judge: null;
        };
      };
  currentState: TraceState | MemoryState;
  currentStep: TraceStep | MemoryStep | null;
  types: MemoryResult['types'] | null;
  executionOutcome: ExecuteResult['terminal'] | MemoryResult['terminal'];
  terminalAtCursor: ExecuteResult['terminal'] | MemoryResult['terminal'] | null;
}
export class SnapshotError extends Error {
  constructor(
    public readonly code:
      | 'SNAPSHOT_UNAVAILABLE'
      | 'SNAPSHOT_CHANGED'
      | 'SNAPSHOT_CANCELLED'
      | 'SNAPSHOT_TIMEOUT'
      | 'SNAPSHOT_TOO_LARGE'
      | 'SNAPSHOT_PICTURE_LIMIT'
      | 'SNAPSHOT_FAILED',
  ) {
    super(code);
  }
}
