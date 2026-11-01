import type { AdvancedResult, AdvancedState } from '../engine/advanced-protocol';
import { bytes, ensure, equal, type AiContext, type ByteRange, type Fact } from './protocol';

export interface ContextInput {
  source: string;
  inputRevision: string;
  result: AdvancedResult | null;
  state: AdvancedState | null;
  cursor: number;
  selection: { start: number; end: number } | null;
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder('utf-8', { fatal: true });
const inside = (range: ByteRange | null, snippets: AiContext['snippets']) =>
  !range || snippets.some((s) => s.byteRange.start <= range.start && range.end <= s.byteRange.end);
function windowFor(source: Uint8Array, range: ByteRange): ByteRange {
  let start = Math.min(range.start, source.length),
    end = Math.min(Math.max(range.end, range.start + 1), source.length);
  while (start > 0 && source[start - 1] !== 10) start--;
  while (end < source.length && source[end - 1] !== 10) end++;
  if (end - start > 2048) {
    start = range.start;
    end = range.end;
  }
  return { start, end };
}
export function buildContext(input: ContextInput): AiContext {
  const { source, result, state, cursor, inputRevision, selection } = input;
  ensure(result && result.language === 'c', 'E_AI_INSUFFICIENT_CONTEXT');
  const raw = encoder.encode(source),
    nodes = new Map(result.nodeMap.map((n) => [n.nodeId, n]));
  const current = result.trace?.steps[cursor - 1];
  const targets: ByteRange[] =
    selection && selection.end > selection.start
      ? [
          {
            start: bytes(source.slice(0, selection.start)),
            end: bytes(source.slice(0, selection.end)),
          },
        ]
      : [result.terminal.byteRange, current ? nodes.get(current.nodeId)?.byteRange : null]
          .filter((v): v is ByteRange => !!v)
          .map((r) => windowFor(raw, r));
  if (!targets.length) targets.push(windowFor(raw, { start: 0, end: Math.min(1, raw.length) }));
  targets.sort((a, b) => a.start - b.start);
  const ranges: ByteRange[] = [];
  for (const range of targets) {
    const last = ranges.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else ranges.push({ ...range });
  }
  ensure(
    ranges.length <= 2 && ranges.reduce((n, r) => n + r.end - r.start, 0) <= 2048,
    'E_AI_CONTEXT_LIMIT',
  );
  const snippets = ranges.map((r, i) => ({
    snippetId: `s${i + 1}`,
    byteRange: r,
    firstLine: decoder.decode(raw.slice(0, r.start)).split('\n').length,
    text: decoder.decode(raw.slice(r.start, r.end)),
  }));
  ensure(snippets.reduce((n, s) => n + s.text.split('\n').length, 0) <= 32, 'E_AI_CONTEXT_LIMIT');
  const facts: Fact[] = [];
  const add = (f: Fact) => {
    if (facts.length < 12) facts.push({ ...f, factId: `f${facts.length + 1}` });
  };
  if (result.terminal.code && inside(result.terminal.byteRange, snippets))
    add({
      factId: '',
      kind: 'diagnostic',
      code: result.terminal.code,
      byteRange: result.terminal.byteRange,
    });
  if (result.trace) {
    ensure(state && cursor >= 0 && cursor <= result.trace.steps.length, 'E_AI_CONTEXT_STALE');
    for (const step of result.trace.steps.slice(Math.max(0, cursor - 4), cursor)) {
      const node = nodes.get(step.nodeId);
      if (node && inside(node.byteRange, snippets))
        add({
          factId: '',
          kind: 'step',
          step: step.seq,
          stepKind: step.kind,
          nodeId: step.nodeId,
          byteRange: node.byteRange,
        });
    }
    const objects = state.objects
      .filter(
        (o) =>
          inside(nodes.get(o.declarationNodeId)?.byteRange ?? null, snippets) &&
          !!nodes.get(o.declarationNodeId),
      )
      .slice(0, 2);
    const frames = new Set<string | null>();
    let cells = 0;
    for (const object of objects) {
      frames.add(object.frameId);
      if (frames.size > 2) break;
      for (const cell of object.cells) {
        if (cells >= 8 || facts.length >= 12) break;
        if (typeof cell.value === 'string') continue;
        add({
          factId: '',
          kind: 'state',
          atCursor: cursor,
          objectId: object.id,
          frameId: object.frameId,
          byteOffset: cell.byteOffset,
          name: object.name,
          typeName: object.typeName,
          alive: object.alive,
          value: structuredClone(cell.value),
        });
        cells++;
      }
    }
  }
  ensure(facts.length > 0, 'E_AI_INSUFFICIENT_CONTEXT');
  return {
    contextId: crypto.randomUUID(),
    runRef: {
      engineId: result.engine.id,
      buildId: result.engine.buildId,
      execVersion: result.execVersion,
      dslVersion: result.dslVersion,
      diagnosticVersion: result.diagnosticVersion,
      language: 'c',
      runId: result.identity.runId,
      sourceRevision: result.identity.sourceRevision,
    },
    inputRevision,
    cursor: result.trace ? cursor : null,
    traceAvailable: !!result.trace,
    snippets,
    facts,
  };
}
export function validateOriginal(context: AiContext, original: ContextInput) {
  ensure(
    original.result &&
      context.runRef.runId === original.result.identity.runId &&
      context.runRef.sourceRevision === original.result.identity.sourceRevision &&
      context.inputRevision === original.inputRevision &&
      context.cursor === (original.result.trace ? original.cursor : null),
    'E_AI_CONTEXT_STALE',
  );
  const raw = encoder.encode(original.source);
  for (const s of context.snippets)
    ensure(
      s.text === decoder.decode(raw.slice(s.byteRange.start, s.byteRange.end)) &&
        s.firstLine === decoder.decode(raw.slice(0, s.byteRange.start)).split('\n').length,
      'E_AI_CONTEXT_STALE',
    );
  for (const f of context.facts) {
    if (f.kind === 'diagnostic')
      ensure(
        f.code === original.result.terminal.code &&
          equal(f.byteRange, original.result.terminal.byteRange),
      );
    else if (f.kind === 'step') {
      const step = original.result.trace?.steps[f.step - 1];
      ensure(
        step &&
          f.step <= original.cursor &&
          f.nodeId === step.nodeId &&
          f.stepKind === step.kind &&
          equal(
            f.byteRange,
            original.result.nodeMap.find((n) => n.nodeId === step.nodeId)?.byteRange,
          ),
      );
    } else {
      const object = original.state?.objects.find((o) => o.id === f.objectId),
        cell = object?.cells.find((c) => c.byteOffset === f.byteOffset);
      ensure(
        f.atCursor === original.cursor &&
          object &&
          cell &&
          f.frameId === object.frameId &&
          f.name === object.name &&
          f.typeName === object.typeName &&
          f.alive === object.alive &&
          equal(f.value, cell.value),
      );
    }
  }
}
