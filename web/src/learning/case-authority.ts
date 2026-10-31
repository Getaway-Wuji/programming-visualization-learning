import {
  caseExecutionCatalog,
  caseLearningCatalog,
  caseTemplateBindings,
  type CaseExecutionCatalog,
} from '../content/case-learning';
import type { ExecutionCatalog } from '../engine/execution-client';
import { validateInputValues } from '../engine/input-data';
import type {
  ByteRange,
  ExecuteRequest,
  ExecuteResult,
  ExecutionIdentity,
  Ref,
  TraceObject,
} from '../engine/protocol';
import { engineBuild } from '../generated/engine-build';
import type { PlayerSnapshot } from '../player/model';
import { keyStepCursors, type StepDetail } from '../player/key-steps';
import { StorageError } from '../storage/errors';
import { createLearningAuthority, type VerifiedFact } from './authority';
import { sameRef } from './catalog';

function requireCase(condition: unknown): asserts condition {
  if (!condition) throw new StorageError('S_CONTENT_INCOMPATIBLE');
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`;
}
function sameIdentity(first: ExecutionIdentity, second: ExecutionIdentity): boolean {
  return canonical(first) === canonical(second);
}
function publicRefMatches(first: Ref | null, second: Ref | null): boolean {
  return !!first && !!second && sameRef(first, second);
}
function withoutBindings(
  source: string,
  bindings: readonly { bindingKey: string; byteRange: ByteRange }[],
): string {
  const bytes = new TextEncoder().encode(source);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let previous = 0;
  let normalized = '';
  for (const { bindingKey, byteRange } of [...bindings].sort(
    (first, second) => first.byteRange.start - second.byteRange.start,
  )) {
    requireCase(
      Number.isInteger(byteRange.start) &&
        Number.isInteger(byteRange.end) &&
        byteRange.start >= previous &&
        byteRange.end > byteRange.start &&
        byteRange.end <= bytes.length,
    );
    normalized += decoder.decode(bytes.subarray(previous, byteRange.start));
    normalized += `<${bindingKey}>`;
    previous = byteRange.end;
  }
  return normalized + decoder.decode(bytes.subarray(previous));
}
function objectCells(object: TraceObject): (number | null)[] {
  return Array.from(
    { length: object.length },
    (_, index) => object.cells.find((cell) => cell.index === index)?.value ?? object.defaultValue,
  );
}

/** Check observations from the accepted Rust run; never execute the template in JS. */
function checkResultRule(
  catalog: CaseExecutionCatalog,
  request: ExecuteRequest,
  result: ExecuteResult,
): void {
  const trace = result.trace!;
  let stdout = trace.initialState.output;
  let finalValues: (number | null)[] | undefined;
  for (const step of trace.steps) {
    for (const change of step.changes) {
      if (change.op === 'output') stdout += change.append;
      if (
        change.op === 'record' &&
        change.table === 'objects' &&
        change.after === null &&
        change.before &&
        'name' in change.before &&
        change.before.name === 'values'
      )
        finalValues = objectCells(change.before as TraceObject);
    }
  }
  const input = request.input.values;
  switch (catalog.subject.resultRule) {
    case 'assignment-add-two':
      requireCase(stdout === `${(input.x as number) + 2}\n`);
      break;
    case 'nonnegative-branch':
      requireCase(stdout === `${(input.x as number) >= 0 ? 1 : 0}\n`);
      break;
    case 'two-loop-sums': {
      const n = input.n as number;
      const sum = (n * (n + 1)) / 2;
      requireCase(stdout === `${sum}\n${sum}\n`);
      break;
    }
    case 'logical-array-sum': {
      const values = input.values as readonly number[];
      requireCase(stdout === `${values.reduce((sum, value) => sum + value, 0)}\n`);
      requireCase(
        finalValues && canonical(finalValues) === canonical(values.length ? values : [0]),
      );
      break;
    }
    case 'bubble-ascending':
    case 'selection-ascending': {
      const values = input.values as readonly number[];
      requireCase(finalValues && finalValues.length === Math.max(1, values.length));
      const final = finalValues.slice(0, values.length);
      requireCase(final.every((value): value is number => typeof value === 'number'));
      // Verify order and the input multiset, without computing a sorted answer.
      requireCase(final.every((value, index) => index === 0 || final[index - 1] <= value));
      const counts = new Map<number, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      for (const value of final) counts.set(value, (counts.get(value) ?? 0) - 1);
      requireCase([...counts.values()].every((count) => count === 0));
      requireCase(stdout === `${final.join(' ')}\n`);
      break;
    }
    case 'binary-first-index': {
      const values = input.values as readonly number[];
      const target = input.target as number;
      requireCase(/^(?:-1|0|[1-9]\d*)\n$/.test(stdout));
      const answer = Number(stdout.trim());
      requireCase(
        answer === -1
          ? values.every((value) => value !== target)
          : answer < values.length &&
              values[answer] === target &&
              values.slice(0, answer).every((value) => value !== target),
      );
      requireCase(
        finalValues && canonical(finalValues) === canonical(values.length ? values : [0]),
      );
      break;
    }
    default:
      requireCase(false);
  }
}

export interface CaseViewProgress {
  readonly seen: number;
  readonly total: number;
  readonly complete: boolean;
}
export interface CaseViewSession {
  /** Called by the renderer only after this real state has been committed to the DOM. */
  present(view: PlayerSnapshot, detail?: StepDetail): void;
  progress(detail?: StepDetail): CaseViewProgress;
  /** An explicit user confirmation is required before calling this method. */
  issue(): VerifiedFact;
}
const caseFacts = new WeakSet<object>();

/** Install only after execute's final Promise has accepted this exact live run. */
export function createCaseViewSession(
  catalog: ExecutionCatalog,
  request: ExecuteRequest,
  result: ExecuteResult,
  current: () => boolean,
  keyCoverage = false,
): CaseViewSession {
  const reviewed = caseExecutionCatalog(catalog.subject.id);
  requireCase(reviewed && canonical(catalog) === canonical(reviewed) && current());
  requireCase(
    request.kind === 'execute' &&
      request.mode === 'case' &&
      request.judge === null &&
      request.identity.testCaseKey === null &&
      result.kind === 'result' &&
      result.producer === 'rust' &&
      sameIdentity(request.identity, result.identity) &&
      request.engineRef.buildId === engineBuild.wasmSha256 &&
      canonical(result.engineRef) === canonical(request.engineRef) &&
      request.learningRevision === reviewed.subject.learningRevision &&
      result.learningRevision === request.learningRevision &&
      publicRefMatches(request.packageRef, reviewed.packageRef) &&
      publicRefMatches(request.subjectRef, reviewed.subject) &&
      publicRefMatches(request.programRef, reviewed.program) &&
      publicRefMatches(request.languageRef, reviewed.program.languageRef) &&
      publicRefMatches(request.subsetRef, reviewed.program.subsetRef) &&
      publicRefMatches(request.input.specRef, reviewed.inputSpec) &&
      result.terminal.status === 'completed' &&
      result.terminal.exitCode === 0 &&
      result.terminal.diagnostics.length === 0 &&
      result.trace?.completeness === 'complete' &&
      result.terminal.cursor === result.trace.steps.length &&
      validateInputValues(reviewed.inputSpec, request.input.values).ok,
  );
  for (const key of ['packageRef', 'subjectRef', 'programRef', 'languageRef', 'subsetRef'] as const)
    requireCase(publicRefMatches(result[key], request[key]));
  const bindings = caseTemplateBindings(reviewed.subject.id);
  requireCase(
    request.source.bindingMap.length === bindings.length &&
      new Set(request.source.bindingMap.map((entry) => entry.bindingKey)).size ===
        bindings.length &&
      request.source.bindingMap.every((entry) =>
        bindings.some((binding) => binding.bindingKey === entry.bindingKey),
      ) &&
      withoutBindings(request.source.text, request.source.bindingMap) ===
        withoutBindings(reviewed.program.sourceExample, bindings),
  );
  checkResultRule(reviewed, request, result);
  const total = result.trace!.steps.length;
  const required = keyCoverage
    ? keyStepCursors(result)
    : Array.from({ length: total + 1 }, (_, i) => i);
  const positions = new Map(required.map((cursor, index) => [cursor, index]));
  const seen = new Set<number>();
  const allSeen = new Set<number>();
  let initialPresented = false;
  let previousCursor: number | null = null;
  let confirmed: VerifiedFact | undefined;
  const complete = () =>
    current() &&
    initialPresented &&
    (allSeen.size === total || (keyCoverage && seen.size === required.length - 1));
  const authority = createLearningAuthority(caseLearningCatalog(), () => complete(), true);
  return {
    present(view, detail = 'all') {
      if (
        !current() ||
        !view.identity ||
        !sameIdentity(view.identity, result.identity) ||
        !view.state ||
        view.length !== total ||
        view.outcome?.status !== 'completed' ||
        view.cursor === null ||
        !Number.isInteger(view.cursor) ||
        view.cursor < 0 ||
        view.cursor > total
      )
        return;
      if (view.cursor === 0) initialPresented = true;
      const at = positions.get(view.cursor);
      const previous = previousCursor === null ? undefined : positions.get(previousCursor);
      if (initialPresented && previousCursor !== null && view.cursor === previousCursor + 1)
        allSeen.add(view.cursor);
      if (
        initialPresented &&
        previousCursor !== null &&
        at !== undefined &&
        at > 0 &&
        (view.cursor === previousCursor + 1 ||
          (keyCoverage && detail === 'key' && previous === at - 1))
      )
        seen.add(view.cursor);
      previousCursor = view.cursor;
    },
    progress: (detail = 'all') => {
      const selectedSeen = keyCoverage && detail === 'key' ? seen.size : allSeen.size;
      const selectedTotal = keyCoverage && detail === 'key' ? required.length - 1 : total;
      return {
        seen: selectedSeen,
        total: selectedTotal,
        complete: current() && initialPresented && selectedSeen === selectedTotal,
      };
    },
    issue() {
      requireCase(complete());
      if (confirmed) return confirmed;
      confirmed = authority.issue({
        eventContractVersion: '1.0.0',
        eventType: 'case.view-confirmed',
        result: 'confirmed',
        packageRef: { ...reviewed.packageRef },
        subjectRef: { id: reviewed.subject.id, version: reviewed.subject.version },
        learningRevision: reviewed.subject.learningRevision,
      });
      caseFacts.add(confirmed);
      return confirmed;
    },
  };
}

export function assertCaseViewFact(fact: VerifiedFact): void {
  if (!fact || typeof fact !== 'object' || !caseFacts.has(fact))
    throw new StorageError('S_CONTENT_INCOMPATIBLE');
}
