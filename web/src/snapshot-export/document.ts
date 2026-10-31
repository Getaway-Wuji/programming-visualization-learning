import { createSourceIndex, mapSourceLocation } from '../player/source-location';
import {
  SNAPSHOT_LIMITS,
  SnapshotError,
  type CaptureContext,
  type SnapshotDocument,
} from './types';

/** A lease key only in current memory. Never logged, uploaded or persisted. */
export function captureKey(context: CaptureContext | null): string {
  if (!context) return 'unavailable';
  const { view, request } = context;
  return JSON.stringify([
    context.kind,
    context.observationId,
    context.mode,
    'identity' in request ? request.identity : [request.runId, request.sourceRevision],
    view.cursor,
    'playing' in view ? view.playing : view.status === 'playing',
    typeof request.source === 'string' ? request.source : request.source.text,
    context.kind === 'case'
      ? context.diagnosticFocus
      : [context.highlightedRange, context.highlightReason],
  ]);
}
export function copyCurrentDocument(
  context: CaptureContext,
  snapshotId: string,
  capturedAt: string,
): SnapshotDocument {
  const { result, view } = context;
  if (
    !result.trace ||
    !view.state ||
    view.cursor === null ||
    !Number.isInteger(view.cursor) ||
    view.cursor < 0 ||
    view.cursor > view.length ||
    view.length !== result.trace.steps.length
  )
    throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
  if (
    ('playing' in view && view.playing) ||
    ('status' in view && ['playing', 'loading', 'idle'].includes(view.status))
  )
    throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
  const atTerminal = view.cursor === view.length;
  const common = {
    formatVersion: '1.0.0',
    formatId: 'urn:c-viz:current-snapshot:1.0.0',
    snapshotId,
    capturedAt,
    presentation: {
      mode: context.mode,
      scope: 'complete-current-state',
      image: 'reflowed-state-picture',
      selectionAndPaginationExcluded: true,
    },
    virtualAddresses: 'educational-not-host-addresses',
    currentState: view.state,
    currentStep: view.cursor > 0 ? result.trace.steps[view.cursor - 1]! : null,
    executionOutcome: result.terminal,
    terminalAtCursor: atTerminal ? result.terminal : null,
  } as const;
  let document: SnapshotDocument;
  if (context.kind === 'case') {
    const { request, result, view } = context;
    if (
      result.producer !== 'rust' ||
      request.mode !== 'case' ||
      !view.identity ||
      Object.entries(request.identity).some(
        ([key, value]) =>
          view.identity![key as keyof typeof view.identity] !== value ||
          result.identity[key as keyof typeof result.identity] !== value,
      )
    )
      throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
    const source = request.source.text,
      index = createSourceIndex(source);
    const executed = mapSourceLocation(source, result.nodeMap, view.location, index);
    const terminal =
      atTerminal && result.terminal.status !== 'completed'
        ? mapSourceLocation(source, result.nodeMap, result.terminal.location, index).range
        : null;
    const focus = context.diagnosticFocus ? index.range(context.diagnosticFocus) : null;
    document = {
      ...common,
      origin: {
        kind: 'case',
        id: context.observationId,
        title: context.title,
        caseRef: result.subjectRef,
        programRef: result.programRef,
        packageRef: result.packageRef,
        definitionVersion: {
          scheme: 'content-ref',
          value: `${result.subjectRef!.id}@${result.subjectRef!.version}`,
        },
      },
      runtime: {
        domain: 'p0-c',
        language: result.languageRef,
        subset: result.subsetRef,
        engine: result.engineRef,
        identity: result.identity,
        versions: {
          execution: result.protocolVersion,
          step: result.traceVersion,
          diagnostic: result.diagnosticVersion,
          integerEncoding: result.encodingVersion,
          judge: result.judgeVersion,
        },
      },
      source: {
        text: source,
        encoding: 'UTF-8',
        sourceRevision: request.identity.sourceRevision,
        sha256: '',
        nodeMap: result.nodeMap,
        blockMap: request.source.blockMap,
        bindingMap: request.source.bindingMap,
        resolvedBindings: result.resolvedBindings,
      },
      input: request.input,
      types: null,
      position: {
        cursor: view.cursor!,
        length: view.length,
        stepKind: view.stepKind,
        paused: true,
        atTerminal,
        executed: { raw: view.location, range: executed.range, description: executed.description },
        highlighted: {
          reason: focus ? 'diagnostic-focus' : terminal ? 'terminal' : 'executed-step',
          range: focus ?? terminal ?? executed.range,
        },
        terminalRange: terminal,
      },
    };
  } else {
    const { request, result, view } = context;
    if (
      !view.identity ||
      view.identity.runId !== result.identity.runId ||
      view.identity.sourceRevision !== result.identity.sourceRevision ||
      request.runId !== result.identity.runId ||
      request.sourceRevision !== result.identity.sourceRevision ||
      request.language !== result.language
    )
      throw new SnapshotError('SNAPSHOT_UNAVAILABLE');
    const source = request.source,
      index = createSourceIndex(source);
    const range = view.byteRange ? index.range(view.byteRange) : null;
    document = {
      ...common,
      origin: {
        kind: 'memory-observation',
        id: context.observationId,
        title: context.title,
        caseRef: null,
        programRef: null,
        packageRef: null,
        definitionVersion: { scheme: 'source-sha256', value: '' },
      },
      runtime: {
        domain: 'p1-memory',
        language: result.language,
        subset: null,
        engine: result.engine,
        identity: result.identity,
        versions: {
          execution: result.execVersion,
          step: result.dslVersion,
          diagnostic: result.diagnosticVersion,
          integerEncoding: result.integerEncoding,
          judge: null,
        },
      },
      source: {
        text: source,
        encoding: 'UTF-8',
        sourceRevision: request.sourceRevision,
        sha256: '',
        nodeMap: result.nodeMap,
        blockMap: [],
        bindingMap: [],
        resolvedBindings: [],
      },
      input: request.input,
      types: result.types,
      position: {
        cursor: view.cursor,
        length: view.length,
        stepKind: view.stepKind,
        paused: true,
        atTerminal,
        executed: {
          raw: view.byteRange,
          range,
          description: range
            ? `第 ${range.start.line} 行，第 ${range.start.column} 列`
            : '初始状态，尚未完成源码步骤',
        },
        highlighted: {
          reason: context.highlightReason,
          range: context.highlightedRange ? index.range(context.highlightedRange) : null,
        },
        terminalRange:
          atTerminal && result.terminal.byteRange ? index.range(result.terminal.byteRange) : null,
      },
    };
  }
  // Copy only this state, step and maps. The complete result/trace never enters the file.
  return structuredClone(document);
}
export function encodeSnapshot(document: SnapshotDocument): Uint8Array<ArrayBuffer> {
  const bytes = new TextEncoder().encode(JSON.stringify(document, null, 2) + '\n');
  if (bytes.byteLength > SNAPSHOT_LIMITS.jsonBytes) throw new SnapshotError('SNAPSHOT_TOO_LARGE');
  return bytes;
}
